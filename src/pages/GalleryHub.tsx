import React, { useState } from 'react';
import { GalleryItem, Concept, PhotoboothSettings, ProcessNotification } from '../types';
import GalleryPage from './GalleryPage';
import VideoGalleryPage from './VideoGalleryPage';

type GalleryTab = 'photos' | 'videos';

interface GalleryHubProps {
  onBack: () => void;
  activeEventId?: string;
  onRegenerate: (image: string, concept: Concept, useUltra: boolean, sessionData?: {id: string, url: string}) => void;
  concepts: Concept[];
  settings?: PhotoboothSettings;
  notifications?: ProcessNotification[];
  cachedItems: GalleryItem[];
  onUpdateCache: (items: GalleryItem[]) => void;
}

const GalleryHub: React.FC<GalleryHubProps> = (props) => {
  const [activeTab, setActiveTab] = useState<GalleryTab>('photos');

  return (
    <div className="w-full min-h-screen flex flex-col bg-transparent overflow-hidden">
      {/* Tab Switcher */}
      <div className="w-full flex justify-center pt-6 px-6 shrink-0 z-20">
        <div className="flex bg-black/40 backdrop-blur-md rounded-lg p-1 border border-white/10">
          <button
            onClick={() => setActiveTab('photos')}
            className={`px-6 py-2 text-xs font-bold uppercase tracking-widest transition-all rounded-md ${
              activeTab === 'photos'
                ? 'bg-purple-600 text-white shadow-lg'
                : 'text-white/60 hover:text-white hover:bg-white/5'
            }`}
          >
            Photos
          </button>
          <button
            onClick={() => setActiveTab('videos')}
            className={`px-6 py-2 text-xs font-bold uppercase tracking-widest transition-all rounded-md ${
              activeTab === 'videos'
                ? 'bg-purple-600 text-white shadow-lg'
                : 'text-white/60 hover:text-white hover:bg-white/5'
            }`}
          >
            Videos
          </button>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-hidden">
        {activeTab === 'photos' ? (
          <GalleryPage {...props} />
        ) : (
          <VideoGalleryPage {...props} />
        )}
      </div>
    </div>
  );
};

export default GalleryHub;
