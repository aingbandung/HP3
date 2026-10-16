import { AppSettings, AudioDiagnostics, DetectionMode } from '../types';

export interface ClapDetectorCallbacks {
  onClapDetected: (clapIndex: number, totalNeeded: number) => void;
  onAlarmTrigger: () => void;
  onAudioLevelUpdate: (
    level: number,
    rawData: Uint8Array,
    fftData: Uint8Array,
    diagnostics: AudioDiagnostics
  ) => void;
  onError: (error: string) => void;
  onStateChange: (isListening: boolean) => void;
  onSpeechRecognized?: (transcript: string) => void;
  onEvent?: (event: AudioDiagnostics['recentEvent']) => void;
  onAlarmAutoEnd?: () => void;
}

// 1-second silent WAV base64 data to keep background audio pipeline and MediaSession active
const SILENT_AUDIO_DATA_URI =
  'data:audio/wav;base64,UklGRigAAABXQVZFZm10IBIAAAABAAEARKwAAIhYAQACABAAAABkYXRhAgAAAAEA';

class ClapDetector {
  private audioContext: AudioContext | null = null;
  private mediaStream: MediaStream | null = null;
  private sourceNode: MediaStreamAudioSourceNode | null = null;
  private analyserNode: AnalyserNode | null = null;
  private scriptNode: ScriptProcessorNode | null = null;
  private silentGainNode: GainNode | null = null;
  private silentOscillator: OscillatorNode | null = null;
  private backgroundAudioElement: HTMLAudioElement | null = null;
  private backgroundWorker: Worker | null = null;

  // Web Speech Recognition instance for Voice Call mode ("Halo HP")
  private speechRecognizer: any = null;
  private isSpeechRecognizerActive = false;

  private isRunning = false;
  private isMuted = false;
  private animationFrameId: number | null = null;
  private alarmEndsAt = 0;

  // Settings
  private settings: AppSettings = {
    sensitivity: 72,
    targetTriggerDb: 48,
    detectionMode: 'double_clap',
    selectedSoundId: 'preset_police',
    volume: 1.0,
    enableVibration: true,
    enableWakeLock: true,
    alarmDurationSeconds: 15,
    autoLoopAlarm: true,
    doubleClapIntervalMax: 1400,
    doubleClapIntervalMin: 120,
    voiceCallKeyword: 'Halo HP',
  };

  private callbacks: ClapDetectorCallbacks | null = null;

  // Acoustic DSP State
  private ambientRms = 0.015;
  private refractoryUntil = 0;
  private recentRmsHistory: number[] = [];

  // Candidate Clap Verification
  private candidateStartTime = 0;
  private candidatePeakRms = 0;
  private sustainedFramesCount = 0;
  private isVerifyingDecay = false;
  private pendingClapType: 'single' | 'double_1' | 'double_2' | null = null;

  // Double Clap State Machine
  private doubleClapStage = 0;
  private clap1Time = 0;
  private doubleClapExpireTimeout: any = null;

  // Calibration State
  private isCalibrating = false;
  private calibrationMaxPeakDb = 0;

  // Latest Diagnostics for UI display
  private latestDiagnostics: AudioDiagnostics = {
    peak: 0,
    rms: 0,
    crestFactor: 0,
    lowEnergy: 0,
    midEnergy: 0,
    highEnergy: 0,
    highRatio: 0,
  };

  // Voice Call Cadence State
  private lastVocalBurstTime = 0;
  private vocalBurstCount = 0;

  // Loud sound sustained frames counter
  private sustainedLoudFrames = 0;

  public updateSettings(newSettings: Partial<AppSettings>) {
    const oldMode = this.settings.detectionMode;
    this.settings = { ...this.settings, ...newSettings };

    if (this.isRunning && newSettings.detectionMode && newSettings.detectionMode !== oldMode) {
      if (newSettings.detectionMode === 'voice_call') {
        this.startSpeechRecognition();
      } else {
        this.stopSpeechRecognition();
      }
      this.resetDetectionState();
    }
  }

  public getSettings(): AppSettings {
    return this.settings;
  }

  public isListening(): boolean {
    return this.isRunning;
  }

  public isAudioMuted(): boolean {
    return this.isMuted;
  }

  public getAlarmEndsAt(): number {
    return this.alarmEndsAt;
  }

  // Mute detection when alarm sounds. Store alarm duration to auto-unmute on background worker
  public pauseDetection(durationSeconds?: number): void {
    this.isMuted = true;
    const dur = durationSeconds || this.settings.alarmDurationSeconds || 15;
    this.alarmEndsAt = Date.now() + dur * 1000;
    this.resetDetectionState();
    if (this.speechRecognizer) {
      try {
        this.speechRecognizer.abort();
      } catch {
        // ignore
      }
    }
  }

  // Resume detection IMMEDIATELY (no throttled setTimeout)
  public resumeDetection(): void {
    this.isMuted = false;
    this.alarmEndsAt = 0;
    this.resetDetectionState();
    // Safety refractory window using timestamp to prevent feedback loop
    this.refractoryUntil = Date.now() + 750;

    // Ensure AudioContext is running
    if (this.audioContext && this.audioContext.state === 'suspended') {
      this.audioContext.resume().catch(() => {});
    }

    // Ensure background audio element is actively playing
    this.startBackgroundMediaSession();

    if (this.isRunning && this.settings.detectionMode === 'voice_call') {
      this.startSpeechRecognition();
    }
  }

  private resetDetectionState(): void {
    this.doubleClapStage = 0;
    this.clap1Time = 0;
    this.isVerifyingDecay = false;
    this.pendingClapType = null;
    this.sustainedFramesCount = 0;
    this.vocalBurstCount = 0;
    this.sustainedLoudFrames = 0;
    this.recentRmsHistory = [];
    if (this.doubleClapExpireTimeout) {
      clearTimeout(this.doubleClapExpireTimeout);
      this.doubleClapExpireTimeout = null;
    }
  }

  public async start(callbacks: ClapDetectorCallbacks, settings?: AppSettings): Promise<boolean> {
    if (this.isRunning) return true;

    if (settings) {
      this.settings = settings;
    }
    this.callbacks = callbacks;
    this.isMuted = false;
    this.resetDetectionState();

    try {
      // 1. Microphone stream
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: false,
          noiseSuppression: false,
          autoGainControl: false,
        },
        video: false,
      });

      this.mediaStream = stream;

      // 2. AudioContext
      const AudioContextClass =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      this.audioContext = new AudioContextClass();

      if (this.audioContext.state === 'suspended') {
        await this.audioContext.resume();
      }

      // 3. Silent keep-alive oscillator
      this.silentOscillator = this.audioContext.createOscillator();
      this.silentGainNode = this.audioContext.createGain();
      this.silentGainNode.gain.setValueAtTime(0.000001, this.audioContext.currentTime);
      this.silentOscillator.connect(this.silentGainNode);
      this.silentGainNode.connect(this.audioContext.destination);
      this.silentOscillator.start();

      // 4. Source Node
      this.sourceNode = this.audioContext.createMediaStreamSource(stream);

      // 5. Analyser Node for FFT
      this.analyserNode = this.audioContext.createAnalyser();
      this.analyserNode.fftSize = 512;
      this.analyserNode.smoothingTimeConstant = 0.2;
      this.sourceNode.connect(this.analyserNode);

      // 6. ScriptProcessorNode for unthrottled hardware background processing
      const bufferSize = 2048;
      this.scriptNode = this.audioContext.createScriptProcessor(bufferSize, 1, 1);
      this.sourceNode.connect(this.scriptNode);
      this.scriptNode.connect(this.silentGainNode);

      this.scriptNode.onaudioprocess = (e) => {
        if (!this.isRunning) return;
        const now = Date.now();

        // In background or locked screen, check hardware time to auto-end alarm and unmute
        if (this.isMuted) {
          if (this.alarmEndsAt > 0 && now >= this.alarmEndsAt) {
            this.resumeDetection();
            this.callbacks?.onAlarmAutoEnd?.();
          }
          return;
        }

        const inputData = e.inputBuffer.getChannelData(0);
        this.processHardwareAudioChunk(inputData);
      };

      // 7. Background MediaSession & silent loop
      this.startBackgroundMediaSession();

      // 8. Background Web Worker timer
      this.startBackgroundWorker();

      // 9. UI visualization loop
      this.startUiLoop();

      // 10. Start Speech Recognition if in voice_call mode
      if (this.settings.detectionMode === 'voice_call') {
        this.startSpeechRecognition();
      }

      this.isRunning = true;
      this.callbacks.onStateChange(true);
      return true;
    } catch (err: unknown) {
      console.error('Gagal mengakses mikrofon:', err);
      const msg =
        err instanceof Error
          ? err.message
          : 'Izin mikrofon diperlukan untuk mendeteksi tepukan suara.';
      this.callbacks?.onError(msg);
      this.stop();
      return false;
    }
  }

  public stop(): void {
    this.isRunning = false;
    this.isMuted = false;
    this.alarmEndsAt = 0;

    this.stopSpeechRecognition();
    this.stopBackgroundMediaSession();
    this.stopBackgroundWorker();

    if (this.animationFrameId !== null) {
      cancelAnimationFrame(this.animationFrameId);
      this.animationFrameId = null;
    }

    if (this.doubleClapExpireTimeout) {
      clearTimeout(this.doubleClapExpireTimeout);
      this.doubleClapExpireTimeout = null;
    }

    if (this.scriptNode) {
      try {
        this.scriptNode.disconnect();
        this.scriptNode.onaudioprocess = null;
      } catch {
        // ignore
      }
      this.scriptNode = null;
    }

    if (this.silentOscillator) {
      try {
        this.silentOscillator.stop();
        this.silentOscillator.disconnect();
      } catch {
        // ignore
      }
      this.silentOscillator = null;
    }

    if (this.silentGainNode) {
      try {
        this.silentGainNode.disconnect();
      } catch {
        // ignore
      }
      this.silentGainNode = null;
    }

    if (this.analyserNode) {
      try {
        this.analyserNode.disconnect();
      } catch {
        // ignore
      }
      this.analyserNode = null;
    }

    if (this.sourceNode) {
      try {
        this.sourceNode.disconnect();
      } catch {
        // ignore
      }
      this.sourceNode = null;
    }

    if (this.mediaStream) {
      this.mediaStream.getTracks().forEach((track) => track.stop());
      this.mediaStream = null;
    }

    if (this.audioContext && this.audioContext.state !== 'closed') {
      try {
        this.audioContext.close();
      } catch {
        // ignore
      }
      this.audioContext = null;
    }

    this.resetDetectionState();
    this.callbacks?.onStateChange(false);
  }

  // ===========================================================================
  // CLAPPING CALIBRATION ENGINE (Auto-calculates Target Trigger dB from user clap)
  // ===========================================================================
  public startClapCalibration(
    durationMs: number = 3500,
    onProgress: (remainingMs: number, currentDb: number) => void,
    onComplete: (calculatedTargetDb: number, maxPeakDb: number) => void
  ): () => void {
    this.isCalibrating = true;
    this.calibrationMaxPeakDb = 0;
    const startTime = Date.now();
    const endTime = startTime + durationMs;

    const interval = setInterval(() => {
      const now = Date.now();
      const remaining = Math.max(0, endTime - now);
      onProgress(remaining, Math.round(this.latestDiagnostics.peak * 100));

      if (now >= endTime) {
        clearInterval(interval);
        this.isCalibrating = false;
        const maxPeak = Math.max(30, this.calibrationMaxPeakDb);
        // Calculate trigger threshold: 80% of max measured clap peak
        const targetDb = Math.max(26, Math.min(88, Math.round(maxPeak * 0.80)));
        onComplete(targetDb, maxPeak);
      }
    }, 100);

    return () => {
      clearInterval(interval);
      this.isCalibrating = false;
    };
  }

  // ===========================================================================
  // BACKGROUND KEEPALIVE (HTML5 Audio Loop + MediaSession + Web Worker)
  // ===========================================================================
  public ensureBackgroundKeepAlive(): void {
    this.startBackgroundMediaSession();
  }

  private startBackgroundMediaSession(): void {
    try {
      if (!this.backgroundAudioElement) {
        const audio = new Audio(SILENT_AUDIO_DATA_URI);
        audio.loop = true;
        audio.volume = 0.01;
        this.backgroundAudioElement = audio;
      }
      this.backgroundAudioElement.play().catch(() => {});

      if ('mediaSession' in navigator) {
        navigator.mediaSession.metadata = new MediaMetadata({
          title: 'Temukan HP by Firdaus',
          artist: 'Pemantau Suara Latar Belakang Aktif',
          album: 'Temukan HP',
        });
        navigator.mediaSession.playbackState = 'playing';

        navigator.mediaSession.setActionHandler('play', () => {
          if (this.backgroundAudioElement) this.backgroundAudioElement.play();
        });
        navigator.mediaSession.setActionHandler('pause', () => {});
      }
    } catch (e) {
      console.warn('Background MediaSession notice:', e);
    }
  }

  private stopBackgroundMediaSession(): void {
    if (this.backgroundAudioElement) {
      try {
        this.backgroundAudioElement.pause();
        this.backgroundAudioElement = null;
      } catch {
        // ignore
      }
    }
    if ('mediaSession' in navigator) {
      navigator.mediaSession.playbackState = 'none';
    }
  }

  private startBackgroundWorker(): void {
    try {
      if (this.backgroundWorker) return;
      const workerBlob = new Blob(
        [
          `
          let timer = null;
          self.onmessage = function(e) {
            if (e.data === 'start') {
              if (!timer) timer = setInterval(() => self.postMessage('tick'), 30);
            } else if (e.data === 'stop') {
              if (timer) { clearInterval(timer); timer = null; }
            }
          };
          `,
        ],
        { type: 'application/javascript' }
      );
      this.backgroundWorker = new Worker(URL.createObjectURL(workerBlob));
      this.backgroundWorker.onmessage = () => {
        if (!this.isRunning) return;
        const now = Date.now();

        // 1. Check if alarm finished in background -> auto resume detection
        if (this.isMuted && this.alarmEndsAt > 0 && now >= this.alarmEndsAt) {
          this.alarmEndsAt = 0;
          this.callbacks?.onAlarmAutoEnd?.();
          this.resumeDetection();
          return;
        }

        // 2. Check if double clap window expired
        if (this.doubleClapStage > 0 && now - this.clap1Time > this.settings.doubleClapIntervalMax) {
          this.doubleClapStage = 0;
          this.callbacks?.onClapDetected(0, 2);
        }
      };
      this.backgroundWorker.postMessage('start');
    } catch (e) {
      console.warn('Worker fallback:', e);
    }
  }

  private stopBackgroundWorker(): void {
    if (this.backgroundWorker) {
      try {
        this.backgroundWorker.postMessage('stop');
        this.backgroundWorker.terminate();
      } catch {
        // ignore
      }
      this.backgroundWorker = null;
    }
  }

  // ===========================================================================
  // SPEECH RECOGNITION (VOICE CALL MODE)
  // ===========================================================================
  private startSpeechRecognition(): void {
    const SpeechRecClass =
      (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;

    if (!SpeechRecClass) return;

    try {
      if (this.speechRecognizer) this.speechRecognizer.abort();

      const rec = new SpeechRecClass();
      rec.continuous = true;
      rec.interimResults = true;
      rec.lang = 'id-ID';

      rec.onstart = () => {
        this.isSpeechRecognizerActive = true;
      };

      rec.onresult = (event: any) => {
        if (!this.isRunning || this.isMuted) return;
        for (let i = event.resultIndex; i < event.results.length; i++) {
          const transcript = event.results[i][0].transcript.trim().toLowerCase();
          const keyword = (this.settings.voiceCallKeyword || 'halo hp').trim().toLowerCase();
          const targetWords = keyword.split(/\s+/).filter(Boolean);

          const isExactMatch = transcript.includes(keyword);
          const hasAllWords = targetWords.every((w) => transcript.includes(w));
          const hasHelpWords =
            transcript.includes('halo') ||
            transcript.includes('dimana') ||
            transcript.includes('handphone') ||
            transcript.includes('ponsel') ||
            transcript.includes('hp');

          if (isExactMatch || hasAllWords || (targetWords.length === 1 && hasHelpWords)) {
            this.callbacks?.onSpeechRecognized?.(`🗣️ "${transcript}"`);
            this.latestDiagnostics.recentEvent = {
              type: 'voice',
              time: Date.now(),
              description: `🗣️ Voice match: "${transcript}"`,
            };
            this.callbacks?.onEvent?.(this.latestDiagnostics.recentEvent);
            this.triggerAlarm();
            return;
          }
        }
      };

      rec.onerror = (e: any) => {
        if (e.error !== 'no-speech' && e.error !== 'aborted') {
          console.warn('Speech recognition notice:', e.error);
        }
      };

      rec.onend = () => {
        this.isSpeechRecognizerActive = false;
        if (this.isRunning && !this.isMuted && this.settings.detectionMode === 'voice_call') {
          setTimeout(() => {
            if (this.isRunning && !this.isMuted && this.settings.detectionMode === 'voice_call') {
              try {
                rec.start();
              } catch {
                // ignore
              }
            }
          }, 300);
        }
      };

      rec.start();
      this.speechRecognizer = rec;
    } catch (err) {
      console.warn('Gagal SpeechRecognition:', err);
    }
  }

  private stopSpeechRecognition(): void {
    if (this.speechRecognizer) {
      try {
        this.speechRecognizer.abort();
      } catch {
        // ignore
      }
      this.speechRecognizer = null;
      this.isSpeechRecognizerActive = false;
    }
  }

  // ===========================================================================
  // UI VISUALIZATION LOOP
  // ===========================================================================
  private startUiLoop(): void {
    const timeData = new Uint8Array(this.analyserNode ? this.analyserNode.fftSize : 512);
    const fftData = new Uint8Array(this.analyserNode ? this.analyserNode.frequencyBinCount : 256);

    const loop = () => {
      if (!this.isRunning || !this.analyserNode) return;

      this.analyserNode.getByteTimeDomainData(timeData);
      this.analyserNode.getByteFrequencyData(fftData);

      let sumSquares = 0;
      for (let i = 0; i < timeData.length; i++) {
        const norm = (timeData[i] - 128) / 128;
        sumSquares += norm * norm;
      }
      const rms = Math.sqrt(sumSquares / timeData.length);
      const displayLevel = Math.min(100, Math.round(rms * 280));

      this.callbacks?.onAudioLevelUpdate(
        displayLevel,
        timeData,
        fftData,
        this.latestDiagnostics
      );

      this.animationFrameId = requestAnimationFrame(loop);
    };

    this.animationFrameId = requestAnimationFrame(loop);
  }

  // ===========================================================================
  // HARDWARE AUDIO PROCESSING & ACOUSTIC CLAP ENGINE
  // ===========================================================================
  private processHardwareAudioChunk(samples: Float32Array): void {
    const len = samples.length;
    let sumSquares = 0;
    let peak = 0;

    for (let i = 0; i < len; i++) {
      const absVal = Math.abs(samples[i]);
      if (absVal > peak) peak = absVal;
      sumSquares += samples[i] * samples[i];
    }

    const rms = Math.sqrt(sumSquares / len);
    const crestFactor = peak / (rms + 0.00001);

    // Record for calibration if active
    if (this.isCalibrating) {
      const currentPeakDb = Math.round(peak * 100);
      if (currentPeakDb > this.calibrationMaxPeakDb) {
        this.calibrationMaxPeakDb = currentPeakDb;
      }
    }

    // Frequency Spectrum via AnalyserNode
    const fftData = new Uint8Array(this.analyserNode ? this.analyserNode.frequencyBinCount : 256);
    if (this.analyserNode) {
      this.analyserNode.getByteFrequencyData(fftData);
    }

    let lowEnergy = 0;
    let midEnergy = 0;
    let highEnergy = 0;
    const binCount = fftData.length;

    for (let i = 1; i < Math.min(9, binCount); i++) lowEnergy += fftData[i];
    for (let i = 9; i < Math.min(29, binCount); i++) midEnergy += fftData[i];
    for (let i = 29; i < Math.min(85, binCount); i++) highEnergy += fftData[i];

    const highRatio = highEnergy / (lowEnergy + midEnergy + 0.001);

    // Adaptive ambient noise baseline
    if (rms < this.ambientRms * 1.5 && peak < 0.12) {
      this.ambientRms = this.ambientRms * 0.96 + rms * 0.04;
    }
    this.ambientRms = Math.max(0.004, Math.min(0.06, this.ambientRms));

    this.recentRmsHistory.push(rms);
    if (this.recentRmsHistory.length > 5) {
      this.recentRmsHistory.shift();
    }

    this.latestDiagnostics = {
      peak,
      rms,
      crestFactor,
      lowEnergy,
      midEnergy,
      highEnergy,
      highRatio,
    };

    this.analyzeAcousticFrame(rms, peak, crestFactor, highEnergy, lowEnergy, highRatio);
  }

  private analyzeAcousticFrame(
    rms: number,
    peak: number,
    crestFactor: number,
    highEnergy: number,
    lowEnergy: number,
    highRatio: number
  ): void {
    const now = Date.now();

    if (now < this.refractoryUntil) {
      return;
    }

    // Support targetTriggerDb (e.g. 48 dB) or fallback to sensitivity slider
    const targetDb =
      this.settings.targetTriggerDb !== undefined
        ? this.settings.targetTriggerDb
        : Math.round(54 - (this.settings.sensitivity / 100) * 42);

    // Dynamic thresholds derived directly from Target Trigger dB
    const minPeak = Math.max(0.08, (targetDb / 100) * 0.88);
    const minSpikeRatio = Math.max(1.7, (targetDb / 100) * 3.8);
    const minCrest = Math.max(1.95, 2.7 - (targetDb / 100) * 0.6);

    const isLoudEnough = peak >= minPeak;
    const isEnergySpike = rms >= this.ambientRms * minSpikeRatio || peak >= minPeak * 1.35;
    const isImpulsive = crestFactor >= minCrest;
    const hasImpulseAcoustics = highEnergy > 6 || highRatio > 0.12 || peak >= minPeak * 1.55;

    const isCandidateClap = isLoudEnough && isEnergySpike && isImpulsive && hasImpulseAcoustics;

    // =========================================================================
    // DURATION / DECAY CHECK (REJECTS CONTINUOUS VOCAL TALKING > 160ms)
    // =========================================================================
    if (this.isVerifyingDecay) {
      const elapsed = now - this.candidateStartTime;

      if (rms > this.candidatePeakRms * 0.75 && peak > minPeak * 1.1) {
        this.sustainedFramesCount++;
        if (this.sustainedFramesCount >= 4 && elapsed > 150) {
          this.isVerifyingDecay = false;
          this.pendingClapType = null;
          this.latestDiagnostics.recentEvent = {
            type: 'rejected_sustained',
            time: now,
            description: `🛡️ Suara ditolak: bicara berkelanjutan (Bukan impuls)`,
          };
          this.callbacks?.onEvent?.(this.latestDiagnostics.recentEvent);
          return;
        }
      }

      if (elapsed >= 70 && elapsed <= 200) {
        this.isVerifyingDecay = false;
        const clapType = this.pendingClapType;
        this.pendingClapType = null;

        if (clapType === 'single') {
          this.refractoryUntil = now + 1500;
          this.latestDiagnostics.recentEvent = {
            type: 'single_clap',
            time: now,
            description: `👏 Tepuk 1x terverifikasi! (Puncak: ${Math.round(this.candidatePeakRms * 280)}dB)`,
          };
          this.callbacks?.onEvent?.(this.latestDiagnostics.recentEvent);
          this.callbacks?.onClapDetected(1, 1);
          this.triggerAlarm();
        } else if (clapType === 'double_1') {
          this.onClap1Confirmed(now);
        } else if (clapType === 'double_2') {
          this.onClap2Confirmed(now);
        }
      }
      return;
    }

    // =========================================================================
    // MODE: DOUBLE CLAP (TEPUK 2X)
    // =========================================================================
    if (this.settings.detectionMode === 'double_clap') {
      if (this.doubleClapStage === 0) {
        if (isCandidateClap) {
          this.candidateStartTime = now;
          this.candidatePeakRms = rms;
          this.sustainedFramesCount = 0;
          this.isVerifyingDecay = true;
          this.pendingClapType = 'double_1';
        }
      } else if (this.doubleClapStage === 1) {
        const delta = now - this.clap1Time;

        if (delta > this.settings.doubleClapIntervalMax) {
          this.doubleClapStage = 0;
          this.callbacks?.onClapDetected(0, 2);
          return;
        }

        if (rms < this.candidatePeakRms * 0.70 || peak < minPeak * 0.9) {
          this.doubleClapStage = 2;
          this.latestDiagnostics.recentEvent = {
            type: 'valley_detected',
            time: now,
            description: '⏳ Jeda hening terdeteksi. Siap tepukan ke-2...',
          };
          this.callbacks?.onEvent?.(this.latestDiagnostics.recentEvent);
        }
      } else if (this.doubleClapStage === 2) {
        const delta = now - this.clap1Time;

        if (delta > this.settings.doubleClapIntervalMax) {
          this.doubleClapStage = 0;
          this.callbacks?.onClapDetected(0, 2);
          return;
        }

        if (delta >= this.settings.doubleClapIntervalMin && isCandidateClap) {
          this.candidateStartTime = now;
          this.candidatePeakRms = rms;
          this.sustainedFramesCount = 0;
          this.isVerifyingDecay = true;
          this.pendingClapType = 'double_2';
        }
      }
      return;
    }

    // =========================================================================
    // MODE: SINGLE CLAP (TEPUK 1X)
    // =========================================================================
    if (this.settings.detectionMode === 'single_clap') {
      if (isCandidateClap) {
        this.candidateStartTime = now;
        this.candidatePeakRms = rms;
        this.sustainedFramesCount = 0;
        this.isVerifyingDecay = true;
        this.pendingClapType = 'single';
      }
      return;
    }

    // =========================================================================
    // MODE: VOICE CALL (PANGGILAN SUARA)
    // =========================================================================
    if (this.settings.detectionMode === 'voice_call') {
      if (this.isSpeechRecognizerActive) return;

      const isVoiceFormantActive =
        lowEnergy > 60 &&
        crestFactor >= 1.25 &&
        crestFactor <= 2.4 &&
        rms > this.ambientRms * 2.0;

      if (isVoiceFormantActive) {
        if (now - this.lastVocalBurstTime > 160) {
          this.vocalBurstCount++;
          this.lastVocalBurstTime = now;
        }

        if (this.vocalBurstCount >= 3) {
          this.vocalBurstCount = 0;
          this.refractoryUntil = now + 1800;
          this.callbacks?.onSpeechRecognized?.(
            `🗣️ Panggilan "${this.settings.voiceCallKeyword || 'Halo HP'}"`
          );
          this.latestDiagnostics.recentEvent = {
            type: 'voice',
            time: now,
            description: `🗣️ Voice cadence: "${this.settings.voiceCallKeyword || 'Halo HP'}"`,
          };
          this.callbacks?.onEvent?.(this.latestDiagnostics.recentEvent);
          this.triggerAlarm();
        }
      } else {
        if (now - this.lastVocalBurstTime > 1100) {
          this.vocalBurstCount = 0;
        }
      }
      return;
    }

    // =========================================================================
    // MODE: LOUD SOUND / PELUIT
    // =========================================================================
    if (this.settings.detectionMode === 'loud_sound') {
      const minSustainedPeak = Math.max(0.18, (targetDb / 100) * 1.1);
      if (peak >= minSustainedPeak && rms > this.ambientRms * 2.8) {
        this.sustainedLoudFrames++;
        if (this.sustainedLoudFrames >= 7) {
          this.sustainedLoudFrames = 0;
          this.refractoryUntil = now + 1800;
          this.triggerAlarm();
        }
      } else {
        this.sustainedLoudFrames = Math.max(0, this.sustainedLoudFrames - 1);
      }
      return;
    }
  }

  private onClap1Confirmed(now: number): void {
    this.doubleClapStage = 1;
    this.clap1Time = now;
    this.refractoryUntil = now + 110;
    this.latestDiagnostics.recentEvent = {
      type: 'clap_1',
      time: now,
      description: '👏 Clap detected: 1/2 (Menunggu tepuk ke-2)',
    };
    this.callbacks?.onEvent?.(this.latestDiagnostics.recentEvent);
    this.callbacks?.onClapDetected(1, 2);

    if (this.doubleClapExpireTimeout) clearTimeout(this.doubleClapExpireTimeout);
    this.doubleClapExpireTimeout = setTimeout(() => {
      if (this.doubleClapStage !== 0) {
        this.doubleClapStage = 0;
        this.callbacks?.onClapDetected(0, 2);
      }
    }, this.settings.doubleClapIntervalMax);
  }

  private onClap2Confirmed(now: number): void {
    if (this.doubleClapExpireTimeout) clearTimeout(this.doubleClapExpireTimeout);
    this.doubleClapStage = 0;
    this.refractoryUntil = now + 2000;
    this.latestDiagnostics.recentEvent = {
      type: 'clap_2',
      time: now,
      description: '👏 Clap detected: 2/2 -> Menyalakan Alarm!',
    };
    this.callbacks?.onEvent?.(this.latestDiagnostics.recentEvent);
    this.callbacks?.onClapDetected(2, 2);
    this.triggerAlarm();
  }

  private triggerAlarm(): void {
    this.pauseDetection();
    this.callbacks?.onAlarmTrigger();
  }

  public simulateClap(): void {
    const now = Date.now();
    if (this.settings.detectionMode === 'double_clap') {
      if (this.doubleClapStage === 0) {
        this.onClap1Confirmed(now);
      } else {
        this.onClap2Confirmed(now);
      }
    } else {
      this.triggerAlarm();
    }
  }
}

export const clapDetector = new ClapDetector();
