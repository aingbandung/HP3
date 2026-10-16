/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Header } from './components/Header';
import { MainDetectorCard } from './components/MainDetectorCard';
import { SensitivityControl } from './components/SensitivityControl';
import { SoundSelector } from './components/SoundSelector';
import { VoiceRecorderModal } from './components/VoiceRecorderModal';
import { AlarmActiveModal } from './components/AlarmActiveModal';
import { BackgroundGuideModal } from './components/BackgroundGuideModal';
import { OfflineIndicator } from './components/OfflineIndicator';
import { FFTSpectrumVisualizer } from './components/FFTSpectrumVisualizer';

import { AppSettings, DetectionLogItem, DetectionStats, SoundItem } from './types';
import {
  DEFAULT_SETTINGS,
  loadSettings,
  saveSettings,
  PRESET_SOUNDS,
  loadCustomSoundList,
  saveCustomSoundList,
} from './services/storage';
import { clapDetector } from './services/clapDetector';
import {
  playAlarmSound,
  stopAlarmSound,
  preloadCustomSound,
} from './services/audioSynthesizer';
import { requestWakeLock, releaseWakeLock } from './services/wakeLockService';
import {
  requestNotificationPermission,
  sendClapDetectedNotification,
  triggerVibrationPattern,
  stopVibration,
} from './services/notificationService';
import {
  applyAllBackgroundSettings,
  syncNativeClapService,
  stopNativeClapService,
  pauseNativeClapService,
  resumeNativeClapService,
  consumeNativePendingTrigger,
  isNativeAndroidApp,
} from './services/backgroundSettingsService';

export default function App() {
  const [settings, setSettings] = useState<AppSettings>(() => loadSettings());
  const [sounds, setSounds] = useState<SoundItem[]>(() => [
    ...PRESET_SOUNDS,
    ...loadCustomSoundList(),
  ]);

  const [isListening, setIsListening] = useState(false);
  const [currentAudioLevel, setCurrentAudioLevel] = useState(0);
  const [audioRawData, setAudioRawData] = useState<Uint8Array | null>(null);
  const [fftData, setFftData] = useState<Uint8Array | null>(null);
  const [detectionLogs, setDetectionLogs] = useState<DetectionLogItem[]>([]);

  const addDetectionLog = useCallback(
    (entry: Omit<DetectionLogItem, 'id' | 'time'>) => {
      const now = new Date();
      const timeStr = now.toLocaleTimeString('id-ID', { hour12: false });
      const item: DetectionLogItem = {
        ...entry,
        id: `${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
        time: timeStr,
      };
      setDetectionLogs((prev) => [item, ...prev].slice(0, 5));
    },
    []
  );

  const [stats, setStats] = useState<DetectionStats>({
    isListening: false,
    currentVolume: 0,
    thresholdLevel: 45,
    lastClapTime: null,
    clapsCount: 0,
    waitingForSecondClap: false,
    totalTriggerCount: 0,
    lastRecognizedWord: '',
  });

  const [isAlarmActive, setIsAlarmActive] = useState(false);
  const [remainingSeconds, setRemainingSeconds] = useState(15);
  const [isRecorderOpen, setIsRecorderOpen] = useState(false);
  const [recordForTriggerMode, setRecordForTriggerMode] = useState(false);
  const [isGuideOpen, setIsGuideOpen] = useState(false);
  const [isWakeLockActive, setIsWakeLockActive] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const alarmTimerRef = useRef<NodeJS.Timeout | null>(null);
  const countdownIntervalRef = useRef<NodeJS.Timeout | null>(null);

  // Synchronized refs to guarantee zero stale closures during asynchronous mic events
  const soundsRef = useRef(sounds);
  const settingsRef = useRef(settings);

  useEffect(() => {
    soundsRef.current = sounds;
  }, [sounds]);

  useEffect(() => {
    settingsRef.current = settings;
  }, [settings]);

  // Preload custom sounds on mount so they are decoded and ready in memory
  useEffect(() => {
    sounds.forEach((sound) => {
      if (sound.category === 'recorded' || sound.category === 'uploaded') {
        preloadCustomSound(sound).catch(() => {});
      }
    });
  }, []);

  // Sync settings changes
  const handleUpdateSettings = useCallback((updated: Partial<AppSettings>) => {
    setSettings((prev) => {
      const next = { ...prev, ...updated };
      saveSettings(next);
      clapDetector.updateSettings(next);
      settingsRef.current = next;

      // Perbarui konfigurasi service native bila sedang mendengarkan
      if (clapDetector.isListening() && isNativeAndroidApp()) {
        syncNativeClapService(next);
      }

      // If user selected a different sound, preload it immediately
      if (updated.selectedSoundId) {
        const soundObj = soundsRef.current.find((s) => s.id === updated.selectedSoundId);
        if (soundObj) {
          preloadCustomSound(soundObj).catch(() => {});
        }
      }
      return next;
    });
  }, []);

  // Sync Wake Lock with listening state
  useEffect(() => {
    if (isListening && settings.enableWakeLock) {
      requestWakeLock().then((acquired) => setIsWakeLockActive(acquired));
    } else {
      releaseWakeLock().then(() => setIsWakeLockActive(false));
    }
  }, [isListening, settings.enableWakeLock]);

  // Request notifications permission quietly when user starts listening
  useEffect(() => {
    if (isListening) {
      requestNotificationPermission().catch(() => {});
    }
  }, [isListening]);

  // Instantly apply HP background settings when Background Mode is tapped
  const handleActivateBackgroundMode = useCallback(async () => {
    const status = await applyAllBackgroundSettings(true);
    setIsWakeLockActive(status.wakeLockActive);
    handleUpdateSettings({ enableWakeLock: true });
    setIsGuideOpen(true);
  }, [handleUpdateSettings]);

  // Stop Alarm handler
  const handleStopAlarm = useCallback(() => {
    setIsAlarmActive(false);
    stopAlarmSound();
    stopVibration();

    // Resume detection immediately
    clapDetector.resumeDetection();
    resumeNativeClapService();

    if (countdownIntervalRef.current) {
      clearInterval(countdownIntervalRef.current);
      countdownIntervalRef.current = null;
    }
    if (alarmTimerRef.current) {
      clearTimeout(alarmTimerRef.current);
      alarmTimerRef.current = null;
    }

    setStats((prev) => ({
      ...prev,
      waitingForSecondClap: false,
      clapsCount: 0,
    }));

    addDetectionLog({
      type: 'valley_detected',
      label: 'Alarm selesai -> Deteksi aktif kembali',
      details: 'Mikrofon siaga memantau tepukan di latar belakang',
      status: 'info',
    });
  }, [addDetectionLog]);

  // Trigger Alarm handler - always reads from latest refs
  const triggerAlarm = useCallback(() => {
    const currentSounds = soundsRef.current;
    const currentSettings = settingsRef.current;

    const selectedSound =
      currentSounds.find((s) => s.id === currentSettings.selectedSoundId) ||
      currentSounds[0] ||
      PRESET_SOUNDS[0];

    console.log('Menjalankan alarm dengan suara:', selectedSound.name, selectedSound.id);

    // MUTE DETECTION with duration so background worker auto-unmutes on time
    clapDetector.pauseDetection(currentSettings.alarmDurationSeconds);
    pauseNativeClapService(currentSettings.alarmDurationSeconds);

    setIsAlarmActive(true);
    setRemainingSeconds(currentSettings.alarmDurationSeconds);

    setStats((prev) => ({
      ...prev,
      totalTriggerCount: prev.totalTriggerCount + 1,
      waitingForSecondClap: false,
      clapsCount: 2,
    }));

    addDetectionLog({
      type: 'clap_2',
      label: '🚨 ALARM TERPICU!',
      details: `Memutar ${selectedSound.name} (${currentSettings.alarmDurationSeconds}s)`,
      status: 'success',
    });

    // System Notification if backgrounded
    if (typeof document !== 'undefined' && document.hidden) {
      sendClapDetectedNotification(
        '👏 HP Kamu Ditemukan!',
        `Pemicu terdeteksi! Memutar: ${selectedSound.name}`
      );
    }

    // Hardware vibration
    if (currentSettings.enableVibration) {
      triggerVibrationPattern([500, 200, 500, 200, 800]);
    }

    // Audio playback of exact chosen sound (preset or user recording)
    playAlarmSound(
      selectedSound,
      currentSettings.volume,
      currentSettings.alarmDurationSeconds,
      currentSettings.autoLoopAlarm,
      () => {
        handleStopAlarm();
      }
    );

    // Precise countdown interval based on absolute timestamp
    const alarmEndTime = Date.now() + currentSettings.alarmDurationSeconds * 1000;
    if (countdownIntervalRef.current) clearInterval(countdownIntervalRef.current);
    countdownIntervalRef.current = setInterval(() => {
      const remaining = Math.max(0, Math.ceil((alarmEndTime - Date.now()) / 1000));
      setRemainingSeconds(remaining);
      if (remaining <= 0) {
        handleStopAlarm();
      }
    }, 500);
  }, [handleStopAlarm, addDetectionLog]);

  // Keep a reference to triggerAlarm so callbacks passed to clapDetector never become stale
  const triggerAlarmRef = useRef(triggerAlarm);
  useEffect(() => {
    triggerAlarmRef.current = triggerAlarm;
  }, [triggerAlarm]);

  // Keep a reference to handleStopAlarm for background worker
  const handleStopAlarmRef = useRef(handleStopAlarm);
  useEffect(() => {
    handleStopAlarmRef.current = handleStopAlarm;
  }, [handleStopAlarm]);

  // Synchronize state when screen turns on or user re-opens the app
  useEffect(() => {
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        const isMuted = clapDetector.isAudioMuted();
        const alarmEndsAt = clapDetector.getAlarmEndsAt();
        const now = Date.now();

        // If alarm ended while screen was turned off, sync UI state immediately
        if (isMuted && alarmEndsAt > 0 && now >= alarmEndsAt) {
          handleStopAlarm();
        }
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [handleStopAlarm]);

  // Tepukan terdeteksi oleh service native saat layar mati -> layar sudah dinyalakan
  // dan aplikasi dibuka otomatis; di sini alarm langsung dibunyikan.
  const isAlarmActiveRef = useRef(isAlarmActive);
  useEffect(() => {
    isAlarmActiveRef.current = isAlarmActive;
  }, [isAlarmActive]);

  useEffect(() => {
    if (!isNativeAndroidApp()) return;

    const checkNativeTrigger = () => {
      if (!consumeNativePendingTrigger()) return;
      if (isAlarmActiveRef.current) return;
      addDetectionLog({
        type: 'clap_2',
        label: '👏 Tepukan terdeteksi saat layar mati',
        details: 'Layar dinyalakan & aplikasi dibuka otomatis',
        status: 'success',
      });
      triggerAlarmRef.current();
    };

    // Saat pertama dibuka (cold start dari trigger) dan setiap kali activity kembali tampil
    checkNativeTrigger();
    window.addEventListener('nativeClapCheck', checkNativeTrigger);
    document.addEventListener('visibilitychange', checkNativeTrigger);
    return () => {
      window.removeEventListener('nativeClapCheck', checkNativeTrigger);
      document.removeEventListener('visibilitychange', checkNativeTrigger);
    };
  }, [addDetectionLog]);

  // Toggle listening state
  const handleToggleListening = async () => {
    if (isListening) {
      clapDetector.stop();
      stopNativeClapService();
      setIsListening(false);
      setAudioRawData(null);
      setFftData(null);
      setCurrentAudioLevel(0);
      setStats((prev) => ({ ...prev, isListening: false, waitingForSecondClap: false, diagnostics: undefined }));
      addDetectionLog({
        type: 'rejected_sustained',
        label: 'Mikrofon Dinonaktifkan',
        details: 'Deteksi dimatikan oleh pengguna',
        status: 'info',
      });
    } else {
      setErrorMessage(null);
      addDetectionLog({
        type: 'valley_detected',
        label: 'Mikrofon Diaktifkan',
        details: 'Siaga mendengarkan suara & tepukan di latar belakang',
        status: 'info',
      });

      const success = await clapDetector.start(
        {
          onAudioLevelUpdate: (level, rawData, freqData, diagnostics) => {
            setCurrentAudioLevel(level);
            setAudioRawData(rawData);
            setFftData(freqData);
            setStats((prev) => ({
              ...prev,
              currentVolume: level,
              diagnostics,
            }));
          },
          onClapDetected: (clapIndex, totalNeeded) => {
            setStats((prev) => ({
              ...prev,
              clapsCount: clapIndex,
              waitingForSecondClap: clapIndex === 1 && totalNeeded === 2,
              lastClapTime: Date.now(),
            }));

            if (clapIndex === 1) {
              addDetectionLog({
                type: 'clap_1',
                label: '👏 Clap detected: 1/2',
                details: 'Tepukan ke-1 terdaftar. Silakan tepuk ke-2...',
                status: 'warning',
              });
            } else if (clapIndex === 2) {
              addDetectionLog({
                type: 'clap_2',
                label: '👏 Clap detected: 2/2',
                details: 'Tepukan ke-2 terverifikasi. Menyalakan alarm!',
                status: 'success',
              });
            }
          },
          onAlarmTrigger: () => {
            triggerAlarmRef.current();
          },
          onAlarmAutoEnd: () => {
            handleStopAlarmRef.current();
          },
          onEvent: (event) => {
            if (!event) return;
            let status: DetectionLogItem['status'] = 'info';
            if (event.type === 'clap_1') status = 'warning';
            if (event.type === 'clap_2' || event.type === 'single_clap') status = 'success';
            if (event.type === 'rejected_sustained') status = 'rejected';
            if (event.type === 'voice') status = 'success';

            addDetectionLog({
              type: event.type,
              label: event.description,
              status,
            });
          },
          onError: (err) => {
            setErrorMessage(err);
            setIsListening(false);
          },
          onStateChange: (listening) => {
            setIsListening(listening);
            setStats((prev) => ({ ...prev, isListening: listening }));
          },
          onSpeechRecognized: (transcript) => {
            setStats((prev) => ({ ...prev, lastRecognizedWord: transcript }));
            addDetectionLog({
              type: 'voice',
              label: `🗣️ Voice match: "${transcript}"`,
              details: 'Kata cocok dengan pengaturan',
              status: 'success',
            });
          },
        },
        settingsRef.current
      );

      if (!success) {
        setIsListening(false);
      } else if (isNativeAndroidApp()) {
        // Service native menjaga deteksi tetap hidup saat layar mati
        syncNativeClapService(settingsRef.current);
      }
    }
  };

  // Add new sound (recording or file)
  const handleAddSound = (newSound: SoundItem, asVoiceTrigger?: boolean) => {
    setSounds((prev) => {
      const next = [newSound, ...prev];
      const customOnly = next.filter((s) => s.category !== 'preset');
      saveCustomSoundList(customOnly);
      soundsRef.current = next;
      return next;
    });

    if (asVoiceTrigger) {
      const cleanWord = newSound.name.replace(/^[🎙️🗣️]\s*/, '').replace(/^Panggilan:\s*/, '');
      handleUpdateSettings({
        detectionMode: 'voice_call',
        voiceCallKeyword: cleanWord,
      });
    } else {
      // Set as the active alarm sound
      handleUpdateSettings({ selectedSoundId: newSound.id });
    }

    preloadCustomSound(newSound).catch((err) => {
      console.warn('Preload suara baru gagal:', err);
    });
  };

  // Delete sound
  const handleDeleteSound = (id: string) => {
    setSounds((prev) => {
      const next = prev.filter((s) => s.id !== id);
      const customOnly = next.filter((s) => s.category !== 'preset');
      saveCustomSoundList(customOnly);
      soundsRef.current = next;
      return next;
    });

    if (settingsRef.current.selectedSoundId === id) {
      handleUpdateSettings({ selectedSoundId: 'preset_police' });
    }
  };

  const activeSoundItem =
    sounds.find((s) => s.id === settings.selectedSoundId) || PRESET_SOUNDS[0];

  const customSoundsList = sounds.filter((s) => s.category !== 'preset');

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col items-center selection:bg-blue-600 selection:text-white">
      {/* Container */}
      <div className="w-full max-w-2xl px-4 py-5 flex-1 flex flex-col">
        {/* Header */}
        <Header
          isListening={isListening}
          onOpenGuide={handleActivateBackgroundMode}
        />

        {/* Error Alert if permission denied */}
        {errorMessage && (
          <div className="mb-5 p-4 rounded-2xl bg-red-950/80 border border-red-500/50 text-red-200 text-xs flex items-center justify-between gap-3 animate-in fade-in">
            <span>{errorMessage}</span>
            <button
              onClick={() => setErrorMessage(null)}
              className="text-red-400 hover:text-white font-bold"
            >
              Tutup
            </button>
          </div>
        )}

        {/* Main Sections */}
        <div className="space-y-6 flex-1">
          {/* Main Detector Card with Radar Button & Waveform */}
          <MainDetectorCard
            isListening={isListening}
            onToggleListening={handleToggleListening}
            stats={stats}
            settings={settings}
            audioRawData={audioRawData}
            activeSoundName={activeSoundItem.name}
            onSimulateClap={() => {
              if (!isListening) {
                triggerAlarm();
              } else {
                clapDetector.simulateClap();
              }
            }}
            onTriggerAlarmTest={triggerAlarm}
            onOpenGuide={handleActivateBackgroundMode}
            isWakeLockActive={isWakeLockActive}
          />

          {/* Real-time Fast Fourier Transform (FFT) & Pattern Verification */}
          <FFTSpectrumVisualizer
            isListening={isListening}
            fftData={fftData}
            currentVolume={currentAudioLevel}
            thresholdLevel={stats.thresholdLevel}
            stats={stats}
            settings={settings}
            detectionLogs={detectionLogs}
          />

          {/* Real-time Sensitivity & Detection Mode */}
          <SensitivityControl
            settings={settings}
            onChange={handleUpdateSettings}
            currentAudioLevel={currentAudioLevel}
            customSounds={customSoundsList}
            onOpenRecorderForTrigger={() => {
              setRecordForTriggerMode(true);
              setIsRecorderOpen(true);
            }}
            lastRecognizedWord={stats.lastRecognizedWord}
            isListening={isListening}
          />

          {/* Sound Selector (Presets, Recorded Voices, Uploaded Audio) */}
          <SoundSelector
            sounds={sounds}
            selectedSoundId={settings.selectedSoundId}
            volume={settings.volume}
            onSelectSound={(id) => {
              handleUpdateSettings({ selectedSoundId: id });
              const sObj = soundsRef.current.find((s) => s.id === id);
              if (sObj) {
                preloadCustomSound(sObj).catch(() => {});
              }
            }}
            onOpenRecorder={() => {
              setRecordForTriggerMode(false);
              setIsRecorderOpen(true);
            }}
            onAddSound={(snd) => handleAddSound(snd, false)}
            onDeleteSound={handleDeleteSound}
          />
        </div>

        {/* Footer info */}
        <footer className="mt-8 text-center text-[11px] text-slate-500 pb-6 border-t border-slate-900 pt-4">
          <p>
            Temukan HP Ku • Bekerja offline & tersimpan di memori perangkat • Deteksi tepuk tangan & panggilan suara pintar
          </p>
        </footer>
      </div>

      {/* Voice Recorder Modal */}
      <VoiceRecorderModal
        isOpen={isRecorderOpen}
        onClose={() => setIsRecorderOpen(false)}
        onSaved={handleAddSound}
        initialAsTrigger={recordForTriggerMode}
      />

      {/* Background Guide & HP Settings Modal */}
      <BackgroundGuideModal
        isOpen={isGuideOpen}
        onClose={() => setIsGuideOpen(false)}
        isWakeLockActive={isWakeLockActive}
        onToggleWakeLock={() => {
          if (isWakeLockActive) {
            releaseWakeLock().then(() => {
              setIsWakeLockActive(false);
              handleUpdateSettings({ enableWakeLock: false });
            });
          } else {
            requestWakeLock().then((act) => {
              setIsWakeLockActive(act);
              handleUpdateSettings({ enableWakeLock: act });
            });
          }
        }}
        onApplyAllSettings={handleActivateBackgroundMode}
      />

      {/* Full Screen Alarm Modal */}
      <AlarmActiveModal
        isOpen={isAlarmActive}
        onStop={handleStopAlarm}
        activeSound={activeSoundItem}
        remainingSeconds={remainingSeconds}
      />

      {/* Offline Connectivity Toast */}
      <OfflineIndicator />
    </div>
  );
}
