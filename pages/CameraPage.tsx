
import React, { useRef, useEffect, useState, useCallback } from 'react';
import { AspectRatio, PhotoboothSettings } from '../types';

interface CameraPageProps {
  onCapture: (image: string) => void;
  onGenerate: () => void;
  onBack: () => void;
  capturedImage: string | null;
  orientation: 'portrait' | 'landscape';
  cameraRotation?: number; // 0, 90, 180, 270
  aspectRatio?: AspectRatio; // '9:16' | '16:9' etc
  settings?: PhotoboothSettings; // New Prop for accessing settings
  onUpdateSettings?: (settings: PhotoboothSettings) => void; // New Prop for updating model
}

const CameraPage: React.FC<CameraPageProps> = ({ 
    onCapture, 
    onGenerate, 
    onBack, 
    capturedImage, 
    orientation, 
    cameraRotation = 0,
    aspectRatio = '9:16',
    settings,
    onUpdateSettings
}) => {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const streamRef = useRef<MediaStream | null>(null); // Use Ref for persistent stream access
  
  const [countdown, setCountdown] = useState<number | null>(null);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [isStreaming, setIsStreaming] = useState(false);

  // --- CAMERA CONTROL FUNCTIONS ---

  const stopCamera = useCallback(() => {
    if (streamRef.current) {
      console.log("Stopping Camera Stream...");
      streamRef.current.getTracks().forEach(track => {
        track.stop();
        // Explicitly remove track to help GC
        streamRef.current?.removeTrack(track);
      });
      streamRef.current = null;
    }
    
    if (videoRef.current) {
      videoRef.current.srcObject = null;
      videoRef.current.load(); // Force release buffer
    }
    setIsStreaming(false);
  }, []);

  const startCamera = useCallback(async () => {
    // Prevent multiple streams
    if (streamRef.current) stopCamera();
    setCameraError(null);

    try {
      console.log("Starting Camera (1080p)...");
      const constraints: MediaStreamConstraints = { 
        audio: false,
        video: { 
          // Use 1080p instead of 4K to reduce heat/load on Android
          width: { ideal: 1920 }, 
          height: { ideal: 1080 }, 
          facingMode: 'user',
          frameRate: { ideal: 30, max: 30 }
        } 
      };

      const mediaStream = await navigator.mediaDevices.getUserMedia(constraints);
      streamRef.current = mediaStream;
      
      if (videoRef.current) {
        videoRef.current.srcObject = mediaStream;
        // Wait for video to actually play
        await videoRef.current.play().catch(e => console.warn("Autoplay blocked:", e));
      }
      setIsStreaming(true);
    } catch (err: any) {
      console.error("Camera Setup Error:", err);
      let msg = "Failed to access camera.";
      if (err.name === 'NotAllowedError') msg = "Permission denied. Please allow camera access.";
      else if (err.name === 'NotFoundError') msg = "No camera device found.";
      else if (err.name === 'NotReadableError') msg = "Camera is busy or being used by another app.";
      setCameraError(msg);
    }
  }, [stopCamera]);

  // --- LIFECYCLE MANAGEMENT ---

  useEffect(() => {
    // 1. Start Camera on Mount
    startCamera();

    // 2. Handle Tab Visibility (Stop camera if user switches tabs to save resources)
    const handleVisibilityChange = () => {
        if (document.hidden) {
            stopCamera();
        } else {
            // Only restart if we don't have an image captured yet
            if (!capturedImage) startCamera();
        }
    };
    document.addEventListener("visibilitychange", handleVisibilityChange);

    // 3. Cleanup on Unmount
    return () => {
      stopCamera();
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [startCamera, stopCamera, capturedImage]);

  // --- CAPTURE LOGIC ---

  // Calculate Aspect Ratio Value
  const getAspectRatioValue = (ratioStr: string): number => {
    const [w, h] = ratioStr.split(':').map(Number);
    return w / h;
  };
  const targetRatioValue = getAspectRatioValue(aspectRatio);

  const capture = useCallback(() => {
    if (videoRef.current && canvasRef.current) {
      const video = videoRef.current;
      const canvas = canvasRef.current;
      const ctx = canvas.getContext('2d');

      // 1. Get RAW Video Source Dimensions (Usually Landscape 1920x1080)
      const rawW = video.videoWidth;
      const rawH = video.videoHeight;
      
      // Safety check if video hasn't loaded yet
      if (rawW === 0 || rawH === 0) return;

      // 2. Calculate "Effective" Dimensions based on Physical Camera Rotation
      const isSideways = cameraRotation === 90 || cameraRotation === 270;
      
      const effectiveInputW = isSideways ? rawH : rawW;
      const effectiveInputH = isSideways ? rawW : rawH;
      const effectiveInputRatio = effectiveInputW / effectiveInputH;

      // 3. Calculate Crop Area on RAW Stream
      let cropW_eff = effectiveInputW;
      let cropH_eff = effectiveInputH;

      if (effectiveInputRatio > targetRatioValue) {
        // Input wider than target -> Crop Sides
        cropW_eff = effectiveInputH * targetRatioValue;
      } else {
        // Input taller than target -> Crop Top/Bottom
        cropH_eff = effectiveInputW / targetRatioValue;
      }

      // 4. Map Effective Crop back to RAW Coordinates
      let srcX = 0, srcY = 0, srcW = 0, srcH = 0;

      if (isSideways) {
         srcW = cropH_eff; 
         srcH = cropW_eff; 
      } else {
         srcW = cropW_eff;
         srcH = cropH_eff;
      }

      // Center Crop
      srcX = (rawW - srcW) / 2;
      srcY = (rawH - srcH) / 2;

      // 5. Determine Final Output Size (Max 1536px for quality/performance balance)
      const MAX_DIMENSION = 1536;
      let destW, destH;

      if (targetRatioValue < 1) { // Portrait Output
          destW = Math.round(MAX_DIMENSION * targetRatioValue);
          destH = MAX_DIMENSION;
      } else { // Landscape Output
          destW = MAX_DIMENSION;
          destH = Math.round(MAX_DIMENSION / targetRatioValue);
      }

      // 6. Set Canvas Size
      canvas.width = destW;
      canvas.height = destH;

      if (ctx) {
         ctx.save();
         // Translate to center
         ctx.translate(canvas.width / 2, canvas.height / 2);
         // Rotate based on settings
         ctx.rotate((cameraRotation * Math.PI) / 180);
         // Mirror (Standard Webcam behavior)
         ctx.scale(-1, 1); 

         // Draw Video to Canvas
         const drawW = isSideways ? destH : destW;
         const drawH = isSideways ? destW : destH;
         
         ctx.drawImage(
            video, 
            srcX, srcY, srcW, srcH, 
            -drawW / 2, -drawH / 2, drawW, drawH
         );

         ctx.restore();

         // Generate Base64
         const dataUrl = canvas.toDataURL('image/jpeg', 0.90);
         
         // CRITICAL: Stop Camera IMMEDIATELY after capture to free resources
         stopCamera();
         
         // Pass data up
         onCapture(dataUrl);
         onGenerate();
      }
    }
  }, [onCapture, onGenerate, cameraRotation, targetRatioValue, stopCamera]);

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    // Stop camera when uploading file
    stopCamera();

    const reader = new FileReader();
    reader.onload = (event) => {
      const img = new Image();
      img.onload = () => {
        if (canvasRef.current) {
          const canvas = canvasRef.current;
          const ctx = canvas.getContext('2d');
          
          // Simple center crop for uploaded images
          const imgRatio = img.width / img.height;
          let sX = 0, sY = 0, sW = img.width, sH = img.height;
          
          if (imgRatio > targetRatioValue) {
             sW = img.height * targetRatioValue;
             sX = (img.width - sW) / 2;
          } else {
             sH = img.width / targetRatioValue;
             sY = (img.height - sH) / 2;
          }

          const MAX_DIMENSION = 1536;
          let dW, dH;
          if (targetRatioValue < 1) {
              dW = Math.round(MAX_DIMENSION * targetRatioValue);
              dH = MAX_DIMENSION;
          } else {
              dW = MAX_DIMENSION;
              dH = Math.round(MAX_DIMENSION / targetRatioValue);
          }

          canvas.width = dW;
          canvas.height = dH;

          if (ctx) {
            ctx.drawImage(img, sX, sY, sW, sH, 0, 0, dW, dH);
            const dataUrl = canvas.toDataURL('image/jpeg', 0.90);
            onCapture(dataUrl);
            onGenerate();
          }
        }
      };
      img.src = event.target?.result as string;
    };
    reader.readAsDataURL(file);
  };

  const startCountdown = () => {
    if (!isStreaming && !streamRef.current) {
        // Safety: If camera isn't running, try starting it (rare edge case)
        startCamera().then(() => doCountdown());
    } else {
        doCountdown();
    }
  };

  const doCountdown = () => {
      setCountdown(3);
      const interval = setInterval(() => {
        setCountdown(prev => {
          if (prev === 1) {
            clearInterval(interval);
            capture();
            return null;
          }
          return prev ? prev - 1 : null;
        });
      }, 1000);
  };

  const handleBack = () => {
      stopCamera(); // Ensure camera stops when going back
      onBack();
  };

  // Model Toggle Logic
  const handleToggleModel = () => {
      if (!settings || !onUpdateSettings) return;
      const isUltra = settings.selectedModel === 'gemini-3-pro-image-preview';
      const newModel = isUltra ? 'gemini-2.5-flash-image' : 'gemini-3-pro-image-preview';
      onUpdateSettings({ ...settings, selectedModel: newModel });
  };

  // Convert "9:16" -> "9/16" for CSS
  const cssAspectRatio = aspectRatio.replace(':', '/');
  const isSideways = cameraRotation === 90 || cameraRotation === 270;
  
  // Shortcut Status
  const showModelShortcut = settings?.enableModelShortcut;
  const isUltraModel = settings?.selectedModel === 'gemini-3-pro-image-preview';

  return (
    <div className="w-full h-screen flex flex-col items-center justify-center bg-transparent relative overflow-hidden">
      {/* Header Overlay */}
      <div className="absolute top-0 left-0 right-0 p-6 flex justify-between items-center z-40 bg-gradient-to-b from-black/80 to-transparent">
        <button 
          onClick={handleBack} 
          className="text-white hover:text-purple-400 font-bold tracking-widest uppercase text-xs md:text-base transition-colors bg-black/20 backdrop-blur-sm px-4 py-2 rounded-full border border-white/10"
        >
          BACK
        </button>
        <h2 className="text-sm md:text-2xl font-heading text-white neon-text italic uppercase drop-shadow-lg">Strike a Pose</h2>
        <div className="w-20" /> 
      </div>

      {/* VIEWPORT MASK CONTAINER */}
      <div className="relative z-10 flex items-center justify-center w-full h-full max-h-screen p-4 md:p-8">
        
        {/* CAMERA ERROR UI */}
        {cameraError && !capturedImage && (
             <div className="absolute inset-0 z-50 flex items-center justify-center bg-black/80 p-6">
                 <div className="bg-red-900/20 border border-red-500/50 p-6 rounded-xl text-center max-w-sm backdrop-blur-md">
                     <div className="w-12 h-12 rounded-full bg-red-500/20 flex items-center justify-center mx-auto mb-4">
                         <svg className="w-6 h-6 text-red-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" /></svg>
                     </div>
                     <h3 className="text-white font-heading uppercase tracking-widest mb-2">Camera Error</h3>
                     <p className="text-gray-300 text-xs font-mono mb-6">{cameraError}</p>
                     <button onClick={startCamera} className="px-6 py-2 bg-red-600 hover:bg-red-500 text-white font-bold uppercase text-xs rounded transition-colors">
                         Retry Camera
                     </button>
                 </div>
             </div>
        )}

        {!capturedImage ? (
           <div 
             className="relative overflow-hidden shadow-[0_0_50px_rgba(168,85,247,0.2)] border-2 border-purple-500/30 rounded-xl bg-gray-900 flex items-center justify-center"
             style={{
                aspectRatio: cssAspectRatio,
                height: '100%',     
                width: 'auto',      
                maxHeight: '100%',
                maxWidth: '100%'
             }}
           >
              {/* VIDEO ELEMENT */}
              <video 
                ref={videoRef} 
                autoPlay 
                playsInline 
                muted
                className="absolute object-cover"
                style={{ 
                   transform: `rotate(${cameraRotation}deg) scaleX(-1)`, // Rotate + Mirror
                   width: isSideways ? '100vh' : '100%', 
                   height: isSideways ? '100vw' : '100%',
                   minWidth: isSideways ? '100%' : '100%',
                   minHeight: isSideways ? '100%' : '100%',
                }}
              />

              {/* HUD / Countdown Overlay */}
              <div className="absolute inset-0 pointer-events-none z-20 flex items-center justify-center opacity-40">
                   <div className="w-1/2 h-1/3 border border-white/30 rounded-lg flex items-center justify-center">
                       <div className="w-2 h-2 bg-purple-500/50 rounded-full" />
                   </div>
              </div>

              {countdown && (
                <div className="absolute inset-0 flex items-center justify-center z-50 bg-black/40 backdrop-blur-[4px]">
                  <span className="text-[120px] md:text-[250px] font-heading text-white neon-text animate-ping italic">{countdown}</span>
                </div>
              )}
           </div>
        ) : (
           // Result Preview
           <div 
             className="relative overflow-hidden border-2 border-white/20 rounded-xl"
             style={{
                aspectRatio: cssAspectRatio,
                height: '100%',
                width: 'auto',
                maxHeight: '100%',
                maxWidth: '100%'
             }}
           >
              <img src={capturedImage} alt="Capture" className="w-full h-full object-contain bg-black" />
           </div>
        )}
      </div>

      {/* CONTROLS */}
      {!countdown && !capturedImage && (
        <div className="absolute bottom-10 left-0 right-0 flex justify-center items-center z-50 px-6 gap-8 pointer-events-none">
                
                {/* QUICK MODEL SHORTCUT TOGGLE (LEFT) */}
                <div className="w-16 h-16 md:flex items-center justify-center pointer-events-auto">
                   {showModelShortcut && (
                       <button
                         onClick={handleToggleModel}
                         className={`group flex flex-col items-center justify-center w-14 h-14 md:w-16 md:h-16 rounded-full backdrop-blur-md border-2 transition-all shadow-lg ${isUltraModel ? 'bg-orange-900/40 border-orange-500 shadow-[0_0_15px_rgba(249,115,22,0.4)]' : 'bg-purple-900/40 border-purple-500 shadow-[0_0_15px_rgba(168,85,247,0.4)]'}`}
                       >
                           <div className={`text-[8px] md:text-[9px] font-bold font-heading uppercase tracking-widest ${isUltraModel ? 'text-orange-200' : 'text-purple-200'}`}>
                               {isUltraModel ? 'ULTRA' : 'NORMAL'}
                           </div>
                           <div className={`text-[6px] md:text-[7px] font-mono opacity-70 ${isUltraModel ? 'text-orange-300' : 'text-purple-300'}`}>
                               {isUltraModel ? 'GEN3' : 'GEN2.5'}
                           </div>
                       </button>
                   )}
                </div>

                <button 
                  onClick={startCountdown}
                  className="group pointer-events-auto relative w-24 h-24 md:w-28 md:h-28 flex items-center justify-center outline-none transition-transform active:scale-95"
                  disabled={!!cameraError}
                >
                  <div className={`absolute inset-0 border-2 border-dashed ${cameraError ? 'border-red-500/30' : 'border-purple-500/30'} rounded-full animate-[spin_10s_linear_infinite]`} />
                  <div className={`absolute inset-2 border-2 ${cameraError ? 'border-red-500/20' : 'border-white/20'} rounded-full group-hover:border-purple-400/50 transition-colors duration-500`} />
                  <div className={`absolute inset-4 bg-white/5 backdrop-blur-md border border-white/20 rounded-full flex items-center justify-center group-hover:bg-purple-600/20 group-hover:border-purple-400 transition-all duration-300 shadow-[0_0_20px_rgba(255,255,255,0.05)]`}>
                    <span className="text-[10px] md:text-xs font-heading font-black text-white tracking-[0.2em] italic group-hover:neon-text">CAPTURE</span>
                  </div>
                </button>

                <div className="pointer-events-auto w-16 h-16 md:flex items-center justify-center">
                  <button 
                    onClick={() => fileInputRef.current?.click()}
                    className="w-12 h-12 md:w-16 md:h-16 rounded-full bg-black/40 border border-white/20 backdrop-blur-md flex items-center justify-center hover:bg-white/10 hover:border-purple-500 transition-all group/upload"
                    title="Upload Image"
                  >
                    <svg className="w-5 h-5 md:w-6 md:h-6 text-white/70 group-hover/upload:text-purple-400 transition-colors" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
                    </svg>
                  </button>
                  <input 
                    type="file" 
                    accept="image/*" 
                    ref={fileInputRef} 
                    className="hidden" 
                    onChange={handleFileUpload} 
                  />
                </div>
        </div>
      )}

      <canvas ref={canvasRef} className="hidden" />
    </div>
  );
};

export default CameraPage;
