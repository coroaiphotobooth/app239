import React, { useState } from 'react';
import { GalleryItem, Concept, PhotoboothSettings, ProcessNotification } from '../types';
import GalleryPage from './GalleryPage';
import VideoGalleryPage from './VideoGalleryPage';

export type GalleryTab = 'photos' | 'videos';

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

// Reusable Tab Switcher Component
export const GalleryTabSwitcher: React.FC<{
  activeTab: GalleryTab;
  onTabChange: (tab: GalleryTab) => void;
}> = ({ activeTab, onTabChange }) => (
  <div className="flex bg-black/40 backdrop-blur-md rounded-lg p-1 border border-white/10">
    <button
      onClick={() => onTabChange('photos')}
      className={`px-4 py-1.5 text-[10px] font-bold uppercase tracking-widest transition-all rounded-md ${
        activeTab === 'photos'
          ? 'bg-purple-600 text-white shadow-lg'
          : 'text-white/60 hover:text-white hover:bg-white/5'
      }`}
    >
      Photos
    </button>
    <button
      onClick={() => onTabChange('videos')}
      className={`px-4 py-1.5 text-[10px] font-bold uppercase tracking-widest transition-all rounded-md ${
        activeTab === 'videos'
          ? 'bg-purple-600 text-white shadow-lg'
          : 'text-white/60 hover:text-white hover:bg-white/5'
      }`}
    >
      Videos
    </button>
  </div>
);

const GalleryHub: React.FC<GalleryHubProps> = (props) => {
  const [activeTab, setActiveTab] = useState<GalleryTab>('photos');

  return (
    <>
      {activeTab === 'photos' ? (
        <GalleryPage {...props} activeTab={activeTab} onTabChange={setActiveTab} />
      ) : (
        <VideoGalleryPage {...props} activeTab={activeTab} onTabChange={setActiveTab} />
      )}
    </>
  );
};

export default GalleryHub;
