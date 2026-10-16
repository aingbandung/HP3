/**
 * Service to directly configure Android and device background capabilities
 * Handles Wake Lock, Notification permissions, MediaSession keep-alive,
 * and direct deep-linking/native bridges to Android Battery & App Settings.
 */

import { requestWakeLock } from './wakeLockService';
import { requestNotificationPermission, triggerVibrationPattern } from './notificationService';
import { clapDetector } from './clapDetector';
import { AppSettings } from '../types';

declare global {
  interface Window {
    AndroidBridge?: {
      openBatterySettings: () => void;
      openAppSettings: () => void;
      requestIgnoreBatteryOptimizations?: () => void;
      isIgnoringBatteryOptimizations: () => boolean;
      isNativeAndroid: () => boolean;
      // Deteksi tepuk native (foreground service) - tetap jalan saat layar mati
      startClapService?: (mode: string, targetDb: number, minMs: number, maxMs: number, alarmSec: number) => void;
      stopClapService?: () => void;
      isClapServiceRunning?: () => boolean;
      pauseClapService?: (seconds: number) => void;
      resumeClapService?: () => void;
      consumePendingTrigger?: () => boolean;
      canDrawOverlays?: () => boolean;
      openOverlaySettings?: () => void;
    };
  }
}

export interface BackgroundSettingsStatus {
  wakeLockActive: boolean;
  notificationsPermission: NotificationPermission | 'unsupported';
  mediaSessionActive: boolean;
  isNativeApp: boolean;
  batterySettingsTriggered: boolean;
}

export const isNativeAndroidApp = (): boolean => {
  return typeof window !== 'undefined' && Boolean(window.AndroidBridge?.isNativeAndroid?.());
};

export const isAndroidDevice = (): boolean => {
  if (typeof navigator === 'undefined') return false;
  return isNativeAndroidApp() || /Android/i.test(navigator.userAgent);
};

export const isBatteryOptimizationIgnored = (): boolean => {
  if (typeof window !== 'undefined' && window.AndroidBridge?.isIgnoringBatteryOptimizations) {
    try {
      return window.AndroidBridge.isIgnoringBatteryOptimizations();
    } catch {
      return false;
    }
  }
  return false;
};

/**
 * Directly open Android System Settings for Battery Optimization / Unrestricted
 */
export const openAndroidBatterySettings = (): boolean => {
  try {
    // 1. If running as native Android APK with AndroidBridge
    if (typeof window !== 'undefined' && window.AndroidBridge?.openBatterySettings) {
      window.AndroidBridge.openBatterySettings();
      return true;
    }

    // 2. If running on Android Chrome / PWA browser
    if (isAndroidDevice()) {
      // Try opening directly via Android Intent URL
      const intentUrl = 'intent:#Intent;action=android.settings.IGNORE_BATTERY_OPTIMIZATION_SETTINGS;end';
      const fallbackUrl = 'intent:#Intent;action=android.settings.APPLICATION_DETAILS_SETTINGS;package=com.firdaus.temukanhp;end';
      
      try {
        window.location.href = intentUrl;
      } catch {
        window.location.href = fallbackUrl;
      }
      return true;
    }
  } catch (err) {
    console.warn('Gagal membuka pengaturan baterai HP secara otomatis:', err);
  }
  return false;
};

/**
 * Directly open Android System App Details Settings
 */
export const openAndroidAppSettings = (): boolean => {
  try {
    if (typeof window !== 'undefined' && window.AndroidBridge?.openAppSettings) {
      window.AndroidBridge.openAppSettings();
      return true;
    }

    if (isAndroidDevice()) {
      window.location.href = 'intent:#Intent;action=android.settings.APPLICATION_DETAILS_SETTINGS;package=com.firdaus.temukanhp;end';
      return true;
    }
  } catch (err) {
    console.warn('Gagal membuka Pengaturan Aplikasi HP:', err);
  }
  return false;
};

/**
 * When user taps "Mode Background", directly set all relevant device settings:
 * 1. Screen Wake Lock (keeps display active / prevents deep suspend)
 * 2. System Notification Permission (needed for foreground alerts & background stay-alive)
 * 3. MediaSession & Audio keep-alive (tricks mobile OS into treating tab as media player)
 * 4. Triggers Android Battery Optimization settings dialog
 * 5. Haptic vibration feedback
 */
export const applyAllBackgroundSettings = async (
  openNativeSettings: boolean = true
): Promise<BackgroundSettingsStatus> => {
  // Haptic feedback to confirm immediate execution
  triggerVibrationPattern([70, 40, 70]);

  // 1. Screen Wake Lock
  let wakeLockActive = false;
  try {
    wakeLockActive = await requestWakeLock();
  } catch (e) {
    console.warn('Wake Lock request error:', e);
  }

  // 2. System Notification Permission
  let notifPerm: NotificationPermission | 'unsupported' = 'unsupported';
  try {
    notifPerm = await requestNotificationPermission();
  } catch (e) {
    console.warn('Notification permission request error:', e);
  }

  // 3. Audio & MediaSession Keep-Alive
  let mediaSessionActive = false;
  try {
    clapDetector.ensureBackgroundKeepAlive();
    mediaSessionActive = true;
  } catch (e) {
    console.warn('MediaSession keep-alive error:', e);
  }

  // 4. Open native battery optimization / app settings if available
  let batteryTriggered = false;
  if (openNativeSettings) {
    if (isNativeAndroidApp()) {
      batteryTriggered = openAndroidBatterySettings();
    }
  }

  return {
    wakeLockActive,
    notificationsPermission: notifPerm,
    mediaSessionActive,
    isNativeApp: isNativeAndroidApp(),
    batterySettingsTriggered: batteryTriggered,
  };
};

// ===========================================================================
// NATIVE CLAP SERVICE (APK Android): deteksi tepuk tetap hidup saat layar mati
// dan membuka aplikasi otomatis ketika tepukan terdeteksi.
// ===========================================================================

export const syncNativeClapService = (s: AppSettings): void => {
  try {
    const targetDb =
      s.targetTriggerDb !== undefined
        ? s.targetTriggerDb
        : Math.round(54 - (s.sensitivity / 100) * 42);
    window.AndroidBridge?.startClapService?.(
      s.detectionMode,
      Math.round(targetDb),
      Math.round(s.doubleClapIntervalMin),
      Math.round(s.doubleClapIntervalMax),
      Math.round(s.alarmDurationSeconds)
    );
  } catch (e) {
    console.warn('Gagal menyalakan ClapService native:', e);
  }
};

export const stopNativeClapService = (): void => {
  try {
    window.AndroidBridge?.stopClapService?.();
  } catch {
    // ignore
  }
};

export const pauseNativeClapService = (seconds: number): void => {
  try {
    window.AndroidBridge?.pauseClapService?.(Math.round(seconds));
  } catch {
    // ignore
  }
};

export const resumeNativeClapService = (): void => {
  try {
    window.AndroidBridge?.resumeClapService?.();
  } catch {
    // ignore
  }
};

/** true sekali saja jika service native sudah mendeteksi tepukan saat layar mati. */
export const consumeNativePendingTrigger = (): boolean => {
  try {
    return Boolean(window.AndroidBridge?.consumePendingTrigger?.());
  } catch {
    return false;
  }
};

export const canDrawOverApps = (): boolean => {
  try {
    return Boolean(window.AndroidBridge?.canDrawOverlays?.());
  } catch {
    return false;
  }
};

export const openOverlaySettings = (): boolean => {
  try {
    if (window.AndroidBridge?.openOverlaySettings) {
      window.AndroidBridge.openOverlaySettings();
      return true;
    }
  } catch {
    // ignore
  }
  return false;
};
