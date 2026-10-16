import React, { useEffect, useState } from 'react';
import { BellOff, Volume2, Smartphone, Radio, CheckCircle2, AlertTriangle } from 'lucide-react';
import { SoundItem } from '../types';
import { PhoneRadarLogo } from './PhoneRadarLogo';

interface AlarmActiveModalProps {
  isOpen: boolean;
  onStop: () => void;
  activeSound: SoundItem;
  remainingSeconds: number;
}

export const AlarmActiveModal: React.FC<AlarmActiveModalProps> = ({
  isOpen,
  onStop,
  activeSound,
  remainingSeconds,
}) => {
  const [flashPhase, setFlashPhase] = useState(false);

  useEffect(() => {
    if (isOpen) {
      const flashTimer = setInterval(() => {
        setFlashPhase((prev) => !prev);
      }, 400);

      // Support shake-to-stop if device supports DeviceMotionEvent
      const handleMotion = (event: DeviceMotionEvent) => {
        const acc = event.accelerationIncludingGravity;
        if (acc && (Math.abs(acc.x || 0) > 18 || Math.abs(acc.y || 0) > 18 || Math.abs(acc.z || 0) > 18)) {
          onStop();
        }
      };

      if (typeof window !== 'undefined' && 'DeviceMotionEvent' in window) {
        window.addEventListener('devicemotion', handleMotion);
      }

      return () => {
        clearInterval(flashTimer);
        if (typeof window !== 'undefined' && 'DeviceMotionEvent' in window) {
          window.removeEventListener('devicemotion', handleMotion);
        }
      };
    }
  }, [isOpen, onStop]);

  if (!isOpen) return null;

  return (
    <div
      className={`fixed inset-0 z-50 flex flex-col items-center justify-between p-6 transition-colors duration-300 ${
        flashPhase ? 'bg-red-600' : 'bg-slate-950'
      }`}
    >
      {/* Top Banner */}
      <div className="w-full flex items-center justify-between text-white pt-4">
        <div className="flex items-center gap-2">
          <span className="animate-ping w-3 h-3 rounded-full bg-yellow-400" />
          <span className="text-xs font-mono font-bold tracking-widest uppercase">
            ALARM BERBUNYI ({remainingSeconds}s)
          </span>
        </div>
        <div className="flex items-center gap-1.5 text-xs bg-black/40 px-3 py-1.5 rounded-full border border-white/20">
          <AlertTriangle className="w-4 h-4 text-yellow-300" />
          <span>Tepukan Terdeteksi!</span>
        </div>
      </div>

      {/* Center Phone Found Visual */}
      <div className="my-auto flex flex-col items-center text-center max-w-sm px-4">
        <div className="relative mb-6">
          <div className="absolute inset-0 rounded-full bg-cyan-400/30 blur-2xl animate-ping" />
          <div className="relative w-36 h-36 rounded-3xl bg-slate-900 border-2 border-cyan-400/60 text-cyan-400 flex items-center justify-center shadow-2xl shadow-cyan-500/50 p-4">
            <PhoneRadarLogo className="w-24 h-24" isListening={true} />
          </div>
        </div>

        <h1 className="text-3xl sm:text-4xl font-black text-white tracking-tight drop-shadow-md">
          HP DITEMUKAN!
        </h1>
        <p className="mt-2 text-sm sm:text-base font-medium text-white/90">
          Sedang memutar suara: <br />
          <strong className="text-yellow-300 text-lg">{activeSound.name}</strong>
        </p>

        <div className="mt-4 inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-black/30 text-white/80 text-xs">
          <span>Goyangkan HP atau ketuk tombol stop di bawah</span>
        </div>
      </div>

      {/* Big STOP Button */}
      <div className="w-full max-w-md pb-6">
        <button
          type="button"
          onClick={onStop}
          className="w-full flex items-center justify-center gap-3 py-5 rounded-3xl bg-white text-slate-950 font-black text-lg sm:text-xl shadow-2xl hover:bg-yellow-300 active:scale-95 transition-all duration-150"
        >
          <BellOff className="w-7 h-7 text-red-600 fill-red-600" />
          <span>HENTIKAN ALARM (STOP)</span>
        </button>
      </div>
    </div>
  );
};
