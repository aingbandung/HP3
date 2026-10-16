import { AppSettings, SoundItem } from '../types';

const DB_NAME = 'TemukanHpKuDB';
const DB_VERSION = 1;
const AUDIO_STORE = 'custom_audio_blobs';
const SETTINGS_KEY = 'temukan_hp_settings_v1';
const SOUNDS_LIST_KEY = 'temukan_hp_sound_items_v1';

export const DEFAULT_SETTINGS: AppSettings = {
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
  doubleClapIntervalMin: 80,
  voiceCallKeyword: 'Halo HP',
};

export const PRESET_SOUNDS: SoundItem[] = [
  {
    id: 'preset_police',
    name: '🚨 Sirene Polisi Darurat',
    category: 'preset',
    presetKey: 'police',
  },
  {
    id: 'preset_digital',
    name: '⏰ Alarm Digital Penetrasi Keras',
    category: 'preset',
    presetKey: 'digital_beep',
  },
  {
    id: 'preset_airhorn',
    name: '🎺 Klakson Airhorn Nyaring',
    category: 'preset',
    presetKey: 'airhorn',
  },
  {
    id: 'preset_fire',
    name: '🔥 Alarm Kebakaran Melengking',
    category: 'preset',
    presetKey: 'fire_alarm',
  },
  {
    id: 'preset_sonar',
    name: '📡 Radar Sonar Militer',
    category: 'preset',
    presetKey: 'sonar_ping',
  },
  {
    id: 'preset_marimba',
    name: '🔔 Nada Dering Cepat & Ceria',
    category: 'preset',
    presetKey: 'marimba_alert',
  },
  {
    id: 'preset_voice_synth',
    name: '🗣️ Suara: "Halo! HP kamu ada di sini!"',
    category: 'preset',
    presetKey: 'voice_synthesis',
  },
];

// Open IndexedDB instance
function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (!('indexedDB' in window)) {
      return reject(new Error('IndexedDB tidak didukung pada browser ini.'));
    }
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = (event) => {
      const db = (event.target as IDBOpenDBRequest).result;
      if (!db.objectStoreNames.contains(AUDIO_STORE)) {
        db.createObjectStore(AUDIO_STORE, { keyPath: 'id' });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

// Save audio blob in IndexedDB
export async function saveAudioBlob(id: string, blob: Blob): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(AUDIO_STORE, 'readwrite');
    const store = tx.objectStore(AUDIO_STORE);
    const req = store.put({ id, blob, updatedAt: Date.now() });
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}

// Retrieve audio blob from IndexedDB
export async function getAudioBlob(id: string): Promise<Blob | null> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(AUDIO_STORE, 'readonly');
    const store = tx.objectStore(AUDIO_STORE);
    const req = store.get(id);
    req.onsuccess = () => {
      if (req.result && req.result.blob) {
        resolve(req.result.blob);
      } else {
        resolve(null);
      }
    };
    req.onerror = () => reject(req.error);
  });
}

// Delete audio blob from IndexedDB
export async function deleteAudioBlob(id: string): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(AUDIO_STORE, 'readwrite');
    const store = tx.objectStore(AUDIO_STORE);
    const req = store.delete(id);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}

// Load settings from localStorage
export function loadSettings(): AppSettings {
  try {
    const data = localStorage.getItem(SETTINGS_KEY);
    if (data) {
      return { ...DEFAULT_SETTINGS, ...JSON.parse(data) };
    }
  } catch (err) {
    console.warn('Gagal membaca pengaturan dari localStorage:', err);
  }
  return DEFAULT_SETTINGS;
}

// Save settings to localStorage
export function saveSettings(settings: AppSettings): void {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
  } catch (err) {
    console.error('Gagal menyimpan pengaturan ke localStorage:', err);
  }
}

// Load custom sound metadata list (without raw blob)
export function loadCustomSoundList(): SoundItem[] {
  try {
    const data = localStorage.getItem(SOUNDS_LIST_KEY);
    if (data) {
      return JSON.parse(data);
    }
  } catch (err) {
    console.warn('Gagal membaca daftar suara kustom:', err);
  }
  return [];
}

// Save custom sound metadata list
export function saveCustomSoundList(sounds: SoundItem[]): void {
  try {
    const stripped = sounds.map(({ id, name, category, duration, dateAdded }) => ({
      id,
      name,
      category,
      duration,
      dateAdded,
    }));
    localStorage.setItem(SOUNDS_LIST_KEY, JSON.stringify(stripped));
  } catch (err) {
    console.error('Gagal menyimpan daftar suara kustom:', err);
  }
}
