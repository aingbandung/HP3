import React, { useState } from 'react';
import { Sliders, Volume2, Vibrate, Clock, Zap, MessageSquareQuote, Mic, Target, Sparkles, Check, Plus, Minus, RefreshCw } from 'lucide-react';
import { AppSettings, DetectionMode, SoundItem } from '../types';
import { clapDetector } from '../services/clapDetector';

interface SensitivityControlProps {
  settings: AppSettings;
  onChange: (updated: Partial<AppSettings>) => void;
  currentAudioLevel: number;
  customSounds: SoundItem[];
  onOpenRecorderForTrigger: () => void;
  lastRecognizedWord?: string;
  isListening?: boolean;
}

export const SensitivityControl: React.FC<SensitivityControlProps> = ({
  settings,
  onChange,
  currentAudioLevel,
  customSounds,
  onOpenRecorderForTrigger,
  lastRecognizedWord,
  isListening,
}) => {
  // Current Target Trigger dB (default 48 dB if not specified)
  const targetTriggerDb =
    settings.targetTriggerDb !== undefined
      ? settings.targetTriggerDb
      : Math.round(54 - (settings.sensitivity / 100) * 42);

  // Clapping Auto-Calibration state
  const [isCalibrating, setIsCalibrating] = useState(false);
  const [calibrationCountdown, setCalibrationCountdown] = useState(3.5);
  const [calibrationPeakLive, setCalibrationPeakLive] = useState(0);
  const [calibrationResult, setCalibrationResult] = useState<{ targetDb: number; maxPeak: number } | null>(null);

  const handleManualDbChange = (val: number) => {
    const clamped = Math.max(20, Math.min(95, Math.round(val)));
    // Inverse map to sensitivity (20 dB -> ~92% sensitivity, 80 dB -> ~20% sensitivity)
    const sens = Math.max(15, Math.min(95, Math.round(100 - (clamped - 20) * (80 / 60))));
    onChange({
      targetTriggerDb: clamped,
      sensitivity: sens,
    });
  };

  const startClappingAnalysis = async () => {
    setCalibrationResult(null);
    setIsCalibrating(true);
    setCalibrationCountdown(3.5);
    setCalibrationPeakLive(0);

    // If detector is not active, start it quietly
    if (!clapDetector.isListening()) {
      await clapDetector.start({
        onClapDetected: () => {},
        onAlarmTrigger: () => {},
        onAudioLevelUpdate: () => {},
        onError: () => {},
        onStateChange: () => {},
      });
    }

    clapDetector.startClapCalibration(
      3500,
      (remainingMs, currentDb) => {
        setCalibrationCountdown(Number((remainingMs / 1000).toFixed(1)));
        if (currentDb > calibrationPeakLive) {
          setCalibrationPeakLive(currentDb);
        }
      },
      (calculatedTargetDb, maxPeak) => {
        setIsCalibrating(false);
        setCalibrationResult({ targetDb: calculatedTargetDb, maxPeak });
        handleManualDbChange(calculatedTargetDb);
      }
    );
  };

  return (
    <div className="rounded-3xl bg-slate-900/90 border border-slate-800 p-5 shadow-xl backdrop-blur-md space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between pb-3 border-b border-slate-800/80">
        <div className="flex items-center gap-2">
          <Target className="w-5 h-5 text-amber-400" />
          <h2 className="text-base font-bold text-white">Target Trigger dB & Mode Deteksi</h2>
        </div>
        <span className="text-xs px-2.5 py-1 rounded-full bg-amber-500/10 text-amber-300 border border-amber-500/20 font-semibold font-mono">
          Target Ambang: {targetTriggerDb} dB
        </span>
      </div>

      {/* Detection Mode Selectors */}
      <div>
        <label className="block text-xs font-semibold text-slate-300 mb-2">
          Pilih Cara Menemukan HP:
        </label>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
          {[
            {
              id: 'double_clap',
              title: '👏 Tepukan 2x (Rekomendasi)',
              desc: 'Tepuk tangan dua kali berirama santai. Paling akurat dan tidak terganggu obrolan.',
              badge: 'Paling Akurat',
            },
            {
              id: 'voice_call',
              title: '🗣️ Panggilan Suara (Voice Call)',
              desc: 'Panggil HP langsung dengan suara. Hening tanpa suara "tung-tung", seperti ngobrol dengan Gemini.',
              badge: 'Populer',
            },
            {
              id: 'single_clap',
              title: '👏 Tepukan 1x',
              desc: 'Alarm langsung menyala dengan satu tepukan tangan keras.',
              badge: 'Instan',
            },
            {
              id: 'loud_sound',
              title: '🔊 Suara Keras / Peluit',
              desc: 'Bereaksi terhadap teriakan keras atau tiupan peluit berfrekuensi tinggi.',
              badge: 'Fleksibel',
            },
          ].map((mode) => {
            const isSelected = settings.detectionMode === mode.id;
            return (
              <button
                key={mode.id}
                type="button"
                onClick={() => onChange({ detectionMode: mode.id as DetectionMode })}
                className={`relative flex flex-col text-left p-3.5 rounded-2xl border transition-all duration-200 ${
                  isSelected
                    ? 'bg-blue-950/70 border-blue-500 shadow-md shadow-blue-500/20'
                    : 'bg-slate-800/50 border-slate-700/60 hover:bg-slate-800 hover:border-slate-600'
                }`}
              >
                <div className="flex items-center justify-between mb-1">
                  <span className={`text-xs font-bold ${isSelected ? 'text-white' : 'text-slate-200'}`}>
                    {mode.title}
                  </span>
                  {isSelected && (
                    <span className="text-[10px] font-semibold px-2 py-0.5 rounded-md bg-blue-500/20 text-blue-300 border border-blue-500/30">
                      Aktif
                    </span>
                  )}
                </div>
                <p className="text-[11px] text-slate-400 line-clamp-2 leading-relaxed">
                  {mode.desc}
                </p>
              </button>
            );
          })}
        </div>
      </div>

      {/* Voice Call Mode Configuration */}
      {settings.detectionMode === 'voice_call' && (
        <div className="p-4 rounded-2xl bg-indigo-950/40 border border-indigo-500/40 space-y-3.5 animate-in fade-in">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="text-xs font-bold text-indigo-200 flex items-center gap-1.5">
                <MessageSquareQuote className="w-4 h-4 text-indigo-400" />
                Kata Panggilan Suara
              </span>
              <span className="text-[10px] px-2 py-0.5 rounded-full bg-emerald-500/20 text-emerald-300 font-medium">
                ✨ Hening tanpa bunyi "tung-tung"
              </span>
            </div>
            <button
              type="button"
              onClick={onOpenRecorderForTrigger}
              className="flex items-center gap-1 px-2.5 py-1 rounded-lg bg-pink-500/20 text-pink-300 border border-pink-500/30 text-[11px] font-semibold hover:bg-pink-500/30 transition"
            >
              <Mic className="w-3.5 h-3.5 text-pink-400" />
              Rekam Panggilan Sendiri
            </button>
          </div>

          <div>
            <input
              type="text"
              value={settings.voiceCallKeyword}
              onChange={(e) => onChange({ voiceCallKeyword: e.target.value })}
              placeholder="Contoh: Halo HP atau Dimana Kamu"
              className="w-full rounded-xl bg-slate-950 border border-slate-700 px-3.5 py-2 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-indigo-400"
            />
          </div>

          <div className="flex flex-wrap gap-1.5">
            {['Halo HP', 'Dimana Kamu', 'Cari HP', 'Woi HP'].map((kw) => (
              <button
                key={kw}
                type="button"
                onClick={() => onChange({ voiceCallKeyword: kw })}
                className={`text-[11px] px-2.5 py-1 rounded-lg transition ${
                  settings.voiceCallKeyword.toLowerCase() === kw.toLowerCase()
                    ? 'bg-indigo-600 text-white font-medium shadow-sm'
                    : 'bg-slate-800 text-slate-300 hover:bg-slate-700'
                }`}
              >
                "{kw}"
              </button>
            ))}
          </div>

          {lastRecognizedWord && (
            <div className="p-2 rounded-xl bg-slate-900/80 border border-indigo-500/30 text-[11px] text-indigo-300 flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full bg-emerald-400 animate-ping" />
              <span>Mikrofon mendengar: <strong>"{lastRecognizedWord}"</strong></span>
            </div>
          )}
        </div>
      )}

      {/* Target Trigger DB Configuration (2 Options: Manual Box Value + Clapping Auto-Analysis) */}
      <div className="space-y-4 pt-2 border-t border-slate-800/80">
        <div className="flex items-center justify-between text-xs">
          <span className="font-bold text-white flex items-center gap-1.5 text-sm">
            <Target className="w-4 h-4 text-amber-400" />
            Pengaturan Target Trigger dB
          </span>
          <span className="text-[11px] text-slate-400">
            Ambang batas suara untuk memicu deteksi
          </span>
        </div>

        {/* Real-time Level vs Threshold Visual Bar */}
        <div className="space-y-1">
          <div className="relative h-6 w-full rounded-xl bg-slate-950 border border-slate-800 p-1 overflow-hidden">
            <div
              className={`h-full rounded-lg transition-all duration-75 ${
                currentAudioLevel >= targetTriggerDb
                  ? 'bg-gradient-to-r from-emerald-500 via-amber-400 to-rose-500 shadow-md shadow-amber-500/40'
                  : 'bg-gradient-to-r from-blue-600 to-cyan-400'
              }`}
              style={{ width: `${Math.min(100, currentAudioLevel)}%` }}
            />

            {/* Target Trigger Pin */}
            <div
              className="absolute top-0 bottom-0 w-1 bg-amber-400 shadow-[0_0_10px_#f59e0b] z-10 transition-all duration-100"
              style={{ left: `${targetTriggerDb}%` }}
            >
              <div className="absolute -top-1 -translate-x-1/2 w-3 h-2 bg-amber-400 rounded-t" />
            </div>

            <span className="absolute right-2 top-1 text-[10px] font-mono text-slate-300">
              Suara: <strong className="text-cyan-300">{currentAudioLevel} dB</strong> / Target Ambang:{' '}
              <strong className="text-amber-400">{targetTriggerDb} dB</strong>
            </span>
          </div>
        </div>

        {/* The Two Requested Options Grid */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-1">
          {/* OPSI 1: Box Value (Input Manual) */}
          <div className="p-3.5 rounded-2xl bg-slate-950/80 border border-slate-800 flex flex-col justify-between space-y-2.5">
            <div>
              <div className="text-xs font-bold text-white flex items-center justify-between">
                <span>Opsi 1: Input Manual (Box Value)</span>
                <span className="text-[10px] px-2 py-0.5 rounded bg-blue-500/20 text-blue-300 font-mono">
                  dB
                </span>
              </div>
              <p className="text-[11px] text-slate-400 mt-0.5">
                Ketik langsung nilai batas target desibel yang diinginkan:
              </p>
            </div>

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => handleManualDbChange(targetTriggerDb - 2)}
                className="w-9 h-9 rounded-xl bg-slate-800 hover:bg-slate-700 text-white flex items-center justify-center transition border border-slate-700 active:scale-95"
                title="Kurangi 2 dB"
              >
                <Minus className="w-4 h-4" />
              </button>

              <div className="relative flex-1">
                <input
                  type="number"
                  min="20"
                  max="95"
                  value={targetTriggerDb}
                  onChange={(e) => handleManualDbChange(Number(e.target.value))}
                  className="w-full h-9 rounded-xl bg-slate-900 border border-amber-500/40 text-center font-mono font-bold text-base text-amber-300 focus:outline-none focus:border-amber-400"
                  placeholder="48"
                />
                <span className="absolute right-2.5 top-2 text-[10px] text-slate-500 font-mono pointer-events-none">
                  dB
                </span>
              </div>

              <button
                type="button"
                onClick={() => handleManualDbChange(targetTriggerDb + 2)}
                className="w-9 h-9 rounded-xl bg-slate-800 hover:bg-slate-700 text-white flex items-center justify-center transition border border-slate-700 active:scale-95"
                title="Tambah 2 dB"
              >
                <Plus className="w-4 h-4" />
              </button>
            </div>
          </div>

          {/* OPSI 2: Analisa Clapping Otomatis */}
          <div className="p-3.5 rounded-2xl bg-gradient-to-br from-indigo-950/40 to-slate-950/80 border border-indigo-500/40 flex flex-col justify-between space-y-2.5">
            <div>
              <div className="text-xs font-bold text-white flex items-center justify-between">
                <span className="flex items-center gap-1.5">
                  <Sparkles className="w-3.5 h-3.5 text-amber-400" />
                  Opsi 2: Analisa Clapping
                </span>
                <span className="text-[10px] px-2 py-0.5 rounded bg-indigo-500/20 text-indigo-300 font-bold">
                  AUTO
                </span>
              </div>
              <p className="text-[11px] text-slate-400 mt-0.5">
                Hitung otomatis batas atas triger dari suara tepukan tangan Anda:
              </p>
            </div>

            <button
              type="button"
              onClick={startClappingAnalysis}
              disabled={isCalibrating}
              className={`w-full py-2.5 px-3 rounded-xl font-bold text-xs flex items-center justify-center gap-2 transition active:scale-95 shadow-md ${
                isCalibrating
                  ? 'bg-amber-600 text-white animate-pulse'
                  : 'bg-indigo-600 hover:bg-indigo-500 text-white shadow-indigo-600/25'
              }`}
            >
              {isCalibrating ? (
                <>
                  <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                  <span>Menganalisa... Silakan Tepuk Sekarang ({calibrationCountdown}s)</span>
                </>
              ) : (
                <>
                  <span>👏 Mulai Analisa Clapping</span>
                </>
              )}
            </button>
          </div>
        </div>

        {/* Live Calibration Banner & Results */}
        {isCalibrating && (
          <div className="p-3 rounded-2xl bg-amber-950/60 border border-amber-500/50 text-amber-200 text-xs flex items-center gap-3 animate-pulse">
            <span className="w-3 h-3 rounded-full bg-amber-400 animate-ping" />
            <div>
              <strong>👏 Silakan tepuk tangan sekarang di ruangan ini!</strong>
              <div className="text-[11px] text-amber-300/90 mt-0.5">
                Waktu tersisa: <strong>{calibrationCountdown} detik</strong>. Level puncak terdeteksi:{' '}
                <strong>{calibrationPeakLive} dB</strong>
              </div>
            </div>
          </div>
        )}

        {calibrationResult && !isCalibrating && (
          <div className="p-3 rounded-2xl bg-emerald-950/50 border border-emerald-500/40 text-emerald-200 text-xs flex items-center gap-2.5 animate-in fade-in">
            <Check className="w-4 h-4 text-emerald-400 shrink-0" />
            <div>
              <strong className="text-white">Analisa Clapping Berhasil!</strong>
              <p className="text-[11px] text-emerald-300/90 mt-0.5">
                Puncak suara tepukan terukur: <strong>{calibrationResult.maxPeak} dB</strong>. Batas ambang target otomatis disetel ke: <strong>{calibrationResult.targetDb} dB</strong>.
              </p>
            </div>
          </div>
        )}
      </div>

      {/* Hardware Settings: Vibration, Volume, Duration */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 pt-3 border-t border-slate-800">
        {/* Vibration Pattern */}
        <label className="flex items-center justify-between p-3 rounded-2xl bg-slate-800/40 border border-slate-700/60 cursor-pointer hover:bg-slate-800/80 transition">
          <div className="flex items-center gap-2.5">
            <div
              className={`p-2 rounded-xl ${
                settings.enableVibration
                  ? 'bg-purple-500/20 text-purple-400'
                  : 'bg-slate-700 text-slate-500'
              }`}
            >
              <Vibrate className="w-4 h-4" />
            </div>
            <div>
              <div className="text-xs font-semibold text-white">Getaran (Vibrate)</div>
              <div className="text-[10px] text-slate-400">Ponsel bergetar saat alarm</div>
            </div>
          </div>
          <input
            type="checkbox"
            checked={settings.enableVibration}
            onChange={(e) => onChange({ enableVibration: e.target.checked })}
            className="w-4 h-4 rounded text-blue-600 focus:ring-blue-500 focus:ring-offset-slate-900 cursor-pointer"
          />
        </label>

        {/* Volume Level */}
        <div className="p-3 rounded-2xl bg-slate-800/40 border border-slate-700/60 space-y-1.5">
          <div className="flex items-center justify-between text-xs">
            <span className="font-semibold text-white flex items-center gap-1.5">
              <Volume2 className="w-4 h-4 text-emerald-400" />
              Volume Alarm
            </span>
            <span className="font-mono text-emerald-400 font-bold">
              {Math.round(settings.volume * 100)}%
            </span>
          </div>
          <input
            type="range"
            min="0.2"
            max="1.0"
            step="0.05"
            value={settings.volume}
            onChange={(e) => onChange({ volume: Number(e.target.value) })}
            className="w-full h-1.5 bg-slate-700 rounded-lg appearance-none cursor-pointer accent-emerald-500"
          />
        </div>

        {/* Alarm Duration */}
        <div className="p-3 rounded-2xl bg-slate-800/40 border border-slate-700/60 space-y-1.5">
          <div className="flex items-center justify-between text-xs">
            <span className="font-semibold text-white flex items-center gap-1.5">
              <Clock className="w-4 h-4 text-blue-400" />
              Durasi Alarm
            </span>
            <span className="font-mono text-blue-400 font-bold">
              {settings.alarmDurationSeconds}s
            </span>
          </div>
          <div className="flex gap-1.5">
            {[10, 15, 30, 60].map((dur) => (
              <button
                key={dur}
                type="button"
                onClick={() => onChange({ alarmDurationSeconds: dur })}
                className={`flex-1 py-1 text-[11px] rounded-lg font-medium transition ${
                  settings.alarmDurationSeconds === dur
                    ? 'bg-blue-600 text-white'
                    : 'bg-slate-700/60 text-slate-400 hover:text-slate-200'
                }`}
              >
                {dur}s
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
};
