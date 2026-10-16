import React from 'react';
import { Info, ShieldCheck, Volume2 } from 'lucide-react';
import { PWAInstallButton } from './PWAInstallButton';
import { PhoneRadarLogo } from './PhoneRadarLogo';

interface HeaderProps {
  isListening: boolean;
  onOpenGuide: () => void;
}

export const Header: React.FC<HeaderProps> = ({ isListening, onOpenGuide }) => {
  return (
    <header className="w-full flex items-center justify-between py-4 px-2 border-b border-slate-800/80 mb-6">
      {/* Brand logo & title */}
      <div className="flex items-center gap-3">
        <PhoneRadarLogo className="w-11 h-11" isListening={isListening} />
        <div>
          <h1 className="text-base sm:text-lg font-black tracking-tight text-white flex items-center gap-1.5 flex-wrap">
            Temukan HP <span className="text-xs font-semibold text-indigo-400">by Firdaus</span>
            <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-md bg-blue-500/20 text-blue-300 border border-blue-500/30">
              CLAP
            </span>
          </h1>
          <p className="text-[11px] text-slate-400">Tepuk tangan untuk temukan ponselmu</p>
        </div>
      </div>

      {/* Right Actions: PWA Install & Guide */}
      <div className="flex items-center gap-2">
        <PWAInstallButton />

        <button
          onClick={onOpenGuide}
          className="p-2 rounded-xl bg-slate-800 text-slate-300 hover:text-white hover:bg-slate-700 transition border border-slate-700"
          title="Panduan Background & Bantuan"
          aria-label="Panduan & Bantuan"
        >
          <Info className="w-4 h-4" />
        </button>
      </div>
    </header>
  );
};
