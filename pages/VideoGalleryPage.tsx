import React, { useEffect, useState, useRef, useCallback } from 'react';
import { GalleryItem, Concept, PhotoboothSettings, ProcessNotification } from '../types';
import { fetchGallery } from '../lib/appsScript';
import { GalleryTabSwitcher, GalleryTab } from './GalleryHub';

interface VideoGalleryPageProps {
  onBack: () => void;
  activeEventId?: string;
  onRegenerate: (image: string, concept: Concept, useUltra: boolean, sessionData?: {id: string, url: string}) => void;
  concepts: Concept[];
  settings?: PhotoboothSettings;
  notifications?: ProcessNotification[];
  cachedItems: GalleryItem[];
  onUpdateCache: (items: GalleryItem[]) => void;
  activeTab?: GalleryTab;
  onTabChange?: (tab: GalleryTab) => void;
}

// Get video play URL (proxy to avoid CORS)
const getVideoPlayUrl = (item: GalleryItem): string => {
  if (item.providerUrl) {
    console.log("[v0] Video using providerUrl:", item.providerUrl);
    return `/api/video/proxy?url=${encodeURIComponent(item.providerUrl)}`;
  }
  if (item.videoFileId) {
    const targetUrl = `https://drive.google.com/uc?export=download&id=${item.videoFileId}`;
    console.log("[v0] Video using videoFileId:", item.videoFileId, "->", targetUrl);
    return `/api/video/proxy?url=${encodeURIComponent(targetUrl)}`;
  }
  console.log("[v0] Video has no providerUrl or videoFileId:", item);
  return '';
};

// Get thumbnail URL
const getImageUrl = (item: GalleryItem): string => {
  if (item.imageUrl && item.imageUrl.startsWith('http')) {
    if (item.imageUrl.includes('lh3.googleusercontent.com')) {
      return `https://drive.google.com/thumbnail?id=${item.id}&sz=w400`;
    }
    return item.imageUrl;
  }
  return `https://drive.google.com/thumbnail?id=${item.id}&sz=w400`;
};

// Video Card Component with IntersectionObserver
const VideoCard: React.FC<{
  item: GalleryItem;
  canPlay: boolean;
  onVisibilityChange: (id: string, isVisible: boolean) => void;
}> = ({ item, canPlay, onVisibilityChange }) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const [isVisible, setIsVisible] = useState(false);
  const [isPlaying, setIsPlaying] = useState(false);
  const [hasError, setHasError] = useState(false);

  // IntersectionObserver: 60% visibility threshold
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const observer = new IntersectionObserver(
      (entries) => {
        const entry = entries[0];
        const visible = entry.isIntersecting && entry.intersectionRatio >= 0.6;
        setIsVisible(visible);
        onVisibilityChange(item.id, visible);
      },
      { threshold: [0, 0.6, 1] }
    );

    observer.observe(container);
    return () => observer.disconnect();
  }, [item.id, onVisibilityChange]);

  // Play/Pause based on visibility + canPlay slot
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    if (isVisible && canPlay && !hasError) {
      video.play().then(() => setIsPlaying(true)).catch(() => {});
    } else {
      video.pause();
      setIsPlaying(false);
    }
  }, [isVisible, canPlay, hasError]);

  const videoUrl = getVideoPlayUrl(item);

  return (
    <div
      ref={containerRef}
      className="group relative aspect-[9/16] overflow-hidden bg-black/40 border border-white/10 rounded-lg backdrop-blur-sm transition-all hover:border-green-500/50 hover:shadow-[0_0_20px_rgba(34,197,94,0.3)]"
    >
      {/* Thumbnail (shows when not playing) */}
      {!isPlaying && (
        <img
          src={getImageUrl(item)}
          alt={item.conceptName}
          loading="lazy"
          className="absolute inset-0 w-full h-full object-cover"
        />
      )}

      {/* Video Element */}
      {videoUrl && (
        <video
          ref={videoRef}
          src={videoUrl}
          preload="metadata"
          muted
          playsInline
          loop
          onError={(e) => {
            console.log("[v0] Video error for item:", item.id, "URL:", videoUrl, "Event:", e);
            setHasError(true);
          }}
          className={`absolute inset-0 w-full h-full object-cover transition-opacity duration-300 ${
            isPlaying ? 'opacity-100' : 'opacity-0'
          }`}
        />
      )}

      {/* Error State */}
      {hasError && (
        <div className="absolute inset-0 flex items-center justify-center bg-black/60">
          <span className="text-red-400 text-[10px] font-mono uppercase">Video Unavailable</span>
        </div>
      )}

      {/* Play Indicator */}
      {!isPlaying && !hasError && (
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
          <div className="w-12 h-12 rounded-full bg-black/60 backdrop-blur flex items-center justify-center border border-white/20">
            <svg className="w-5 h-5 text-white ml-1" fill="currentColor" viewBox="0 0 24 24">
              <path d="M8 5v14l11-7z" />
            </svg>
          </div>
        </div>
      )}

      {/* Video Ready Badge */}
      <div className="absolute top-2 right-2 z-10">
        <div className="bg-green-600/90 backdrop-blur text-white text-[8px] font-bold px-2 py-1 rounded shadow-lg flex items-center gap-1 border border-green-400/50">
          <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
          </svg>
          <span>VIDEO</span>
        </div>
      </div>

      {/* Bottom Gradient + Title */}
      <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black via-black/60 to-transparent p-3 pt-8">
        <p className="text-white text-[10px] font-mono truncate">{item.conceptName}</p>
        <p className="text-white/50 text-[8px] font-mono">
          {new Date(item.createdAt).toLocaleDateString()}
        </p>
      </div>
    </div>
  );
};

const VideoGalleryPage: React.FC<VideoGalleryPageProps> = ({
  onBack,
  activeEventId,
  cachedItems,
  onUpdateCache,
  activeTab = 'videos',
  onTabChange,
}) => {
  const [items, setItems] = useState<GalleryItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [visibleIds, setVisibleIds] = useState<Set<string>>(new Set());

  // Concurrent playback limit: 2 mobile, 4 desktop
  const maxConcurrent = typeof window !== 'undefined' && window.innerWidth < 768 ? 2 : 4;

  // Filter video items: videoStatus is "done" or "ready_url" AND has providerUrl or videoFileId
  const filterVideoItems = useCallback((data: GalleryItem[]): GalleryItem[] => {
    console.log("[v0] Total gallery items:", data.length);
    const videoItems = data.filter(
      (item) =>
        (item.videoStatus === 'done' || item.videoStatus === 'ready_url') &&
        (item.providerUrl || item.videoFileId)
    );
    console.log("[v0] Filtered video items:", videoItems.length, videoItems.map(i => ({
      id: i.id,
      videoStatus: i.videoStatus,
      providerUrl: i.providerUrl,
      videoFileId: i.videoFileId
    })));
    return videoItems;
  }, []);

  // Load gallery
  useEffect(() => {
    let isMounted = true;

    const loadVideos = async () => {
      try {
        const response = await fetchGallery(activeEventId);
        const data = response.items || [];
        const videoItems = filterVideoItems(data);

        if (isMounted) {
          setItems(videoItems);
          setLoading(false);
        }
      } catch (err) {
        console.error('Video gallery fetch error:', err);
        if (isMounted) setLoading(false);
      }
    };

    // Initial load from cache
    const cachedVideos = filterVideoItems(cachedItems);
    if (cachedVideos.length > 0) {
      setItems(cachedVideos);
      setLoading(false);
    }

    loadVideos();

    // Poll every 10s
    const pollInterval = setInterval(loadVideos, 10000);

    return () => {
      isMounted = false;
      clearInterval(pollInterval);
    };
  }, [activeEventId, cachedItems, filterVideoItems]);

  // Handle visibility changes
  const handleVisibilityChange = useCallback((id: string, isVisible: boolean) => {
    setVisibleIds((prev) => {
      const next = new Set(prev);
      if (isVisible) {
        next.add(id);
      } else {
        next.delete(id);
      }
      return next;
    });
  }, []);

  // Determine which videos can play (first N visible)
  const playableIds = Array.from(visibleIds).slice(0, maxConcurrent);

  return (
    <div className="w-full min-h-screen flex flex-col p-6 md:p-12 bg-transparent overflow-y-auto font-sans">
      {/* Header */}
      <div className="flex flex-col md:flex-row justify-between items-center w-full mb-8 max-w-7xl mx-auto gap-6 shrink-0">
        <button
          onClick={onBack}
          className="text-white flex items-center gap-3 hover:text-purple-400 uppercase tracking-[0.3em] font-bold transition-all group shrink-0 bg-black/20 backdrop-blur px-4 py-2 rounded-lg"
        >
          <svg
            className="w-6 h-6 transform group-hover:-translate-x-2 transition-transform"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
          </svg>
          BACK
        </button>
        <div className="flex items-center gap-4">
          <h2 className="text-3xl md:text-5xl font-heading text-white neon-text italic uppercase tracking-tighter text-center bg-black/20 backdrop-blur-sm px-6 py-2 rounded-lg">
            GALLERY
          </h2>
          {onTabChange && <GalleryTabSwitcher activeTab={activeTab} onTabChange={onTabChange} />}
        </div>
        <div className="w-[100px] shrink-0" /> {/* Spacer for alignment */}
      </div>

      {/* Content */}
      <div className="flex-1 max-w-7xl mx-auto w-full px-2">
        {loading && items.length === 0 ? (
          <div className="flex justify-center mt-20">
            <div className="w-16 h-16 border-4 border-purple-500 rounded-full animate-spin border-t-transparent" />
          </div>
        ) : items.length === 0 ? (
          <div className="flex flex-col items-center justify-center mt-20 text-center">
            <svg className="w-16 h-16 text-white/20 mb-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={1.5}
                d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z"
              />
            </svg>
            <p className="text-white/40 text-sm font-mono uppercase tracking-widest">No Videos Available</p>
            <p className="text-white/20 text-xs mt-2">Videos will appear here once processing is complete</p>
          </div>
        ) : (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 pb-32 animate-[popIn_0.5s_ease-out]">
            {items.map((item) => (
              <VideoCard
                key={item.id}
                item={item}
                canPlay={playableIds.includes(item.id)}
                onVisibilityChange={handleVisibilityChange}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

export default VideoGalleryPage;
