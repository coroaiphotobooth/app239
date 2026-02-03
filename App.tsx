
import React, { useState, useEffect, useRef } from 'react';
import { AppState, Concept, PhotoboothSettings, ProcessNotification, AspectRatio, GalleryItem } from './types';
import { DEFAULT_CONCEPTS, DEFAULT_SETTINGS, DEFAULT_GAS_URL } from './constants';
import { fetchSettings, fetchEvents, uploadToDrive } from './lib/appsScript';
import { generateAIImage } from './lib/gemini';
import { applyOverlay, getGoogleDriveDirectLink } from './lib/imageUtils'; // Import helper
import { aiQueue } from './lib/aiQueue'; // Import Queue
import LandingPage from './pages/LandingPage';
import ThemesPage from './pages/ThemesPage';
import CameraPage from './pages/CameraPage';
import ResultPage from './pages/ResultPage';
import GalleryPage from './pages/GalleryPage';
import AdminPage from './pages/AdminPage';
import MonitorPage from './pages/MonitorPage';
import FastThanksPage from './pages/FastThanksPage';

// Helper: Safe LocalStorage Set to prevent "Quota Exceeded" crash
const safeLocalStorageSet = (key: string, value: string) => {
    try {
        localStorage.setItem(key, value);
    } catch (e) {
        console.warn(`LocalStorage quota exceeded for ${key}. Data not cached locally, but will work in memory.`);
        // Optional: Clear specific keys to make space if needed
        // localStorage.removeItem('pb_concepts'); 
    }
};

const App: React.FC = () => {
  const [currentPage, setCurrentPage] = useState<AppState>(AppState.LANDING);
  const [selectedConcept, setSelectedConcept] = useState<Concept | null>(null);
  const [capturedImage, setCapturedImage] = useState<string | null>(null);
  const [settings, setSettings] = useState<PhotoboothSettings>(DEFAULT_SETTINGS);
  const [concepts, setConcepts] = useState<Concept[]>(DEFAULT_CONCEPTS);
  const autoResetTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Regeneration Quality State
  const [regenUltraQuality, setRegenUltraQuality] = useState(false);
  
  // Session State for Regeneration (To keep same folder)
  const [currentSession, setCurrentSession] = useState<{id: string, url: string} | null>(null);

  // Background Processing State
  const [notifications, setNotifications] = useState<ProcessNotification[]>([]);

  // Gallery Cache State (New)
  const [galleryCache, setGalleryCache] = useState<GalleryItem[]>([]);

  // --- GLOBAL TICKER FOR VIDEO PROCESSING ---
  useEffect(() => {
     if (settings.boothMode !== 'video') return;

     const runTick = async () => {
         try {
             const res = await fetch('/api/video/tick');
             const contentType = res.headers.get("content-type");
             if (res.ok && contentType && contentType.includes("application/json")) {
                 try {
                     const data = await res.json();
                     if (data.report && (data.report.processed > 0 || data.report.started > 0)) {
                        console.log("Global Tick Report:", data.report);
                     }
                 } catch (parseError) {}
             }
         } catch (err) {}
     };

     runTick();
     const tickInterval = setInterval(runTick, 5000);
     return () => clearInterval(tickInterval);
  }, [settings.boothMode]);

  useEffect(() => {
    const currentStoredUrl = localStorage.getItem('APPS_SCRIPT_BASE_URL');
    if (currentStoredUrl !== DEFAULT_GAS_URL) {
       console.log("Updating APPS_SCRIPT_BASE_URL to new default:", DEFAULT_GAS_URL);
       localStorage.setItem('APPS_SCRIPT_BASE_URL', DEFAULT_GAS_URL);
    }

    const savedSettings = localStorage.getItem('pb_settings');
    const savedConcepts = localStorage.getItem('pb_concepts');
    if (savedSettings) setSettings(JSON.parse(savedSettings));
    if (savedConcepts) setConcepts(JSON.parse(savedConcepts));
    
    const syncCloud = async () => {
      try {
        const res = await fetchSettings();
        if (res.ok) {
          setSettings(prev => ({ ...prev, ...res.settings }));
          if (res.concepts && Array.isArray(res.concepts)) {
            setConcepts(res.concepts);
            // Use safe setter
            safeLocalStorageSet('pb_concepts', JSON.stringify(res.concepts));
          }
        }
        
        const events = await fetchEvents();
        const active = events.find(e => e.isActive);
        if (active) {
          setSettings(prev => ({
            ...prev,
            eventName: active.name,
            eventDescription: active.description,
            folderId: active.folderId,
            activeEventId: active.id
          }));
        }
      } catch (e) {
        console.warn("Cloud sync error:", e);
      }
    };
    syncCloud();
  }, []);

  useEffect(() => {
    if (autoResetTimer.current) clearTimeout(autoResetTimer.current);
    if (currentPage === AppState.RESULT) {
      autoResetTimer.current = setTimeout(() => { handleReset(); }, settings.autoResetTime * 1000);
    }
    return () => { if (autoResetTimer.current) clearTimeout(autoResetTimer.current); };
  }, [currentPage, settings.autoResetTime]);

  const handleReset = () => {
    setCurrentPage(AppState.LANDING);
    setSelectedConcept(null);
    setCapturedImage(null);
    setRegenUltraQuality(false);
    setCurrentSession(null); 
  };

  const handleRegenerate = (image: string, concept: Concept, useUltra: boolean = false, sessionData?: {id: string, url: string}) => {
    setCapturedImage(image);
    setSelectedConcept(concept);
    setRegenUltraQuality(useUltra);
    if (sessionData) {
        setCurrentSession(sessionData);
    }
    setCurrentPage(AppState.GENERATING);
  };

  const handleUpdateSettings = (newSettings: PhotoboothSettings) => {
      setSettings(newSettings);
      safeLocalStorageSet('pb_settings', JSON.stringify(newSettings));
  };

  // Helper for concepts saving from Admin
  const handleUpdateConcepts = (newConcepts: Concept[]) => {
      setConcepts(newConcepts);
      safeLocalStorageSet('pb_concepts', JSON.stringify(newConcepts));
  };

  const handleCapture = (image: string) => {
    setCapturedImage(image);
    setRegenUltraQuality(false); 
    setCurrentSession(null); 
    
    if (settings.processingMode === 'fast') {
      // In Fast Mode, we pass the image to the background queue immediately
      processInBackground(image, selectedConcept!);
      setCurrentPage(AppState.FAST_THANKS);
    } else {
      setCurrentPage(AppState.GENERATING);
    }
  };

  // --- FAST MODE QUEUE IMPLEMENTATION ---
  const processInBackground = (base64Image: string, concept: Concept) => {
      const jobId = Date.now().toString();
      
      // 1. Update UI Notification immediately (Status: Queued/Processing)
      const newNotif: ProcessNotification = {
          id: jobId,
          thumbnail: concept.thumbnail,
          conceptName: concept.name,
          status: 'processing', // Visual indicator remains 'processing' even if queued
          timestamp: Date.now()
      };
      setNotifications(prev => [newNotif, ...prev].slice(0, 5)); 

      // 2. Add to Singleton Queue
      aiQueue.add(async () => {
          console.log(`[Queue] Starting Job ${jobId} | Concept: ${concept.name}`);
          
          try {
            // A. Upload Original (Optional)
            let originalId: string | null = null;
            if (settings.originalFolderId && settings.originalFolderId.trim() !== "") {
                try {
                    const origRes = await uploadToDrive(base64Image, {
                      conceptName: "ORIGINAL_CAPTURE",
                      eventName: settings.eventName,
                      eventId: settings.activeEventId,
                      folderId: settings.originalFolderId,
                      skipGallery: true 
                    });
                    if (origRes.ok) originalId = origRes.id;
                } catch(e) { console.warn("Background: Original upload failed"); }
            }

            // B. AI Generation
            // Use local variable 'base64Image' from closure
            const aiOutput = await generateAIImage(base64Image, concept, settings.outputRatio);

            // C. Overlay Composition
            let targetWidth = 1080;
            let targetHeight = 1920;
            if (settings.outputRatio === '16:9') { targetWidth = 1920; targetHeight = 1080; }
            else if (settings.outputRatio === '3:2') { targetWidth = 1800; targetHeight = 1200; }
            else if (settings.outputRatio === '2:3') { targetWidth = 1200; targetHeight = 1800; }

            const finalImage = await applyOverlay(aiOutput, settings.overlayImage, targetWidth, targetHeight);

            // D. Upload Final Result
            const res = await uploadToDrive(finalImage, {
                conceptName: concept.name,
                eventName: settings.eventName,
                eventId: settings.activeEventId,
                folderId: settings.folderId,
                originalId: originalId || undefined,
            });

            if (res.ok) {
                console.log(`[Queue] Job ${jobId} Completed`);
                setNotifications(prev => prev.map(n => n.id === jobId ? { ...n, status: 'completed' } : n));
                setTimeout(() => {
                    setNotifications(prev => prev.filter(n => n.id !== jobId));
                }, 10000);
            } else {
                throw new Error("Upload Failed");
            }

          } catch (e: any) {
            console.error(`[Queue] Job ${jobId} Failed:`, e);
            setNotifications(prev => prev.map(n => n.id === jobId ? { ...n, status: 'failed' } : n));
            setTimeout(() => {
                setNotifications(prev => prev.filter(n => n.id !== jobId));
            }, 10000);
          }
      }).catch((err) => {
          console.error("Queue Addition Error:", err);
      });
  };

  const renderPage = () => {
    switch (currentPage) {
      case AppState.LANDING:
        return <LandingPage onStart={() => setCurrentPage(AppState.THEMES)} onGallery={() => setCurrentPage(AppState.GALLERY)} onAdmin={() => setCurrentPage(AppState.ADMIN)} settings={settings} notifications={notifications} />;
      case AppState.THEMES:
        return <ThemesPage concepts={concepts} onSelect={(c) => { setSelectedConcept(c); setCurrentPage(AppState.CAMERA); }} onBack={() => setCurrentPage(AppState.LANDING)} />;
      case AppState.CAMERA:
        return <CameraPage 
            onCapture={handleCapture} 
            onGenerate={() => {/* Handled in onCapture */}} 
            onBack={() => setCurrentPage(AppState.THEMES)} 
            capturedImage={capturedImage} 
            orientation={settings.orientation} 
            cameraRotation={settings.cameraRotation}
            aspectRatio={settings.outputRatio}
            settings={settings} 
            onUpdateSettings={handleUpdateSettings} 
        />;
      case AppState.GENERATING:
        return <ResultPage 
            capturedImage={capturedImage!} 
            concept={selectedConcept!} 
            settings={settings} 
            concepts={concepts} 
            onDone={handleReset} 
            onGallery={() => setCurrentPage(AppState.GALLERY)} 
            isUltraQuality={regenUltraQuality}
            existingSession={currentSession} 
        />;
      case AppState.FAST_THANKS:
        return <FastThanksPage onDone={handleReset} />;
      case AppState.GALLERY:
        return (
            <GalleryPage 
                onBack={() => setCurrentPage(AppState.LANDING)} 
                activeEventId={settings.activeEventId} 
                onRegenerate={handleRegenerate} 
                concepts={concepts} 
                settings={settings} 
                notifications={notifications}
                cachedItems={galleryCache} 
                onUpdateCache={setGalleryCache} 
            />
        );
      case AppState.ADMIN:
        return <AdminPage settings={settings} concepts={concepts} onSaveSettings={handleUpdateSettings} onSaveConcepts={handleUpdateConcepts} onBack={() => setCurrentPage(AppState.LANDING)} onLaunchMonitor={() => setCurrentPage(AppState.MONITOR)} />;
      case AppState.MONITOR:
        return <MonitorPage onBack={() => setCurrentPage(AppState.ADMIN)} activeEventId={settings.activeEventId} eventName={settings.eventName} monitorSize={settings.monitorImageSize} theme={settings.monitorTheme} />;
      default:
        return <LandingPage onStart={() => setCurrentPage(AppState.THEMES)} onGallery={() => setCurrentPage(AppState.GALLERY)} onAdmin={() => setCurrentPage(AppState.ADMIN)} settings={settings} notifications={notifications} />;
    }
  };

  return (
    <div className="relative w-full min-h-screen bg-[#050505] flex flex-col items-center justify-start overflow-y-auto overflow-x-hidden font-sans">
      
      {/* --- GLOBAL BACKGROUND VIDEO --- */}
      {settings.backgroundVideoUrl && settings.backgroundVideoUrl.trim() !== '' && (
        <div className="fixed inset-0 z-0 pointer-events-none">
          <video 
            src={settings.backgroundVideoUrl}
            autoPlay 
            loop 
            muted 
            playsInline
            className="w-full h-full object-cover" 
          />
          <div className="absolute inset-0 bg-black/40 backdrop-blur-[2px]" />
        </div>
      )}

      {/* --- GLOBAL BACKGROUND IMAGE (Fallback if no video) --- */}
      {(!settings.backgroundVideoUrl || settings.backgroundVideoUrl.trim() === '') && settings.backgroundImage && (
        <div className="fixed inset-0 z-0 pointer-events-none">
          <img 
            src={getGoogleDriveDirectLink(settings.backgroundImage)} 
            className="w-full h-full object-cover" 
            alt="Global Background" 
          />
          <div className="absolute inset-0 bg-black/60 backdrop-blur-[2px]" />
        </div>
      )}

      {/* Default Decorative Background */}
      {(!settings.backgroundVideoUrl || settings.backgroundVideoUrl.trim() === '') && !settings.backgroundImage && (
        <div className="fixed top-0 left-0 w-full h-full pointer-events-none opacity-20 z-0">
            <div className="absolute top-[-10%] left-[-10%] w-[70%] h-[70%] bg-purple-600 blur-[150px] rounded-full" />
            <div className="absolute bottom-[-10%] right-[-10%] w-[70%] h-[70%] bg-blue-600 blur-[150px] rounded-full" />
        </div>
      )}

      <div className="relative z-10 w-full flex flex-col items-center">
        {renderPage()}
      </div>
    </div>
  );
};

export default App;
