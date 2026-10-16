package com.firdaus.temukanhp;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.ServiceInfo;
import android.media.AudioFormat;
import android.media.AudioRecord;
import android.media.MediaRecorder;
import android.os.Build;
import android.os.IBinder;
import android.os.PowerManager;

import androidx.core.app.NotificationCompat;

/**
 * Foreground service (tipe microphone) yang mendeteksi tepukan LANGSUNG di sisi native.
 * Berjalan terus walau layar mati / WebView dibekukan Android.
 *
 * Saat tepukan (sesuai mode) terdeteksi:
 *  1. Layar dinyalakan (wake lock + ACQUIRE_CAUSES_WAKEUP)
 *  2. MainActivity dibuka di atas layar kunci (startActivity + full-screen intent)
 *  3. Flag "pending trigger" disimpan; JavaScript membacanya lalu membunyikan alarm
 *
 * Saat aplikasi tampil di layar (uiVisible = true) service melepas mikrofon supaya
 * tidak bentrok dengan getUserMedia milik WebView.
 */
public class ClapService extends Service {

    public static final String ACTION_START = "com.firdaus.temukanhp.CLAP_START";
    public static final String ACTION_STOP = "com.firdaus.temukanhp.CLAP_STOP";

    public static final String EXTRA_MODE = "mode";
    public static final String EXTRA_TARGET_DB = "targetDb";
    public static final String EXTRA_MIN_MS = "minMs";
    public static final String EXTRA_MAX_MS = "maxMs";
    public static final String EXTRA_ALARM_SEC = "alarmSec";

    public static final String PREFS = "clap_service_prefs";
    public static final String KEY_PENDING = "pending_trigger_at";
    public static final String KEY_ENABLED = "enabled";

    private static final String CH_LISTEN = "clap_listen";
    private static final String CH_ALERT = "clap_alert";
    private static final int NOTIF_LISTEN = 7101;
    private static final int NOTIF_ALERT = 7102;

    private static final int SAMPLE_RATE = 16000;
    private static final int FRAME = 320; // 20 ms per frame

    // ---- state yang dibaca/ditulis dari thread lain ----
    public static volatile boolean running = false;
    public static volatile boolean uiVisible = false;
    private static volatile long muteUntil = 0L;

    private volatile String mode = "double_clap";
    private volatile int targetDb = 48;
    private volatile int minMs = 80;
    private volatile int maxMs = 1400;
    private volatile int alarmSec = 15;

    private Thread worker;
    private PowerManager.WakeLock cpuLock;

    // ---- DSP state (hanya diakses worker thread) ----
    private double ambientRms = 0.015;
    private long refractoryUntil = 0L;
    private boolean verifying = false;
    private long candStart = 0L;
    private double candRms = 0.0;
    private int sustained = 0;
    private int pendingType = 0; // 1 = single, 2 = double pertama, 3 = double kedua
    private int stage = 0;
    private long clap1At = 0L;
    private int loudFrames = 0;

    // ------------------------------------------------------------------
    // Pengendali statis (dipanggil dari MainActivity / AndroidBridge)
    // ------------------------------------------------------------------
    public static void start(Context ctx, String mode, int targetDb, int minMs, int maxMs, int alarmSec) {
        Intent i = new Intent(ctx, ClapService.class);
        i.setAction(ACTION_START);
        i.putExtra(EXTRA_MODE, mode);
        i.putExtra(EXTRA_TARGET_DB, targetDb);
        i.putExtra(EXTRA_MIN_MS, minMs);
        i.putExtra(EXTRA_MAX_MS, maxMs);
        i.putExtra(EXTRA_ALARM_SEC, alarmSec);
        if (Build.VERSION.SDK_INT >= 26) {
            ctx.startForegroundService(i);
        } else {
            ctx.startService(i);
        }
    }

    public static void stop(Context ctx) {
        ctx.getSharedPreferences(PREFS, MODE_PRIVATE).edit().putBoolean(KEY_ENABLED, false).apply();
        ctx.stopService(new Intent(ctx, ClapService.class));
    }

    public static void pauseFor(int seconds) {
        muteUntil = System.currentTimeMillis() + Math.max(1, seconds) * 1000L + 500L;
    }

    public static void resumeNow() {
        muteUntil = System.currentTimeMillis() + 600L; // jeda singkat anti-gema alarm
    }

    /** Ambil & hapus penanda trigger. true jika ada trigger yang belum diproses (<= 90 detik). */
    public static boolean consumePending(Context ctx) {
        SharedPreferences sp = ctx.getSharedPreferences(PREFS, MODE_PRIVATE);
        long at = sp.getLong(KEY_PENDING, 0L);
        if (at <= 0L) return false;
        sp.edit().remove(KEY_PENDING).apply();
        return System.currentTimeMillis() - at <= 90_000L;
    }

    // ------------------------------------------------------------------
    // Lifecycle
    // ------------------------------------------------------------------
    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        SharedPreferences sp = getSharedPreferences(PREFS, MODE_PRIVATE);

        if (intent != null && ACTION_STOP.equals(intent.getAction())) {
            sp.edit().putBoolean(KEY_ENABLED, false).apply();
            stopSelf();
            return START_NOT_STICKY;
        }

        if (intent != null && ACTION_START.equals(intent.getAction())) {
            mode = intent.getStringExtra(EXTRA_MODE) != null ? intent.getStringExtra(EXTRA_MODE) : "double_clap";
            targetDb = intent.getIntExtra(EXTRA_TARGET_DB, 48);
            minMs = intent.getIntExtra(EXTRA_MIN_MS, 80);
            maxMs = intent.getIntExtra(EXTRA_MAX_MS, 1400);
            alarmSec = intent.getIntExtra(EXTRA_ALARM_SEC, 15);
            sp.edit()
                .putBoolean(KEY_ENABLED, true)
                .putString(EXTRA_MODE, mode)
                .putInt(EXTRA_TARGET_DB, targetDb)
                .putInt(EXTRA_MIN_MS, minMs)
                .putInt(EXTRA_MAX_MS, maxMs)
                .putInt(EXTRA_ALARM_SEC, alarmSec)
                .apply();
        } else {
            // restart otomatis oleh sistem (START_STICKY) -> pakai konfigurasi tersimpan
            if (!sp.getBoolean(KEY_ENABLED, false)) {
                stopSelf();
                return START_NOT_STICKY;
            }
            mode = sp.getString(EXTRA_MODE, "double_clap");
            targetDb = sp.getInt(EXTRA_TARGET_DB, 48);
            minMs = sp.getInt(EXTRA_MIN_MS, 80);
            maxMs = sp.getInt(EXTRA_MAX_MS, 1400);
            alarmSec = sp.getInt(EXTRA_ALARM_SEC, 15);
        }

        try {
            createChannels();
            Notification n = buildListeningNotification();
            if (Build.VERSION.SDK_INT >= 29) {
                startForeground(NOTIF_LISTEN, n, ServiceInfo.FOREGROUND_SERVICE_TYPE_MICROPHONE);
            } else {
                startForeground(NOTIF_LISTEN, n);
            }
        } catch (Exception e) {
            e.printStackTrace();
            stopSelf();
            return START_NOT_STICKY;
        }

        acquireCpuLock();

        if (!running) {
            running = true;
            worker = new Thread(this::loop, "ClapDetectorThread");
            worker.setPriority(Thread.MAX_PRIORITY);
            worker.start();
        }
        return START_STICKY;
    }

    @Override
    public void onDestroy() {
        running = false;
        if (worker != null) {
            worker.interrupt();
            worker = null;
        }
        if (cpuLock != null && cpuLock.isHeld()) {
            try { cpuLock.release(); } catch (Exception ignored) {}
        }
        super.onDestroy();
    }

    private void acquireCpuLock() {
        try {
            if (cpuLock == null) {
                PowerManager pm = (PowerManager) getSystemService(Context.POWER_SERVICE);
                cpuLock = pm.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "temukanhp:clap-cpu");
                cpuLock.setReferenceCounted(false);
            }
            if (!cpuLock.isHeld()) cpuLock.acquire();
        } catch (Exception e) {
            e.printStackTrace();
        }
    }

    // ------------------------------------------------------------------
    // Notifikasi
    // ------------------------------------------------------------------
    private void createChannels() {
        if (Build.VERSION.SDK_INT < 26) return;
        NotificationManager nm = (NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE);
        NotificationChannel listen = new NotificationChannel(
            CH_LISTEN, "Pemantau Tepukan", NotificationManager.IMPORTANCE_LOW);
        listen.setDescription("Menjaga mikrofon tetap aktif saat layar mati");
        nm.createNotificationChannel(listen);

        NotificationChannel alert = new NotificationChannel(
            CH_ALERT, "Alarm Temukan HP", NotificationManager.IMPORTANCE_HIGH);
        alert.setDescription("Membuka aplikasi saat tepukan terdeteksi");
        alert.enableVibration(true);
        alert.setBypassDnd(true);
        nm.createNotificationChannel(alert);
    }

    private PendingIntent launchPendingIntent() {
        Intent i = new Intent(this, MainActivity.class);
        i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        i.putExtra("from_clap_trigger", true);
        int f = PendingIntent.FLAG_UPDATE_CURRENT;
        if (Build.VERSION.SDK_INT >= 23) f |= PendingIntent.FLAG_IMMUTABLE;
        return PendingIntent.getActivity(this, 0, i, f);
    }

    private Notification buildListeningNotification() {
        Intent open = new Intent(this, MainActivity.class);
        open.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP);
        int f = PendingIntent.FLAG_UPDATE_CURRENT;
        if (Build.VERSION.SDK_INT >= 23) f |= PendingIntent.FLAG_IMMUTABLE;
        PendingIntent pi = PendingIntent.getActivity(this, 1, open, f);

        return new NotificationCompat.Builder(this, CH_LISTEN)
            .setContentTitle("Temukan HP aktif")
            .setContentText("Mendengarkan tepukan, termasuk saat layar mati")
            .setSmallIcon(android.R.drawable.ic_btn_speak_now)
            .setOngoing(true)
            .setContentIntent(pi)
            .setPriority(NotificationCompat.PRIORITY_LOW)
            .setCategory(NotificationCompat.CATEGORY_SERVICE)
            .build();
    }

    // ------------------------------------------------------------------
    // Loop rekam + deteksi
    // ------------------------------------------------------------------
    private AudioRecord openRecorder() {
        int minBuf = AudioRecord.getMinBufferSize(
            SAMPLE_RATE, AudioFormat.CHANNEL_IN_MONO, AudioFormat.ENCODING_PCM_16BIT);
        int bufSize = Math.max(minBuf * 2, 8192);
        int[] sources = Build.VERSION.SDK_INT >= 24
            ? new int[]{MediaRecorder.AudioSource.UNPROCESSED, MediaRecorder.AudioSource.VOICE_RECOGNITION, MediaRecorder.AudioSource.MIC}
            : new int[]{MediaRecorder.AudioSource.VOICE_RECOGNITION, MediaRecorder.AudioSource.MIC};
        for (int src : sources) {
            try {
                AudioRecord r = new AudioRecord(src, SAMPLE_RATE,
                    AudioFormat.CHANNEL_IN_MONO, AudioFormat.ENCODING_PCM_16BIT, bufSize);
                if (r.getState() == AudioRecord.STATE_INITIALIZED) {
                    r.startRecording();
                    if (r.getRecordingState() == AudioRecord.RECORDSTATE_RECORDING) return r;
                }
                r.release();
            } catch (Exception ignored) {
            }
        }
        return null;
    }

    private void releaseRecorder(AudioRecord r) {
        if (r == null) return;
        try { r.stop(); } catch (Exception ignored) {}
        try { r.release(); } catch (Exception ignored) {}
    }

    private void resetDsp() {
        verifying = false;
        pendingType = 0;
        sustained = 0;
        stage = 0;
        clap1At = 0L;
        loudFrames = 0;
    }

    private void loop() {
        AudioRecord rec = null;
        short[] buf = new short[FRAME];
        boolean wasIdle = true;

        while (running) {
            long now = System.currentTimeMillis();
            boolean idle = uiVisible
                || now < muteUntil
                || "voice_call".equals(mode); // mode suara memakai SpeechRecognition di WebView

            if (idle) {
                if (rec != null) { releaseRecorder(rec); rec = null; }
                wasIdle = true;
                try { Thread.sleep(100); } catch (InterruptedException e) { break; }
                continue;
            }

            if (wasIdle) {
                resetDsp();
                refractoryUntil = now + 600L;
                wasIdle = false;
            }

            if (rec == null) {
                rec = openRecorder();
                if (rec == null) {
                    try { Thread.sleep(1000); } catch (InterruptedException e) { break; }
                    continue;
                }
            }

            int n = rec.read(buf, 0, FRAME);
            if (n <= 0) {
                if (n < 0) { releaseRecorder(rec); rec = null; }
                try { Thread.sleep(20); } catch (InterruptedException e) { break; }
                continue;
            }

            processFrame(buf, n, System.currentTimeMillis());
        }

        releaseRecorder(rec);
        running = false;
    }

    private void processFrame(short[] s, int len, long now) {
        double sumSq = 0, sumDiffSq = 0, peak = 0;
        double prev = 0;
        for (int i = 0; i < len; i++) {
            double v = s[i] / 32768.0;
            double a = Math.abs(v);
            if (a > peak) peak = a;
            sumSq += v * v;
            double d = v - prev;
            sumDiffSq += d * d;
            prev = v;
        }
        double rms = Math.sqrt(sumSq / len);
        double crest = peak / (rms + 0.00001);
        double hfRatio = Math.sqrt(sumDiffSq / len) / (rms + 0.00001);

        // Ambient adaptif
        if (rms < ambientRms * 1.5 && peak < 0.12) {
            ambientRms = ambientRms * 0.96 + rms * 0.04;
        }
        ambientRms = Math.max(0.004, Math.min(0.06, ambientRms));

        if (now < refractoryUntil) return;

        double td = targetDb / 100.0;
        double minPeak = Math.max(0.08, td * 0.88);
        double minSpike = Math.max(1.7, td * 3.8);
        double minCrest = Math.max(1.95, 2.7 - td * 0.6);

        boolean loudEnough = peak >= minPeak;
        boolean spike = rms >= ambientRms * minSpike || peak >= minPeak * 1.35;
        boolean impulsive = crest >= minCrest;
        boolean sharp = hfRatio > 0.30 || peak >= minPeak * 1.55;
        boolean candidate = loudEnough && spike && impulsive && sharp;

        // ---- Mode suara keras / peluit ----
        if ("loud_sound".equals(mode)) {
            double minSustained = Math.max(0.18, td * 1.1);
            if (peak >= minSustained && rms > ambientRms * 2.8) {
                if (++loudFrames >= 16) { loudFrames = 0; fireTrigger(now); }
            } else {
                loudFrames = Math.max(0, loudFrames - 1);
            }
            return;
        }

        // ---- Verifikasi bahwa suara memang impuls (bukan bicara panjang) ----
        if (verifying) {
            long el = now - candStart;
            if (el <= 40 && rms > candRms) candRms = rms;
            if (el >= 60 && rms > candRms * 0.5 && peak > minPeak * 0.8) sustained++;
            if (sustained >= 3) {
                verifying = false;
                pendingType = 0;
                refractoryUntil = now + 300L;
                return;
            }
            if (el >= 100) {
                verifying = false;
                int type = pendingType;
                pendingType = 0;
                onClapConfirmed(type, candStart, now);
            }
            return;
        }

        // ---- Jendela tepuk ke-2 kedaluwarsa ----
        if (stage == 1 && now - clap1At > maxMs) {
            stage = 0;
        }

        if (!candidate) return;

        if ("single_clap".equals(mode)) {
            beginVerify(now, rms, 1);
            return;
        }

        // double_clap (default)
        if (stage == 0) {
            beginVerify(now, rms, 2);
        } else {
            long delta = now - clap1At;
            long gap = Math.max(minMs, 200);
            if (delta >= gap && delta <= maxMs) {
                beginVerify(now, rms, 3);
            }
        }
    }

    private void beginVerify(long now, double rms, int type) {
        verifying = true;
        candStart = now;
        candRms = rms;
        sustained = 0;
        pendingType = type;
    }

    private void onClapConfirmed(int type, long clapAt, long now) {
        if (type == 1) {
            refractoryUntil = now + 1500L;
            fireTrigger(now);
        } else if (type == 2) {
            stage = 1;
            clap1At = clapAt;
            refractoryUntil = now + 60L;
        } else if (type == 3) {
            stage = 0;
            refractoryUntil = now + 2000L;
            fireTrigger(now);
        }
    }

    // ------------------------------------------------------------------
    // Trigger: nyalakan layar + buka aplikasi
    // ------------------------------------------------------------------
    private void fireTrigger(long now) {
        muteUntil = now + alarmSec * 1000L + 1000L;
        resetDsp();

        getSharedPreferences(PREFS, MODE_PRIVATE).edit().putLong(KEY_PENDING, now).apply();

        // 1. Nyalakan layar
        try {
            PowerManager pm = (PowerManager) getSystemService(Context.POWER_SERVICE);
            @SuppressWarnings("deprecation")
            PowerManager.WakeLock screen = pm.newWakeLock(
                PowerManager.SCREEN_BRIGHT_WAKE_LOCK
                    | PowerManager.ACQUIRE_CAUSES_WAKEUP
                    | PowerManager.ON_AFTER_RELEASE,
                "temukanhp:screen-on");
            screen.acquire(15_000L);
        } catch (Exception e) {
            e.printStackTrace();
        }

        // 2. Notifikasi full-screen intent (cara resmi membuka Activity dari background)
        try {
            createChannels();
            Notification alert = new NotificationCompat.Builder(this, CH_ALERT)
                .setContentTitle("👏 HP Kamu Ditemukan!")
                .setContentText("Tepukan terdeteksi - ketuk untuk membuka")
                .setSmallIcon(android.R.drawable.ic_btn_speak_now)
                .setPriority(NotificationCompat.PRIORITY_MAX)
                .setCategory(NotificationCompat.CATEGORY_ALARM)
                .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
                .setAutoCancel(true)
                .setContentIntent(launchPendingIntent())
                .setFullScreenIntent(launchPendingIntent(), true)
                .build();
            NotificationManager nm = (NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE);
            nm.notify(NOTIF_ALERT, alert);
        } catch (Exception e) {
            e.printStackTrace();
        }

        // 3. Langsung buka Activity (berhasil bila izin "tampil di atas aplikasi lain" diberikan
        //    atau sistem mengizinkan); full-screen intent di atas jadi cadangan.
        try {
            Intent i = new Intent(this, MainActivity.class);
            i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP
                | Intent.FLAG_ACTIVITY_CLEAR_TOP | Intent.FLAG_ACTIVITY_REORDER_TO_FRONT);
            i.putExtra("from_clap_trigger", true);
            startActivity(i);
        } catch (Exception e) {
            e.printStackTrace();
        }
    }

    public static void cancelAlertNotification(Context ctx) {
        try {
            NotificationManager nm = (NotificationManager) ctx.getSystemService(Context.NOTIFICATION_SERVICE);
            nm.cancel(NOTIF_ALERT);
        } catch (Exception ignored) {
        }
    }
}
