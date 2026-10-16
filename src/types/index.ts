export type DetectionMode = 'double_clap' | 'single_clap' | 'voice_call' | 'loud_sound';

export interface SoundItem {
  id: string;
  name: string;
  category: 'preset' | 'recorded' | 'uploaded';
  duration?: number;
  dateAdded?: number;
  presetKey?: 'police' | 'digital_beep' | 'airhorn' | 'fire_alarm' | 'sonar_ping' | 'marimba_alert' | 'voice_synthesis';
  audioBlob?: Blob;
  audioUrl?: string;
  isVoiceTrigger?: boolean;
}

export interface AppSettings {
  sensitivity: number; // 1 to 100
  targetTriggerDb?: number; // Target trigger dB threshold (e.g. 25 - 95 dB)
  detectionMode: DetectionMode;
  selectedSoundId: string;
  volume: number; // 0 to 1
  enableVibration: boolean;
  enableWakeLock: boolean;
  alarmDurationSeconds: number;
  autoLoopAlarm: boolean;
  doubleClapIntervalMax: number; // ms, default 1400ms
  doubleClapIntervalMin: number; // ms, default 120ms
  voiceCallKeyword: string; // e.g. "Halo HP" / "Dimana Kamu" / custom
}

export interface DetectionLogItem {
  id: string;
  time: string;
  type: 'clap_1' | 'clap_2' | 'single_clap' | 'voice' | 'rejected_sustained' | 'valley_detected' | 'calibrated';
  label: string;
  details?: string;
  status: 'success' | 'warning' | 'info' | 'rejected';
}

export interface AudioDiagnostics {
  peak: number; // 0 to 1
  rms: number; // 0 to 1
  crestFactor: number;
  lowEnergy: number;
  midEnergy: number;
  highEnergy: number;
  highRatio: number;
  recentEvent?: {
    type: 'clap_1' | 'clap_2' | 'single_clap' | 'voice' | 'rejected_sustained' | 'valley_detected' | 'calibrated';
    time: number;
    description: string;
  };
}

export interface DetectionStats {
  isListening: boolean;
  currentVolume: number; // 0 to 100
  thresholdLevel: number; // 0 to 100
  lastClapTime: number | null;
  clapsCount: number;
  waitingForSecondClap: boolean;
  totalTriggerCount: number;
  lastRecognizedWord?: string;
  diagnostics?: AudioDiagnostics;
  detectionLogs?: DetectionLogItem[];
}
