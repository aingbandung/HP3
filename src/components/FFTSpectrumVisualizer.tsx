import React, { useRef, useEffect, useState } from 'react';
import { Activity, Sparkles, CheckCircle2, Volume2, Waves, ListFilter, ShieldAlert, ChevronDown, ChevronUp, History } from 'lucide-react';
import { AudioDiagnostics, DetectionLogItem, DetectionStats, AppSettings } from '../types';

interface FFTSpectrumVisualizerProps {
  isListening: boolean;
  fftData: Uint8Array | null;
  currentVolume: number;
  thresholdLevel: number;
  stats: DetectionStats;
  settings: AppSettings;
  detectionLogs?: DetectionLogItem[];
}

export const FFTSpectrumVisualizer: React.FC<FFTSpectrumVisualizerProps> = ({
  isListening,
  fftData,
  currentVolume,
  thresholdLevel,
  stats,
  settings,
  detectionLogs = [],
}) => {
  const fftCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const peakHistoryRef = useRef<number[]>(new Array(48).fill(0));
  const [showLogsOverlay, setShowLogsOverlay] = useState(true);

  // Render real-time Fast Fourier Transform (FFT) spectrum bars
  useEffect(() => {
    const canvas = fftCanvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const width = canvas.width;
    const height = canvas.height;

    ctx.clearRect(0, 0, width, height);

    const barCount = 42;
    const barWidth = Math.floor(width / barCount) - 2;
    const peaks = peakHistoryRef.current;

    if (!isListening || !fftData || fftData.length === 0) {
      for (let i = 0; i < barCount; i++) {
        const x = i * (barWidth + 2);
        ctx.fillStyle = '#1e293b';
        ctx.fillRect(x, height - 3, barWidth, 3);
      }
      return;
    }

    const step = Math.max(1, Math.floor(fftData.length / barCount));

    for (let i = 0; i < barCount; i++) {
      const binIndex = Math.min(i * step, fftData.length - 1);
      const val = fftData[binIndex] / 255.0;
      const barHeight = Math.max(3, Math.round(val * (height - 8)));
      const x = i * (barWidth + 2);
      const y = height - barHeight;

      if (val > peaks[i]) {
        peaks[i] = val;
      } else {
        peaks[i] = Math.max(0, peaks[i] - 0.02);
      }

      let gradient = ctx.createLinearGradient(0, height, 0, y);
      if (i < 12) {
        gradient.addColorStop(0, '#059669'); // emerald
        gradient.addColorStop(1, '#10b981');
      } else if (i < 26) {
        gradient.addColorStop(0, '#2563eb'); // blue
        gradient.addColorStop(1, '#60a5fa');
      } else {
        gradient.addColorStop(0, '#d97706'); // amber
        gradient.addColorStop(1, '#f59e0b');
      }

      ctx.fillStyle = gradient;
      ctx.beginPath();
      ctx.roundRect(x, y, barWidth, barHeight, [2, 2, 0, 0]);
      ctx.fill();

      if (peaks[i] > 0.08) {
        const peakY = height - Math.round(peaks[i] * (height - 8));
        ctx.fillStyle = '#f8fafc';
        ctx.fillRect(x, Math.max(0, peakY - 2), barWidth, 2);
      }
    }
  }, [isListening, fftData]);

  const diag = stats.diagnostics;
  const recentEvent = diag?.recentEvent;

  // Target trigger dB from settings or fallback
  const targetTriggerDb =
    settings.targetTriggerDb !== undefined
      ? settings.targetTriggerDb
      : Math.round(54 - (settings.sensitivity / 100) * 42);

  return (
    <div className="rounded-3xl bg-slate-900/90 border border-slate-800 p-5 shadow-xl backdrop-blur-md space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between pb-3 border-b border-slate-800">
        <div className="flex items-center gap-2">
          <div className="p-1.5 rounded-lg bg-cyan-500/10 text-cyan-400">
            <Activity className="w-4 h-4" />
          </div>
          <div>
            <h3 className="text-xs font-bold uppercase tracking-wider text-white flex items-center gap-1.5">
              Visualisasi Spektrum FFT & Audio Log
              <span className="text-[9px] px-1.5 py-0.5 rounded bg-cyan-500/20 text-cyan-300 font-mono">
                REAL-TIME
              </span>
            </h3>
            <p className="text-[10px] text-slate-400">
              Analisis Fourier frekuensi suara & overlay 5 log deteksi terakhir
            </p>
          </div>
        </div>

        {/* Live Volume dB Badge */}
        <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-slate-800/80 border border-slate-700 text-xs font-mono font-bold text-cyan-400">
          <Volume2 className="w-3.5 h-3.5 text-cyan-400" />
          <span>{isListening ? `${currentVolume} dB` : 'OFF'}</span>
        </div>
      </div>

      {/* Real-time FFT Frequency Canvas */}
      <div className="space-y-1.5">
        <div className="flex items-center justify-between text-[10px] text-slate-400 px-1 font-mono">
          <span className="text-emerald-400">◄ Rendah (~100Hz)</span>
          <span className="text-blue-400">Vokal / Mid (~1.5kHz)</span>
          <span className="text-amber-400 font-semibold">Tepuk Snap (~5kHz) ►</span>
        </div>

        <div className="h-20 w-full bg-slate-950 rounded-2xl border border-slate-800 p-2 flex items-center justify-center overflow-hidden shadow-inner">
          <canvas
            ref={fftCanvasRef}
            width={440}
            height={64}
            className="w-full h-full block"
          />
        </div>
      </div>

      {/* Real-Time Volume Meter with Threshold Marker Pin */}
      <div className="space-y-1">
        <div className="flex items-center justify-between text-[11px]">
          <span className="text-slate-400 font-medium">Ambang Suara (Volume & Target Trigger):</span>
          <span className="text-slate-300 font-mono text-[10px]">
            Level: <strong className="text-cyan-300">{currentVolume} dB</strong> / Target Ambang:{' '}
            <strong className="text-amber-400">{targetTriggerDb} dB</strong>
          </span>
        </div>

        <div className="relative w-full h-3.5 bg-slate-950 rounded-full overflow-hidden border border-slate-800 p-0.5">
          <div
            className={`h-full rounded-full transition-all duration-75 ${
              currentVolume >= targetTriggerDb
                ? 'bg-gradient-to-r from-emerald-500 via-yellow-400 to-rose-500 shadow-md shadow-amber-500/50'
                : 'bg-gradient-to-r from-blue-600 to-cyan-400'
            }`}
            style={{ width: `${Math.min(100, Math.max(0, currentVolume))}%` }}
          />

          <div
            className="absolute top-0 bottom-0 w-1 bg-amber-400 z-10 shadow-[0_0_8px_#f59e0b]"
            style={{ left: `${targetTriggerDb}%` }}
            title={`Target trigger ambang: ${targetTriggerDb} dB`}
          />
        </div>
      </div>

      {/* Detection Logs Overlay (Last 5 Detected Events) */}
      <div className="rounded-2xl bg-slate-950/80 border border-slate-800/90 overflow-hidden shadow-md">
        <div className="p-3 bg-slate-900/60 border-b border-slate-800/80 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <History className="w-3.5 h-3.5 text-cyan-400" />
            <span className="text-xs font-bold text-white uppercase tracking-wider">
              Detection Logs (5 Peristiwa Terakhir)
            </span>
          </div>
          <button
            type="button"
            onClick={() => setShowLogsOverlay(!showLogsOverlay)}
            className="flex items-center gap-1 text-[11px] text-slate-400 hover:text-white transition px-2 py-0.5 rounded-lg bg-slate-800 border border-slate-700"
          >
            <span>{showLogsOverlay ? 'Sembunyikan' : 'Tampilkan'}</span>
            {showLogsOverlay ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
          </button>
        </div>

        {showLogsOverlay && (
          <div className="p-3 space-y-2">
            {detectionLogs.length > 0 ? (
              detectionLogs.slice(0, 5).map((log) => {
                let badgeColor = 'bg-slate-800 text-slate-300 border-slate-700';
                let icon = '⚡';

                if (log.type === 'clap_1') {
                  badgeColor = 'bg-amber-500/15 text-amber-300 border-amber-500/30';
                  icon = '👏';
                } else if (log.type === 'clap_2' || log.type === 'single_clap') {
                  badgeColor = 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30';
                  icon = '🎉';
                } else if (log.type === 'voice') {
                  badgeColor = 'bg-blue-500/15 text-blue-300 border-blue-500/30';
                  icon = '🗣️';
                } else if (log.type === 'rejected_sustained') {
                  badgeColor = 'bg-red-500/15 text-red-300 border-red-500/30';
                  icon = '🛡️';
                } else if (log.type === 'valley_detected') {
                  badgeColor = 'bg-indigo-500/15 text-indigo-300 border-indigo-500/30';
                  icon = '⏳';
                }

                return (
                  <div
                    key={log.id}
                    className={`flex items-start justify-between gap-2 p-2 rounded-xl border text-xs transition-all ${badgeColor}`}
                  >
                    <div className="flex items-start gap-2">
                      <span className="text-sm shrink-0 leading-none mt-0.5">{icon}</span>
                      <div>
                        <div className="font-semibold text-slate-100">{log.label}</div>
                        {log.details && (
                          <div className="text-[10px] text-slate-400 mt-0.5 font-mono">
                            {log.details}
                          </div>
                        )}
                      </div>
                    </div>
                    <span className="text-[10px] font-mono text-slate-400 shrink-0">
                      {log.time}
                    </span>
                  </div>
                );
              })
            ) : (
              <div className="py-4 text-center text-xs text-slate-500 italic">
                Belum ada tepukan atau suara terdaftar. Coba tepuk tangan untuk melihat log di sini.
              </div>
            )}
          </div>
        )}
      </div>

      {/* Real-Time Acoustic Metrics (Crest Factor, High/Low Ratio) */}
      {diag && (
        <div className="grid grid-cols-3 gap-2 pt-2 border-t border-slate-800/60 text-[10px] text-slate-400 font-mono">
          <div className="bg-slate-950/60 p-2 rounded-xl border border-slate-800 text-center">
            <span className="block text-slate-500 text-[9px]">PUNCAK SUARA</span>
            <strong className="text-white text-xs font-mono">
              {Math.round(diag.peak * 100)} dB
            </strong>
          </div>

          <div className="bg-slate-950/60 p-2 rounded-xl border border-slate-800 text-center">
            <span className="block text-slate-500 text-[9px]">KETIRUSAN (CREST)</span>
            <strong
              className={`text-xs font-mono ${
                diag.crestFactor >= 2.0 ? 'text-emerald-400 font-bold' : 'text-slate-300'
              }`}
              title="Tepukan tangan memiliki Crest Factor > 2.0x"
            >
              {diag.crestFactor.toFixed(1)}x
            </strong>
          </div>

          <div className="bg-slate-950/60 p-2 rounded-xl border border-slate-800 text-center">
            <span className="block text-slate-500 text-[9px]">SNAP FREKUENSI</span>
            <strong
              className={`text-xs font-mono ${
                diag.highRatio >= 0.12 ? 'text-amber-400 font-bold' : 'text-slate-300'
              }`}
              title="Rasio frekuensi tinggi tepukan"
            >
              {diag.highRatio.toFixed(2)}
            </strong>
          </div>
        </div>
      )}
    </div>
  );
};
