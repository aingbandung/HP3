import { getAudioBlob } from './storage';
import { SoundItem } from '../types';

let audioCtx: AudioContext | null = null;
let currentActiveSource: AudioNode | null = null;
let currentAudioElement: HTMLAudioElement | null = null;
let currentStopCallback: (() => void) | null = null;
let isPlayingAlarm = false;

// Cache of decoded audio buffers for zero-latency playback of custom recordings/files
const decodedBufferCache = new Map<string, AudioBuffer>();

export function getAudioContext(): AudioContext {
  if (!audioCtx || audioCtx.state === 'closed') {
    const AudioContextClass =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    audioCtx = new AudioContextClass();
  }
  if (audioCtx.state === 'suspended') {
    audioCtx.resume();
  }
  return audioCtx;
}

export function isAlarmSoundPlaying(): boolean {
  return isPlayingAlarm;
}

// Preload and decode a custom sound into memory so it plays instantly upon clap
export async function preloadCustomSound(sound: SoundItem): Promise<AudioBuffer | null> {
  if (sound.category !== 'recorded' && sound.category !== 'uploaded') {
    return null;
  }
  if (decodedBufferCache.has(sound.id)) {
    return decodedBufferCache.get(sound.id)!;
  }
  try {
    const ctx = getAudioContext();
    const blob = sound.audioBlob || (await getAudioBlob(sound.id));
    if (!blob) return null;

    const arrayBuffer = await blob.arrayBuffer();
    // decodeAudioData requires a copy because it detaches the buffer in some implementations
    const decoded = await ctx.decodeAudioData(arrayBuffer.slice(0));
    decodedBufferCache.set(sound.id, decoded);
    return decoded;
  } catch (err) {
    console.warn('Preload/decode audio buffer gagal:', err);
    return null;
  }
}

// Invalidate cache if sound was modified or deleted
export function invalidateSoundCache(id: string): void {
  decodedBufferCache.delete(id);
}

// Stop any currently playing alarm sound
export function stopAlarmSound(): void {
  isPlayingAlarm = false;
  if (currentStopCallback) {
    try {
      currentStopCallback();
    } catch {
      // ignore
    }
    currentStopCallback = null;
  }
  if (currentAudioElement) {
    try {
      currentAudioElement.pause();
      currentAudioElement.currentTime = 0;
      currentAudioElement.src = '';
    } catch {
      // ignore
    }
    currentAudioElement = null;
  }
  if (currentActiveSource) {
    try {
      (currentActiveSource as unknown as { stop?: () => void }).stop?.();
      currentActiveSource.disconnect();
    } catch {
      // ignore
    }
    currentActiveSource = null;
  }
  if ('speechSynthesis' in window) {
    try {
      window.speechSynthesis.cancel();
    } catch {
      // ignore
    }
  }
}

// Play alarm based on sound item and settings
export async function playAlarmSound(
  sound: SoundItem,
  volume: number = 1.0,
  durationSeconds: number = 15,
  loop: boolean = true,
  onEnd?: () => void
): Promise<void> {
  stopAlarmSound();
  isPlayingAlarm = true;

  const ctx = getAudioContext();
  if (ctx.state === 'suspended') {
    await ctx.resume();
  }

  const safeVolume = Math.max(0.1, Math.min(1.0, volume));

  // ==========================================
  // CUSTOM AUDIO (RECORDED OR UPLOADED)
  // ==========================================
  if (sound.category === 'recorded' || sound.category === 'uploaded') {
    let playedSuccessfully = false;

    // Method 1: Web Audio API AudioBufferSourceNode (Bypass HTML5 autoplay restrictions)
    try {
      let audioBuffer = decodedBufferCache.get(sound.id);
      if (!audioBuffer) {
        const blob = sound.audioBlob || (await getAudioBlob(sound.id));
        if (!blob) {
          throw new Error('Data audio rekaman tidak ditemukan di memori.');
        }
        const arrayBuffer = await blob.arrayBuffer();
        audioBuffer = await ctx.decodeAudioData(arrayBuffer.slice(0));
        decodedBufferCache.set(sound.id, audioBuffer);
      }

      if (audioBuffer) {
        const source = ctx.createBufferSource();
        source.buffer = audioBuffer;
        source.loop = loop;

        const gainNode = ctx.createGain();
        gainNode.gain.setValueAtTime(safeVolume, ctx.currentTime);
        source.connect(gainNode);
        gainNode.connect(ctx.destination);

        const startTime = ctx.currentTime;
        const stopTime = startTime + durationSeconds;
        source.start(startTime);
        source.stop(stopTime);
        currentActiveSource = source;
        playedSuccessfully = true;

        const stopTimer = setTimeout(() => {
          stopAlarmSound();
          onEnd?.();
        }, durationSeconds * 1000);

        currentStopCallback = () => {
          clearTimeout(stopTimer);
          try {
            source.stop();
            source.disconnect();
            gainNode.disconnect();
          } catch {
            // ignore
          }
        };

        source.onended = () => {
          if (isPlayingAlarm) {
            stopAlarmSound();
            onEnd?.();
          }
        };

        return; // Success! Do NOT fall through to siren!
      }
    } catch (webAudioErr) {
      console.warn('Metode Web Audio decode gagal, mencoba HTML5 Audio fallback:', webAudioErr);
    }

    // Method 2: HTML5 Audio element fallback
    if (!playedSuccessfully) {
      try {
        const blob = sound.audioBlob || (await getAudioBlob(sound.id));
        if (blob) {
          const objectUrl = URL.createObjectURL(blob);
          const audio = new Audio(objectUrl);
          audio.volume = safeVolume;
          audio.loop = loop;
          currentAudioElement = audio;

          const stopTimer = setTimeout(() => {
            stopAlarmSound();
            onEnd?.();
          }, durationSeconds * 1000);

          currentStopCallback = () => {
            clearTimeout(stopTimer);
            URL.revokeObjectURL(objectUrl);
          };

          audio.onended = () => {
            if (!loop) {
              stopAlarmSound();
              onEnd?.();
            }
          };

          await audio.play();
          return; // Success!
        }
      } catch (html5Err) {
        console.error('Semua metode pemutaran suara rekaman gagal:', html5Err);
      }
    }

    // If both failed because audio data was corrupted, alert the user and return instead of silently playing siren
    console.warn('Suara rekaman tidak dapat dimuat, membatalkan suara sirene otomatis.');
    stopAlarmSound();
    return;
  }

  // ==========================================
  // PRESET SYNTHESIZED SOUNDS
  // ==========================================
  const masterGain = ctx.createGain();
  masterGain.gain.setValueAtTime(safeVolume, ctx.currentTime);
  masterGain.connect(ctx.destination);

  let activeInterval: NodeJS.Timeout | null = null;
  const alarmEndTime = Date.now() + durationSeconds * 1000;
  const startTime = ctx.currentTime;
  const stopTime = startTime + durationSeconds;

  const cleanup = () => {
    if (activeInterval) {
      clearInterval(activeInterval);
      activeInterval = null;
    }
    try {
      masterGain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.1);
      setTimeout(() => {
        try {
          masterGain.disconnect();
        } catch {
          // ignore
        }
      }, 150);
    } catch {
      // ignore
    }
  };

  const autoStopTimer = setTimeout(() => {
    stopAlarmSound();
    onEnd?.();
  }, durationSeconds * 1000);

  currentStopCallback = () => {
    clearTimeout(autoStopTimer);
    cleanup();
  };

  const preset = sound.presetKey || 'police';

  switch (preset) {
    case 'police': {
      // Alternating high-power police siren (600Hz to 1400Hz sweep)
      const osc = ctx.createOscillator();
      const oscGain = ctx.createGain();
      osc.type = 'sawtooth';

      const cycleLength = 0.8;
      const totalCycles = Math.ceil(durationSeconds / cycleLength) + 2;

      for (let i = 0; i < totalCycles; i++) {
        const t = startTime + i * cycleLength;
        osc.frequency.setValueAtTime(650, t);
        osc.frequency.linearRampToValueAtTime(1450, t + cycleLength / 2);
        osc.frequency.linearRampToValueAtTime(650, t + cycleLength);
      }

      oscGain.gain.setValueAtTime(0.85, startTime);
      osc.connect(oscGain);
      oscGain.connect(masterGain);
      osc.start(startTime);
      osc.stop(stopTime); // Hardware Web Audio scheduled stop!

      osc.onended = () => {
        if (isPlayingAlarm) {
          stopAlarmSound();
          onEnd?.();
        }
      };

      currentActiveSource = osc;
      break;
    }

    case 'digital_beep': {
      // High-pitched penetrating digital beeper
      const playBeep = () => {
        if (!isPlayingAlarm || Date.now() >= alarmEndTime) {
          stopAlarmSound();
          onEnd?.();
          return;
        }
        const now = ctx.currentTime;
        const o1 = ctx.createOscillator();
        const o2 = ctx.createOscillator();
        const g = ctx.createGain();
        o1.type = 'square';
        o2.type = 'sawtooth';
        o1.frequency.setValueAtTime(1250, now);
        o2.frequency.setValueAtTime(2500, now);

        g.gain.setValueAtTime(0.8, now);
        g.gain.setValueAtTime(0.8, now + 0.12);
        g.gain.setValueAtTime(0.001, now + 0.15);
        g.gain.setValueAtTime(0.8, now + 0.22);
        g.gain.setValueAtTime(0.8, now + 0.34);
        g.gain.exponentialRampToValueAtTime(0.0001, now + 0.4);

        o1.connect(g);
        o2.connect(g);
        g.connect(masterGain);

        o1.start(now);
        o2.start(now);
        o1.stop(now + 0.45);
        o2.stop(now + 0.45);
      };

      playBeep();
      activeInterval = setInterval(playBeep, 600);
      break;
    }

    case 'airhorn': {
      // Aggressive multi-tone sports horn blast
      const blastFrequencies = [233, 311, 466, 622];
      const playBlast = () => {
        if (!isPlayingAlarm || Date.now() >= alarmEndTime) {
          stopAlarmSound();
          onEnd?.();
          return;
        }
        const now = ctx.currentTime;
        blastFrequencies.forEach((freq) => {
          const osc = ctx.createOscillator();
          const g = ctx.createGain();
          osc.type = 'sawtooth';
          osc.frequency.setValueAtTime(freq, now);
          osc.frequency.exponentialRampToValueAtTime(freq * 1.05, now + 0.7);

          g.gain.setValueAtTime(0.3, now);
          g.gain.linearRampToValueAtTime(0.35, now + 0.1);
          g.gain.exponentialRampToValueAtTime(0.001, now + 0.75);

          osc.connect(g);
          g.connect(masterGain);
          osc.start(now);
          osc.stop(now + 0.8);
        });
      };

      playBlast();
      activeInterval = setInterval(playBlast, 1000);
      break;
    }

    case 'fire_alarm': {
      // Pulsed sharp warble alarm (900Hz warble)
      const osc = ctx.createOscillator();
      const lfo = ctx.createOscillator();
      const lfoGain = ctx.createGain();
      const pulseGain = ctx.createGain();

      osc.type = 'square';
      osc.frequency.setValueAtTime(950, startTime);

      lfo.type = 'triangle';
      lfo.frequency.setValueAtTime(6, startTime);
      lfoGain.gain.setValueAtTime(250, startTime);

      lfo.connect(osc.frequency);
      osc.connect(pulseGain);
      pulseGain.connect(masterGain);

      pulseGain.gain.setValueAtTime(0.7, startTime);

      osc.start(startTime);
      lfo.start(startTime);
      osc.stop(stopTime);
      lfo.stop(stopTime);

      osc.onended = () => {
        if (isPlayingAlarm) {
          stopAlarmSound();
          onEnd?.();
        }
      };

      currentActiveSource = osc;
      break;
    }

    case 'sonar_ping': {
      // Submarine radar sonar ping
      const playPing = () => {
        if (!isPlayingAlarm || Date.now() >= alarmEndTime) {
          stopAlarmSound();
          onEnd?.();
          return;
        }
        const now = ctx.currentTime;
        const osc = ctx.createOscillator();
        const g = ctx.createGain();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(1400, now);
        osc.frequency.exponentialRampToValueAtTime(700, now + 0.9);

        g.gain.setValueAtTime(0.9, now);
        g.gain.exponentialRampToValueAtTime(0.0001, now + 1.2);

        osc.connect(g);
        g.connect(masterGain);
        osc.start(now);
        osc.stop(now + 1.3);
      };

      playPing();
      activeInterval = setInterval(playPing, 1400);
      break;
    }

    case 'marimba_alert': {
      // Bright musical alert sequence
      const melodyNotes = [523.25, 659.25, 783.99, 1046.5];
      const playMelody = () => {
        if (!isPlayingAlarm || Date.now() >= alarmEndTime) {
          stopAlarmSound();
          onEnd?.();
          return;
        }
        const now = ctx.currentTime;
        melodyNotes.forEach((freq, idx) => {
          const osc = ctx.createOscillator();
          const g = ctx.createGain();
          osc.type = 'triangle';
          osc.frequency.setValueAtTime(freq, now + idx * 0.12);

          g.gain.setValueAtTime(0.001, now + idx * 0.12);
          g.gain.linearRampToValueAtTime(0.7, now + idx * 0.12 + 0.02);
          g.gain.exponentialRampToValueAtTime(0.0001, now + idx * 0.12 + 0.4);

          osc.connect(g);
          g.connect(masterGain);
          osc.start(now + idx * 0.12);
          osc.stop(now + idx * 0.12 + 0.45);
        });
      };

      playMelody();
      activeInterval = setInterval(playMelody, 800);
      break;
    }

    case 'voice_synthesis': {
      const speakPhrase = () => {
        if (!isPlayingAlarm || !('speechSynthesis' in window)) return;
        const utterance = new SpeechSynthesisUtterance('Halo! HP kamu ada di sini! Tolong ambil aku!');
        utterance.lang = 'id-ID';
        utterance.rate = 1.1;
        utterance.pitch = 1.3;
        utterance.volume = safeVolume;
        utterance.onend = () => {
          if (isPlayingAlarm && loop) {
            setTimeout(speakPhrase, 800);
          }
        };
        window.speechSynthesis.speak(utterance);
      };

      speakPhrase();
      break;
    }
  }
}

// Quick 3s preview of a sound
export async function previewSound(sound: SoundItem, volume: number = 0.9): Promise<void> {
  await playAlarmSound(sound, volume, 3, false);
}
