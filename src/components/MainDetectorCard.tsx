import React, { useRef, useEffect } from 'react';
import { Power, Radio, Shield, Sparkles, AlertCircle, Eye, Moon, CheckCircle2 } from 'lucide-react';
import { AppSettings, DetectionStats } from '../types';

interface MainDetectorCardProps {
  isListening: boolean;
  onToggleListening: () => void;
  stats: DetectionStats;
  settings: AppSettings;
  audioRawData: Uint8Array | null;
  activeSoundName: string;
  onSimulateClap: () => void;
  onTriggerAlarmTest: () => void;
  onOpenGuide: () => void;
  isWakeLockActive?: boolean;
}

export const MainDetectorCard: React.FC<MainDetectorCardProps> = ({
  isListening,
  onToggleListening,
  stats,
  settings,
  audioRawData,
  activeSoundName,
  onSimulateClap,
  onTriggerAlarmTest,
  onOpenGuide,
  isWakeLockActive,
}) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  // Render real-time live oscilloscope waveform
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const width = canvas.width;
    const height = canvas.height;

    ctx.clearRect(0, 0, width, height);

    if (!isListening || !audioRawData) {
      // Idle line
      ctx.beginPath();
      ctx.moveTo(0, height / 2);
      ctx.lineTo(width, height / 2);
      ctx.strokeStyle = '#334155';
      ctx.lineWidth = 2;
      ctx.stroke();
      return;
    }

    // Dynamic wave
    ctx.lineWidth = 2.5;
    ctx.strokeStyle = stats.waitingForSecondClap ? '#f59e0b' : '#38bdf8';
    ctx.shadowBlur = 8;
    ctx.shadowColor = stats.waitingForSecondClap ? 'rgba(245, 158, 11, 0.7)' : 'rgba(56, 189, 248, 0.6)';

    ctx.beginPath();
    const sliceWidth = width / audioRawData.length;
    let x = 0;

    for (let i = 0; i < audioRawData.length; i++) {
      const v = audioRawData[i] / 128.0;
      const y = (v * height) / 2;

      if (i === 0) {
        ctx.moveTo(x, y);
      } else {
        ctx.lineTo(x, y);
      }
      x += sliceWidth;
    }

    ctx.lineTo(width, height / 2);
    ctx.stroke();
    ctx.shadowBlur = 0;
  }, [isListening, audioRawData, stats.waitingForSecondClap]);

  return (
    <div className="relative overflow-hidden rounded-3xl bg-gradient-to-b from-slate-900 via-slate-900/95 to-slate-950 border border-slate-800 p-6 shadow-2xl backdrop-blur-xl">
      {/* Background ambient glow */}
      {isListening && (
        <div className="absolute -top-24 -left-24 w-80 h-80 rounded-full bg-blue-600/15 blur-3xl pointer-events-none animate-pulse" />
      )}
      {stats.waitingForSecondClap && (
        <div className="absolute -top-20 -right-20 w-80 h-80 rounded-full bg-amber-500/25 blur-3xl pointer-events-none animate-pulse" />
      )}

      {/* Top Status Bar */}
      <div className="flex items-center justify-between pb-5 border-b border-slate-800/80">
        <div className="flex items-center gap-2.5">
          <span className="relative flex h-3 w-3">
            {isListening ? (
              <>
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
                <span className="relative inline-flex rounded-full h-3 w-3 bg-emerald-500" />
              </>
            ) : (
              <span className="relative inline-flex rounded-full h-3 w-3 bg-slate-600" />
            )}
          </span>
          <span className="text-xs font-bold tracking-wide uppercase text-slate-300">
            {isListening ? (
              <span className="text-emerald-400 flex items-center gap-1.5">
                <Radio className="w-3.5 h-3.5 animate-pulse" />
                Siaga Mendengarkan Tepukan
              </span>
            ) : (
              'Deteksi Dinonaktifkan'
            )}
          </span>
        </div>

        {/* Background mode badge with 1-click HP configuration */}
        <button
          onClick={onOpenGuide}
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold transition border active:scale-95 ${
            isWakeLockActive
              ? 'bg-indigo-950/80 text-indigo-300 border-indigo-500/50 shadow-md shadow-indigo-500/20'
              : 'bg-slate-800 text-slate-300 hover:text-white hover:bg-slate-700 border-slate-700'
          }`}
          title="Klik untuk otomatis menyetel pengaturan HP agar aplikasi tetap berjalan di background"
        >
          <Moon className={`w-3.5 h-3.5 ${isWakeLockActive ? 'text-indigo-400 animate-pulse' : 'text-slate-400'}`} />
          <span>Mode Background</span>
          <span
            className={`w-2 h-2 rounded-full ${
              isWakeLockActive ? 'bg-emerald-400 shadow-sm shadow-emerald-400 animate-pulse' : 'bg-slate-500'
            }`}
          />
        </button>
      </div>

      {/* Centerpiece Glowing Power Button */}
      <div className="my-7 flex flex-col items-center justify-center">
        <div className="relative flex items-center justify-center">
          {/* Multi-layered Pulsing Radar Rings */}
          {isListening && (
            <>
              <div
                className="absolute w-52 h-52 rounded-full border border-blue-500/20 animate-ping"
                style={{ animationDuration: '3s' }}
              />
              <div
                className="absolute w-44 h-44 rounded-full border border-cyan-400/30 transition-transform duration-75"
                style={{ transform: `scale(${1 + stats.currentVolume / 150})` }}
              />
            </>
          )}

          <button
            type="button"
            onClick={onToggleListening}
            className={`group relative z-10 w-36 h-36 rounded-full flex flex-col items-center justify-center transition-all duration-300 active:scale-95 ${
              isListening
                ? 'bg-gradient-to-tr from-blue-600 via-indigo-600 to-cyan-500 text-white shadow-2xl shadow-blue-500/50 hover:shadow-blue-400/60'
                : 'bg-gradient-to-tr from-slate-800 to-slate-900 border-2 border-slate-700 text-slate-400 hover:text-slate-200 hover:border-slate-500 hover:shadow-xl'
            }`}
          >
            <Power
              className={`w-12 h-12 mb-1 transition-transform group-hover:scale-110 ${
                isListening ? 'text-white drop-shadow-[0_0_12px_rgba(255,255,255,0.8)]' : ''
              }`}
            />
            <span className="text-xs font-bold tracking-wider uppercase">
              {isListening ? 'AKTIF' : 'MULAI'}
            </span>
          </button>
        </div>

        {/* Live Sequence Status Message */}
        <div className="mt-5 text-center min-h-[44px] flex flex-col items-center justify-center">
          {isListening ? (
            stats.waitingForSecondClap ? (
              <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full bg-amber-500/20 text-amber-300 border border-amber-500/40 animate-bounce">
                <Sparkles className="w-4 h-4 text-amber-400" />
                <span className="text-xs font-bold">
                  👏 Tepukan ke-1 terdeteksi! Tepuk 1x lagi sekarang...
                </span>
              </div>
            ) : settings.detectionMode === 'voice_call' ? (
              <div className="space-y-1">
                <p className="text-xs text-indigo-300 font-semibold">
                  🗣️ Panggil: "{settings.voiceCallKeyword || 'Halo HP'}"
                </p>
                {stats.lastRecognizedWord ? (
                  <p className="text-[11px] text-emerald-400 font-medium">
                    {stats.lastRecognizedWord}
                  </p>
                ) : (
                  <p className="text-[11px] text-emerald-400/90 font-medium">
                    ✨ Hening tanpa suara "tung-tung" (seperti ngobrol dengan Gemini)
                  </p>
                )}
              </div>
            ) : (
              <p className="text-xs text-slate-300 font-medium">
                {settings.detectionMode === 'double_clap'
                  ? 'Tepuk tangan 2 kali berirama santai untuk memicu alarm'
                  : settings.detectionMode === 'single_clap'
                  ? 'Tepuk tangan 1 kali keras untuk memicu alarm'
                  : 'Keluarkan suara keras atau siulan untuk memicu alarm'}
              </p>
            )
          ) : (
            <p className="text-xs text-slate-400">
              Tekan tombol di atas untuk mengaktifkan pendengaran mikrofon
            </p>
          )}

          {/* Active Sound Indicator Pill */}
          <div className="mt-2.5 inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-slate-800/80 border border-slate-700/80 text-[11px] text-slate-300">
            <span className="text-slate-400">Suara Alarm:</span>
            <span className="font-semibold text-indigo-300 truncate max-w-[200px]">
              {activeSoundName}
            </span>
          </div>
        </div>
      </div>

      {/* Double Clap Sequence Indicators */}
      {settings.detectionMode === 'double_clap' && (
        <div className="flex items-center justify-center gap-6 py-2 mb-4 bg-slate-950/60 rounded-2xl border border-slate-800/80">
          <div className="flex items-center gap-2">
            <div
              className={`w-3.5 h-3.5 rounded-full transition-all duration-200 ${
                stats.clapsCount >= 1 || stats.waitingForSecondClap
                  ? 'bg-amber-400 shadow-[0_0_8px_#f59e0b]'
                  : 'bg-slate-700'
              }`}
            />
            <span className="text-xs font-semibold text-slate-300">Tepukan 1</span>
          </div>
          <div className="w-8 h-[1px] bg-slate-700" />
          <div className="flex items-center gap-2">
            <div
              className={`w-3.5 h-3.5 rounded-full transition-all duration-200 ${
                stats.clapsCount >= 2
                  ? 'bg-emerald-400 shadow-[0_0_8px_#10b981]'
                  : 'bg-slate-700'
              }`}
            />
            <span className="text-xs font-semibold text-slate-300">Tepukan 2 (Alarm!)</span>
          </div>
        </div>
      )}

      {/* Waveform Canvas */}
      <div className="space-y-1 mb-4">
        <div className="flex items-center justify-between text-[11px] text-slate-400 px-1">
          <span>Oskiloskop Suara Real-Time</span>
          <span className="font-mono text-cyan-400">
            {isListening ? `${stats.currentVolume}% dB` : 'Mati'}
          </span>
        </div>
        <div className="h-14 w-full bg-slate-950 rounded-2xl border border-slate-800 overflow-hidden flex items-center justify-center">
          <canvas
            ref={canvasRef}
            width={460}
            height={56}
            className="w-full h-full block"
          />
        </div>
      </div>

      {/* Test & Action Controls */}
      <div className="grid grid-cols-2 gap-2 pt-2 border-t border-slate-800">
        <button
          type="button"
          onClick={onSimulateClap}
          className="flex items-center justify-center gap-1.5 py-2.5 px-3 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-semibold transition active:scale-95 border border-slate-700"
          title="Uji coba sensor tanpa suara keras"
        >
          <span>
            {settings.detectionMode === 'voice_call' ? '🗣️ Simulasi Panggilan' : '👏 Simulasi Tepukan'}
          </span>
        </button>

        <button
          type="button"
          onClick={onTriggerAlarmTest}
          className="flex items-center justify-center gap-1.5 py-2.5 px-3 rounded-xl bg-gradient-to-r from-red-600 to-rose-600 hover:from-red-500 hover:to-rose-500 text-white text-xs font-semibold shadow-md shadow-red-600/20 transition active:scale-95"
          title="Tes suara alarm yang sedang dipilih"
        >
          <span>🚨 Uji Alarm Sekarang</span>
        </button>
      </div>
    </div>
  );
};
