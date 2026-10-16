package com.firdaus.temukanhp;

import android.Manifest;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.PowerManager;
import android.provider.Settings;
import android.view.WindowManager;
import android.webkit.JavascriptInterface;
import android.webkit.WebSettings;
import android.webkit.WebView;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {

    @Override
    public void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        try {
            // Layar tetap menyala selama aplikasi terbuka
            getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);

            WebView webView = this.getBridge().getWebView();
            if (webView != null) {
                WebSettings settings = webView.getSettings();
                settings.setMediaPlaybackRequiresUserGesture(false);
                settings.setJavaScriptEnabled(true);
                webView.addJavascriptInterface(new AndroidBridge(), "AndroidBridge");
            }
        } catch (Exception e) {
            e.printStackTrace();
        }

        applyTriggerWindowFlags(getIntent());
        requestNotificationPermissionIfNeeded();
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        applyTriggerWindowFlags(intent);
    }

    @Override
    public void onResume() {
        super.onResume();
        // Aplikasi tampil -> service melepas mikrofon, WebView yang mendeteksi
        ClapService.uiVisible = true;
        ClapService.cancelAlertNotification(this);
        notifyJsToCheckTrigger();
    }

    @Override
    public void onPause() {
        // Layar mati / aplikasi ke latar -> service native mengambil alih mikrofon
        ClapService.uiVisible = false;
        super.onPause();
    }

    @Override
    public void onStop() {
        // Jangan biarkan aplikasi terus muncul di atas layar kunci setelah alarm selesai
        setShowOverLock(false);
        super.onStop();
    }

    /** Aktifkan "tampil di atas layar kunci + nyalakan layar" hanya jika dibuka oleh trigger tepuk. */
    private void applyTriggerWindowFlags(Intent intent) {
        if (intent != null && intent.getBooleanExtra("from_clap_trigger", false)) {
            setShowOverLock(true);
        }
    }

    @SuppressWarnings("deprecation")
    private void setShowOverLock(boolean enable) {
        try {
            if (Build.VERSION.SDK_INT >= 27) {
                setShowWhenLocked(enable);
                setTurnScreenOn(enable);
            } else {
                int f = WindowManager.LayoutParams.FLAG_SHOW_WHEN_LOCKED
                    | WindowManager.LayoutParams.FLAG_TURN_SCREEN_ON
                    | WindowManager.LayoutParams.FLAG_DISMISS_KEYGUARD;
                if (enable) getWindow().addFlags(f);
                else getWindow().clearFlags(f);
            }
        } catch (Exception ignored) {
        }
    }

    private void requestNotificationPermissionIfNeeded() {
        try {
            if (Build.VERSION.SDK_INT >= 33
                && checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) {
                requestPermissions(new String[]{Manifest.permission.POST_NOTIFICATIONS}, 7001);
            }
        } catch (Exception ignored) {
        }
    }

    /** Minta JS memeriksa apakah ada trigger tepuk yang menunggu. */
    private void notifyJsToCheckTrigger() {
        try {
            final WebView webView = this.getBridge().getWebView();
            if (webView != null) {
                webView.post(() -> webView.evaluateJavascript(
                    "window.dispatchEvent(new Event('nativeClapCheck'));", null));
            }
        } catch (Exception ignored) {
        }
    }

    public class AndroidBridge {
        // ---------------- Pengaturan baterai / aplikasi ----------------
        @JavascriptInterface
        public void openBatterySettings() {
            try {
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
                    String packageName = getPackageName();
                    PowerManager pm = (PowerManager) getSystemService(POWER_SERVICE);
                    Intent intent = new Intent();
                    if (pm != null && !pm.isIgnoringBatteryOptimizations(packageName)) {
                        intent.setAction(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS);
                        intent.setData(Uri.parse("package:" + packageName));
                    } else {
                        intent.setAction(Settings.ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS);
                    }
                    intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                    startActivity(intent);
                } else {
                    openAppSettings();
                }
            } catch (Exception e) {
                openAppSettings();
            }
        }

        @JavascriptInterface
        public void openAppSettings() {
            try {
                Intent intent = new Intent();
                intent.setAction(Settings.ACTION_APPLICATION_DETAILS_SETTINGS);
                intent.setData(Uri.parse("package:" + getPackageName()));
                intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                startActivity(intent);
            } catch (Exception ignored) {
            }
        }

        @JavascriptInterface
        public boolean isIgnoringBatteryOptimizations() {
            try {
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
                    PowerManager pm = (PowerManager) getSystemService(POWER_SERVICE);
                    return pm != null && pm.isIgnoringBatteryOptimizations(getPackageName());
                }
            } catch (Exception ignored) {
            }
            return false;
        }

        @JavascriptInterface
        public boolean isNativeAndroid() {
            return true;
        }

        // ---------------- Deteksi tepuk native (layar mati) ----------------
        @JavascriptInterface
        public void startClapService(String mode, int targetDb, int minMs, int maxMs, int alarmSec) {
            try {
                ClapService.start(getApplicationContext(), mode, targetDb, minMs, maxMs, alarmSec);
            } catch (Exception e) {
                e.printStackTrace();
            }
        }

        @JavascriptInterface
        public void stopClapService() {
            try {
                ClapService.stop(getApplicationContext());
            } catch (Exception e) {
                e.printStackTrace();
            }
        }

        @JavascriptInterface
        public boolean isClapServiceRunning() {
            return ClapService.running;
        }

        @JavascriptInterface
        public void pauseClapService(int seconds) {
            ClapService.pauseFor(seconds);
        }

        @JavascriptInterface
        public void resumeClapService() {
            ClapService.resumeNow();
        }

        /** true sekali saja bila service native mendeteksi tepukan yang belum ditangani. */
        @JavascriptInterface
        public boolean consumePendingTrigger() {
            return ClapService.consumePending(getApplicationContext());
        }

        // ---------------- Izin "tampil di atas aplikasi lain" ----------------
        @JavascriptInterface
        public boolean canDrawOverlays() {
            try {
                return Build.VERSION.SDK_INT < Build.VERSION_CODES.M
                    || Settings.canDrawOverlays(MainActivity.this);
            } catch (Exception e) {
                return false;
            }
        }

        @JavascriptInterface
        public void openOverlaySettings() {
            try {
                Intent intent = new Intent(Settings.ACTION_MANAGE_OVERLAY_PERMISSION,
                    Uri.parse("package:" + getPackageName()));
                intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                startActivity(intent);
            } catch (Exception e) {
                openAppSettings();
            }
        }
    }
}
