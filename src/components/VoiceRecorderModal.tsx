import React, { useState, useRef, useEffect } from 'react';
import { Mic, Square, Play, Pause, Save, RotateCcw, X, Sparkles, Check } from 'lucide-react';
import { SoundItem } from '../types';
import { saveAudioBlob } from '../services/storage';
import { pcmToWavBlob } from '../utils/wavEncoder';

interface VoiceRecorderModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSaved: (sound: SoundItem, asVoiceTrigger?: boolean) => void;
  initialAsTrigger?: boolean;
}

export const VoiceRecorderModal: React.FC<VoiceRecorderModalProps> = ({
  isOpen,
  onClose,
  onSaved,
  initialAsTrigger = false,
}) => {
  const [isRecording, setIsRecording] = useState(false);
  const [recordedBlob, setRecordedBlob] = useState<Blob | null>(null);
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [isPlayingPreview, setIsPlayingPreview] = useState(false);
  const [recordDuration, setRecordDuration] = useState(0);
  const [soundName, setSoundName] = useState('Rekaman Suaraku');
  const [inputVolume, setInputVolume] = useState(0);
  const [isSaving, setIsSaving] = useState(false);
  const [useAsVoiceTrigger, setUseAsVoiceTrigger] = useState(initialAsTrigger);
  const [recorderError, setRecorderError] = useState<string | null>(null);

  const mediaStreamRef = useRef<MediaStream | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const processorNodeRef = useRef<ScriptProcessorNode | null>(null);
  const pcmChunksRef = useRef<Float32Array[]>([]);
  const timerIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const audioPlayerRef = useRef<HTMLAudioElement | null>(null);
  const animFrameRef = useRef<number | null>(null);

  useEffect(() => {
    if (!isOpen) {
      cleanup();
    } else {
      setUseAsVoiceTrigger(initialAsTrigger);
      if (initialAsTrigger) {
        setSoundName('Panggilan: Halo HP');
      }
    }
  }, [isOpen, initialAsTrigger]);

  const cleanup = () => {
    if (timerIntervalRef.current) clearInterval(timerIntervalRef.current);
    if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current);
    if (audioPlayerRef.current) {
      audioPlayerRef.current.pause();
      audioPlayerRef.current = null;
    }
    if (audioUrl) {
      URL.revokeObjectURL(audioUrl);
      setAudioUrl(null);
    }
    if (processorNodeRef.current) {
      try {
        processorNodeRef.current.disconnect();
      } catch {
        // ignore
      }
      processorNodeRef.current = null;
    }
    if (mediaStreamRef.current) {
      mediaStreamRef.current.getTracks().forEach((track) => track.stop());
      mediaStreamRef.current = null;
    }
    if (audioContextRef.current && audioContextRef.current.state !== 'closed') {
      try {
        audioContextRef.current.close();
      } catch {
        // ignore
      }
      audioContextRef.current = null;
    }
    setIsRecording(false);
    setRecordedBlob(null);
    setIsPlayingPreview(false);
    setRecordDuration(0);
    setInputVolume(0);
    pcmChunksRef.current = [];
  };

  const startRecording = async () => {
    try {
      cleanup();
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: false,
          noiseSuppression: false,
          autoGainControl: true,
        },
      });
      mediaStreamRef.current = stream;

      const AudioCtx =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      const ctx = new AudioCtx();
      audioContextRef.current = ctx;

      const source = ctx.createMediaStreamSource(stream);
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 256;

      // Use standard ScriptProcessorNode to capture full PCM audio stream directly
      const bufferSize = 4096;
      const processor = ctx.createScriptProcessor(bufferSize, 1, 1);
      processorNodeRef.current = processor;
      pcmChunksRef.current = [];

      processor.onaudioprocess = (e) => {
        const inputData = e.inputBuffer.getChannelData(0);
        // Copy chunk
        const chunk = new Float32Array(inputData.length);
        chunk.set(inputData);
        pcmChunksRef.current.push(chunk);
      };

      source.connect(analyser);
      source.connect(processor);
      // Connect processor to destination through silent gain to keep it alive
      const dummyGain = ctx.createGain();
      dummyGain.gain.setValueAtTime(0, ctx.currentTime);
      processor.connect(dummyGain);
      dummyGain.connect(ctx.destination);

      // Volume animation
      const dataArray = new Uint8Array(analyser.frequencyBinCount);
      const checkVolume = () => {
        analyser.getByteFrequencyData(dataArray);
        let sum = 0;
        for (let i = 0; i < dataArray.length; i++) {
          sum += dataArray[i];
        }
        const avg = sum / dataArray.length;
        setInputVolume(Math.min(100, Math.round(avg * 1.5)));
        animFrameRef.current = requestAnimationFrame(checkVolume);
      };
      checkVolume();

      setIsRecording(true);
      setRecordDuration(0);

      timerIntervalRef.current = setInterval(() => {
        setRecordDuration((prev) => {
          if (prev >= 15) {
            stopRecording();
            return 15;
          }
          return prev + 1;
        });
      }, 1000);
    } catch (err) {
      console.error('Gagal mengakses mikrofon untuk merekam:', err);
      setRecorderError('Izin mikrofon dibutuhkan untuk merekam suara.');
    }
  };

  const stopRecording = () => {
    if (!isRecording) return;
    setIsRecording(false);

    if (timerIntervalRef.current) {
      clearInterval(timerIntervalRef.current);
      timerIntervalRef.current = null;
    }
    if (animFrameRef.current) {
      cancelAnimationFrame(animFrameRef.current);
      animFrameRef.current = null;
    }
    setInputVolume(0);

    // Stop capturing
    if (processorNodeRef.current) {
      try {
        processorNodeRef.current.disconnect();
      } catch {
        // ignore
      }
    }
    if (mediaStreamRef.current) {
      mediaStreamRef.current.getTracks().forEach((track) => track.stop());
    }

    const sampleRate = audioContextRef.current ? audioContextRef.current.sampleRate : 44100;
    const chunks = pcmChunksRef.current;

    // Concatenate all PCM chunks into one complete Float32Array
    let totalLength = 0;
    for (const chunk of chunks) {
      totalLength += chunk.length;
    }

    if (totalLength === 0) {
      console.warn('Tidak ada data audio yang terekam.');
      return;
    }

    const merged = new Float32Array(totalLength);
    let offset = 0;
    for (const chunk of chunks) {
      merged.set(chunk, offset);
      offset += chunk.length;
    }

    // Encode to standard 16-bit WAV Blob
    const wavBlob = pcmToWavBlob(merged, sampleRate);
    setRecordedBlob(wavBlob);

    const url = URL.createObjectURL(wavBlob);
    setAudioUrl(url);
  };

  const playPreview = () => {
    if (!audioUrl) return;

    if (isPlayingPreview && audioPlayerRef.current) {
      audioPlayerRef.current.pause();
      setIsPlayingPreview(false);
      return;
    }

    const audio = new Audio(audioUrl);
    audioPlayerRef.current = audio;
    audio.onended = () => setIsPlayingPreview(false);
    audio.play();
    setIsPlayingPreview(true);
  };

  const handleSave = async () => {
    if (!recordedBlob) return;
    setIsSaving(true);
    try {
      const id = 'rec_' + Date.now();
      const rawName = soundName.trim() || 'Rekaman Suaraku';
      const displayName = useAsVoiceTrigger
        ? `🗣️ Panggilan: ${rawName.replace(/^[🎙️🗣️]\s*/, '')}`
        : `🎙️ ${rawName.replace(/^[🎙️🗣️]\s*/, '')}`;

      await saveAudioBlob(id, recordedBlob);

      const newSound: SoundItem = {
        id,
        name: displayName,
        category: 'recorded',
        duration: recordDuration || 3,
        dateAdded: Date.now(),
        audioBlob: recordedBlob,
        isVoiceTrigger: useAsVoiceTrigger,
      };

      onSaved(newSound, useAsVoiceTrigger);
      onClose();
    } catch (err) {
      console.error('Gagal menyimpan rekaman:', err);
      setRecorderError('Gagal menyimpan rekaman suara ke memori perangkat.');
    } finally {
      setIsSaving(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-md p-4 animate-in fade-in">
      <div className="relative w-full max-w-md rounded-3xl bg-slate-900 border border-slate-800 p-6 shadow-2xl text-slate-100">
        {/* Header */}
        <div className="flex items-center justify-between pb-4 border-b border-slate-800/80">
          <div className="flex items-center gap-2.5">
            <div className="p-2 rounded-xl bg-pink-500/20 text-pink-400">
              <Mic className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-lg font-bold text-white">
                {useAsVoiceTrigger ? 'Rekam Panggilan Suara' : 'Rekam Suara Sendiri'}
              </h3>
              <p className="text-xs text-slate-400">
                {useAsVoiceTrigger
                  ? 'Rekam suaramu saat memanggil HP (misal: "Halo HP")'
                  : 'Rekam suaramu sebagai nada alarm HP'}
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-xl text-slate-400 hover:text-white hover:bg-slate-800 transition"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Inline Error Banner */}
        {recorderError && (
          <div className="mt-3 p-2.5 rounded-xl bg-red-950/80 border border-red-500/40 text-red-200 text-xs flex items-center justify-between">
            <span>{recorderError}</span>
            <button
              onClick={() => setRecorderError(null)}
              className="text-red-400 hover:text-white font-bold ml-2"
            >
              ✕
            </button>
          </div>
        )}

        {/* Central Display */}
        <div className="my-6 flex flex-col items-center justify-center">
          {/* Glowing Aura Mic Circle */}
          <div className="relative mb-4 flex items-center justify-center">
            {isRecording && (
              <div
                className="absolute inset-0 rounded-full bg-red-500/30 blur-xl animate-pulse"
                style={{ transform: `scale(${1 + inputVolume / 70})` }}
              />
            )}
            <div
              className={`w-28 h-28 rounded-full flex flex-col items-center justify-center transition-all duration-300 ${
                isRecording
                  ? 'bg-gradient-to-tr from-red-600 to-rose-500 shadow-xl shadow-red-500/40 text-white'
                  : recordedBlob
                  ? 'bg-gradient-to-tr from-emerald-600 to-teal-500 text-white shadow-xl shadow-emerald-500/30'
                  : 'bg-slate-800 border-2 border-dashed border-slate-700 text-slate-400'
              }`}
            >
              <Mic className={`w-10 h-10 ${isRecording ? 'animate-bounce' : ''}`} />
              <span className="text-xs font-mono font-bold mt-1">
                {isRecording
                  ? `00:${recordDuration.toString().padStart(2, '0')}`
                  : recordedBlob
                  ? 'Terekam Utuh'
                  : 'Siap'}
              </span>
            </div>
          </div>

          {/* Real-time volume visualizer bar */}
          {isRecording && (
            <div className="w-full max-w-xs space-y-1 mb-2">
              <div className="flex justify-between text-[11px] text-slate-400">
                <span>Level Suara Mikrofon</span>
                <span className="font-mono text-rose-400">{inputVolume}%</span>
              </div>
              <div className="h-2 w-full rounded-full bg-slate-800 overflow-hidden">
                <div
                  className="h-full bg-gradient-to-r from-emerald-500 via-amber-500 to-rose-500 transition-all duration-75"
                  style={{ width: `${inputVolume}%` }}
                />
              </div>
            </div>
          )}

          {/* Action buttons (Record / Stop / Preview) */}
          <div className="flex items-center gap-3 mt-2">
            {!isRecording && !recordedBlob && (
              <button
                onClick={startRecording}
                className="flex items-center gap-2 px-6 py-3 rounded-2xl bg-gradient-to-r from-red-600 to-rose-600 text-white font-semibold text-sm shadow-lg shadow-red-600/30 hover:brightness-110 active:scale-95 transition"
              >
                <Mic className="w-4 h-4" />
                Mulai Merekam
              </button>
            )}

            {isRecording && (
              <button
                onClick={stopRecording}
                className="flex items-center gap-2 px-6 py-3 rounded-2xl bg-slate-800 border border-red-500/50 text-red-400 font-semibold text-sm shadow-lg hover:bg-slate-700 active:scale-95 transition"
              >
                <Square className="w-4 h-4 fill-current" />
                Selesai (Stop)
              </button>
            )}

            {!isRecording && recordedBlob && (
              <>
                <button
                  onClick={playPreview}
                  className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-slate-800 text-slate-200 border border-slate-700 hover:bg-slate-700 transition text-sm font-medium"
                >
                  {isPlayingPreview ? (
                    <Pause className="w-4 h-4 text-emerald-400" />
                  ) : (
                    <Play className="w-4 h-4 text-emerald-400 fill-emerald-400" />
                  )}
                  {isPlayingPreview ? 'Jeda' : 'Putar Ulang Penuh'}
                </button>
                <button
                  onClick={startRecording}
                  className="flex items-center gap-1.5 px-3 py-2.5 rounded-xl bg-slate-800 text-slate-400 border border-slate-700 hover:text-white hover:bg-slate-700 transition text-xs"
                  title="Ulangi Rekaman"
                >
                  <RotateCcw className="w-4 h-4" />
                  Ulangi
                </button>
              </>
            )}
          </div>
        </div>

        {/* Options & Name Input */}
        {recordedBlob && (
          <div className="space-y-3.5 pt-4 border-t border-slate-800">
            {/* Toggle as Voice Trigger vs Alarm Sound */}
            <div className="p-3 rounded-2xl bg-slate-950 border border-slate-800 space-y-2">
              <label className="flex items-center justify-between cursor-pointer">
                <span className="text-xs font-semibold text-white">
                  Gunakan untuk Panggilan Suara?
                </span>
                <input
                  type="checkbox"
                  checked={useAsVoiceTrigger}
                  onChange={(e) => {
                    const checked = e.target.checked;
                    setUseAsVoiceTrigger(checked);
                    if (checked && !soundName.toLowerCase().includes('panggilan')) {
                      setSoundName('Panggilan: Halo HP');
                    }
                  }}
                  className="w-4 h-4 rounded text-blue-600 cursor-pointer"
                />
              </label>
              <p className="text-[11px] text-slate-400">
                {useAsVoiceTrigger
                  ? 'Rekaman ini akan didengarkan untuk memicu HP merespons saat dipanggil.'
                  : 'Rekaman ini akan dibunyikan sebagai nada alarm saat tepukan/panggilan terdeteksi.'}
              </p>
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-400 mb-1.5">
                Beri Nama Suara Ini:
              </label>
              <input
                type="text"
                value={soundName}
                onChange={(e) => setSoundName(e.target.value)}
                placeholder="Contoh: WOI HP KAMU DISINI!"
                className="w-full rounded-xl bg-slate-950 border border-slate-800 px-3.5 py-2.5 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-blue-500"
              />
            </div>

            {/* Quick Inspiration chips */}
            <div>
              <span className="text-[11px] text-slate-500 flex items-center gap-1 mb-1.5">
                <Sparkles className="w-3 h-3 text-amber-400" /> Contoh Nama Cepat:
              </span>
              <div className="flex flex-wrap gap-1.5">
                {[
                  'Halo HP!',
                  'Dimana Kamu!',
                  'WOI HP DISINI!',
                  'PANGGILAN SULTAN',
                  'AKU KETINGGALAN!',
                ].map((tag) => (
                  <button
                    key={tag}
                    type="button"
                    onClick={() => setSoundName(tag)}
                    className="text-[11px] px-2.5 py-1 rounded-lg bg-slate-800 text-slate-300 hover:bg-slate-700 transition"
                  >
                    {tag}
                  </button>
                ))}
              </div>
            </div>

            <button
              onClick={handleSave}
              disabled={isSaving}
              className="mt-4 w-full flex items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-blue-600 to-indigo-600 py-3 text-sm font-bold text-white shadow-lg shadow-blue-500/25 hover:from-blue-500 hover:to-indigo-500 transition active:scale-98 disabled:opacity-50"
            >
              <Save className="w-4 h-4" />
              {isSaving ? 'Menyimpan ke Memori...' : 'Simpan ke Memori Perangkat'}
            </button>
          </div>
        )}

        <div className="mt-4 text-center">
          <p className="text-[11px] text-slate-500">
            💾 Rekaman disimpan dalam format PCM WAV berkualitas penuh di memori perangkat (IndexedDB).
          </p>
        </div>
      </div>
    </div>
  );
};
