// Notification & Background alert service

export async function requestNotificationPermission(): Promise<NotificationPermission> {
  if (!('Notification' in window)) {
    return 'denied';
  }
  if (Notification.permission === 'granted') {
    return 'granted';
  }
  try {
    return await Notification.requestPermission();
  } catch {
    return 'denied';
  }
}

export function sendClapDetectedNotification(title = '👏 HP Kamu Ditemukan!', body = 'Tepukan tangan terdeteksi! Alarm sedang berbunyi keras.') {
  if ('Notification' in window && Notification.permission === 'granted') {
    try {
      const notif = new Notification(title, {
        body,
        icon: '/pwa-192x192.png',
        badge: '/icon.svg',
        tag: 'clap-detected',
        requireInteraction: true,
      });

      notif.onclick = () => {
        window.focus();
        notif.close();
      };
    } catch (err) {
      console.warn('Gagal menampilkan notifikasi sistem:', err);
    }
  }
}

export function triggerVibrationPattern(pattern: number[] = [400, 150, 400, 150, 800]): void {
  if ('vibrate' in navigator) {
    try {
      navigator.vibrate(pattern);
    } catch {
      // ignore
    }
  }
}

export function stopVibration(): void {
  if ('vibrate' in navigator) {
    try {
      navigator.vibrate(0);
    } catch {
      // ignore
    }
  }
}
