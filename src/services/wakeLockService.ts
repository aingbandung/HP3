// Screen Wake Lock API service to prevent screen sleep while listening

let wakeLockSentinel: any = null;
let isRequestedByUser = false;

export async function requestWakeLock(): Promise<boolean> {
  isRequestedByUser = true;
  if ('wakeLock' in navigator) {
    try {
      wakeLockSentinel = await (navigator as any).wakeLock.request('screen');
      wakeLockSentinel.addEventListener('release', () => {
        // If released involuntarily by system visibility change, re-acquire when visible
        if (isRequestedByUser && document.visibilityState === 'visible') {
          requestWakeLock();
        }
      });
      return true;
    } catch (err) {
      console.warn('Gagal memperoleh WakeLock:', err);
      return false;
    }
  }
  return false;
}

export async function releaseWakeLock(): Promise<void> {
  isRequestedByUser = false;
  if (wakeLockSentinel) {
    try {
      await wakeLockSentinel.release();
    } catch {
      // ignore
    }
    wakeLockSentinel = null;
  }
}

// Global visibility change handler
if (typeof document !== 'undefined') {
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && isRequestedByUser && !wakeLockSentinel) {
      requestWakeLock();
    }
  });
}
