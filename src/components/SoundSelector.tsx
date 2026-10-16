import React, { useRef, useState } from 'react';
import { Play, Pause, Mic, Upload, Check, Trash2, Music, AlertCircle } from 'lucide-react';
import { SoundItem } from '../types';
import { previewSound, stopAlarmSound, invalidateSoundCache } from '../services/audioSynthesizer';
import { saveAudioBlob, deleteAudioBlob } from '../services/storage';

interface SoundSelectorProps {
  sounds: SoundItem[];
  selectedSoundId: string;
  volume: number;
  onSelectSound: (id: string) => void;
  onOpenRecorder: () => void;
  onAddSound: (sound: SoundItem) => void;
  onDeleteSound: (id: string) => void;
}

export const SoundSelector: React.FC<SoundSelectorProps> = ({
  sounds,
  selectedSoundId,
  volume,
  onSelectSound,
  onOpenRecorder,
  onAddSound,
  onDeleteSound,
}) => {
  const [playingId, setPlayingId] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<'all' | 'preset' | 'custom'>('all');
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const handleTogglePreview = async (sound: SoundItem, e: React.MouseEvent) => {
    e.stopPropagation();
    if (playingId === sound.id) {
      stopAlarmSound();
      setPlayingId(null);
      return;
    }

    setPlayingId(sound.id);
    try {
      await previewSound(sound, volume);
    } finally {
      setPlayingId(null);
    }
  };

  const handleFileUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    try {
      setErrorMessage(null);
      const id = 'up_' + Date.now();
      const soundItem: SoundItem = {
        id,
        name: `🎵 ${file.name.replace(/\.[^/.]+$/, '')}`,
        category: 'uploaded',
        dateAdded: Date.now(),
        audioBlob: file,
      };

      await saveAudioBlob(id, file);
      onAddSound(soundItem);
      onSelectSound(id);

      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
    } catch (err) {
      console.error('Gagal mengunggah berkas audio:', err);
      setErrorMessage('Gagal menyimpan file audio ke memori perangkat.');
    }
  };

  // Safe In-UI delete execution (no blocked window.confirm)
  const handleExecuteDelete = async (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      invalidateSoundCache(id);
      await deleteAudioBlob(id);
      onDeleteSound(id);
      if (selectedSoundId === id) {
        onSelectSound('preset_police');
      }
      setConfirmDeleteId(null);
    } catch (err) {
      console.error('Gagal menghapus audio:', err);
      setErrorMessage('Gagal menghapus suara dari memori perangkat.');
    }
  };

  const filteredSounds = sounds.filter((s) => {
    if (activeTab === 'preset') return s.category === 'preset';
    if (activeTab === 'custom') return s.category === 'recorded' || s.category === 'uploaded';
    return true;
  });

  return (
    <div className="rounded-3xl bg-slate-900/90 border border-slate-800 p-5 shadow-xl backdrop-blur-md">
      {/* Header & Action Buttons */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-4 border-b border-slate-800/80">
        <div>
          <h2 className="text-base font-bold text-white flex items-center gap-2">
            <Music className="w-5 h-5 text-indigo-400" />
            Pilihan Suara Alarm
          </h2>
          <p className="text-xs text-slate-400 mt-0.5">
            Pilih suara bawaan, suara rekamanmu sendiri, atau unggah audio dari HP
          </p>
        </div>

        <div className="flex items-center gap-2">
          {/* Record Own Voice button */}
          <button
            onClick={onOpenRecorder}
            className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-pink-500/20 text-pink-300 border border-pink-500/30 text-xs font-semibold hover:bg-pink-500/30 transition active:scale-95"
          >
            <Mic className="w-4 h-4 text-pink-400" />
            <span>Rekam Suara</span>
          </button>

          {/* Upload file button */}
          <button
            onClick={() => fileInputRef.current?.click()}
            className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-blue-500/20 text-blue-300 border border-blue-500/30 text-xs font-semibold hover:bg-blue-500/30 transition active:scale-95"
          >
            <Upload className="w-4 h-4 text-blue-400" />
            <span>Unggah Audio</span>
          </button>
          <input
            type="file"
            ref={fileInputRef}
            onChange={handleFileUpload}
            accept="audio/*"
            className="hidden"
          />
        </div>
      </div>

      {/* Error alert banner */}
      {errorMessage && (
        <div className="mt-3 p-3 rounded-xl bg-red-950/80 border border-red-500/40 text-red-200 text-xs flex items-center justify-between">
          <span className="flex items-center gap-1.5">
            <AlertCircle className="w-4 h-4 text-red-400 shrink-0" />
            {errorMessage}
          </span>
          <button
            onClick={() => setErrorMessage(null)}
            className="text-red-400 hover:text-white font-bold ml-2"
          >
            ✕
          </button>
        </div>
      )}

      {/* Tabs */}
      <div className="flex gap-2 my-4">
        {[
          { key: 'all', label: `Semua (${sounds.length})` },
          { key: 'preset', label: 'Bawaan' },
          {
            key: 'custom',
            label: `Kustom Saya (${sounds.filter((s) => s.category !== 'preset').length})`,
          },
        ].map((tab) => (
          <button
            key={tab.key}
            onClick={() => setActiveTab(tab.key as any)}
            className={`px-3 py-1.5 rounded-xl text-xs font-medium transition ${
              activeTab === tab.key
                ? 'bg-indigo-600 text-white shadow-sm'
                : 'bg-slate-800 text-slate-400 hover:text-slate-200 hover:bg-slate-700/80'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Sound List Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 max-h-80 overflow-y-auto pr-1">
        {filteredSounds.map((sound) => {
          const isSelected = selectedSoundId === sound.id;
          const isPlaying = playingId === sound.id;
          const isConfirmingDelete = confirmDeleteId === sound.id;

          return (
            <div
              key={sound.id}
              onClick={() => {
                if (!isConfirmingDelete) {
                  onSelectSound(sound.id);
                }
              }}
              className={`group relative flex items-center justify-between p-3 rounded-2xl cursor-pointer border transition-all duration-200 ${
                isSelected
                  ? 'bg-indigo-950/60 border-indigo-500/80 shadow-md shadow-indigo-500/10'
                  : 'bg-slate-800/60 border-slate-700/60 hover:border-slate-600 hover:bg-slate-800'
              }`}
            >
              <div className="flex items-center gap-3 overflow-hidden">
                {/* Play / Preview button */}
                <button
                  type="button"
                  onClick={(e) => handleTogglePreview(sound, e)}
                  className={`w-9 h-9 shrink-0 rounded-xl flex items-center justify-center transition ${
                    isPlaying
                      ? 'bg-amber-500 text-slate-950 animate-pulse'
                      : isSelected
                      ? 'bg-indigo-600 text-white hover:bg-indigo-500'
                      : 'bg-slate-700 text-slate-300 hover:bg-slate-600'
                  }`}
                  title="Tes Dengarkan Suara"
                >
                  {isPlaying ? (
                    <Pause className="w-4 h-4 fill-current" />
                  ) : (
                    <Play className="w-4 h-4 fill-current ml-0.5" />
                  )}
                </button>

                {/* Sound Name & Metadata */}
                <div className="truncate">
                  <div className="flex items-center gap-1.5">
                    <span
                      className={`text-sm font-semibold truncate ${
                        isSelected ? 'text-white' : 'text-slate-200'
                      }`}
                    >
                      {sound.name}
                    </span>
                  </div>
                  <span className="text-[11px] text-slate-400 flex items-center gap-1">
                    {sound.category === 'recorded' && (
                      <span className="text-pink-400 font-medium">Rekaman Suara Pribadi</span>
                    )}
                    {sound.category === 'uploaded' && (
                      <span className="text-blue-400 font-medium">File Memori Perangkat</span>
                    )}
                    {sound.category === 'preset' && <span>Suara Sistem Bawaan</span>}
                  </span>
                </div>
              </div>

              {/* Status and Action Icons */}
              <div className="flex items-center gap-2 pl-2 shrink-0">
                {/* Custom Delete with Safe In-UI Confirmation */}
                {sound.category !== 'preset' && (
                  <>
                    {isConfirmingDelete ? (
                      <div
                        className="flex items-center gap-1 p-1 rounded-xl bg-red-950/90 border border-red-500/80 animate-in fade-in"
                        onClick={(e) => e.stopPropagation()}
                      >
                        <span className="text-[10px] text-red-200 font-bold px-1">Hapus?</span>
                        <button
                          type="button"
                          onClick={(e) => handleExecuteDelete(sound.id, e)}
                          className="px-2 py-0.5 rounded-lg bg-red-600 hover:bg-red-500 text-white text-[10px] font-bold shadow transition"
                        >
                          Ya
                        </button>
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            setConfirmDeleteId(null);
                          }}
                          className="px-1.5 py-0.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 text-[10px] transition"
                        >
                          Batal
                        </button>
                      </div>
                    ) : (
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          setConfirmDeleteId(sound.id);
                        }}
                        className="p-1.5 rounded-lg text-slate-400 hover:text-red-400 hover:bg-red-500/10 transition"
                        title="Hapus dari memori perangkat"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    )}
                  </>
                )}

                {/* Selection Indicator */}
                {!isConfirmingDelete && (
                  isSelected ? (
                    <div className="w-6 h-6 rounded-full bg-indigo-500 text-white flex items-center justify-center shadow">
                      <Check className="w-3.5 h-3.5 stroke-[3]" />
                    </div>
                  ) : (
                    <div className="w-6 h-6 rounded-full border border-slate-600 flex items-center justify-center text-transparent group-hover:border-slate-500">
                      <Check className="w-3.5 h-3.5" />
                    </div>
                  )
                )}
              </div>
            </div>
          );
        })}
      </div>

      {filteredSounds.length === 0 && (
        <div className="text-center py-8 text-slate-400 text-xs">
          Belum ada suara kustom. Rekam suaramu atau unggah file musik dari HP!
        </div>
      )}
    </div>
  );
};
