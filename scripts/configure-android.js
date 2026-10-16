import fs from 'node:fs';
import path from 'node:path';

// 1. Configure AndroidManifest.xml (izin + foreground service deteksi tepuk)
const manifestPath = path.resolve('android/app/src/main/AndroidManifest.xml');

const REQUIRED_PERMISSIONS = [
  'android.permission.RECORD_AUDIO',
  'android.permission.MODIFY_AUDIO_SETTINGS',
  'android.permission.VIBRATE',
  'android.permission.WAKE_LOCK',
  'android.permission.POST_NOTIFICATIONS',
  'android.permission.FOREGROUND_SERVICE',
  'android.permission.FOREGROUND_SERVICE_MICROPHONE',
  'android.permission.REQUEST_IGNORE_BATTERY_OPTIMIZATIONS',
  // Dibutuhkan agar aplikasi bisa menyalakan layar & terbuka sendiri saat tepukan terdeteksi
  'android.permission.USE_FULL_SCREEN_INTENT',
  'android.permission.SYSTEM_ALERT_WINDOW',
  'android.permission.DISABLE_KEYGUARD',
  'android.permission.RECEIVE_BOOT_COMPLETED',
];

if (fs.existsSync(manifestPath)) {
  let xml = fs.readFileSync(manifestPath, 'utf-8');
  let changed = false;

  // Izin
  const missing = REQUIRED_PERMISSIONS.filter((p) => !xml.includes(`"${p}"`));
  if (missing.length > 0) {
    const lines = missing
      .map((p) => `    <uses-permission android:name="${p}" />`)
      .join('\n');
    xml = xml.replace('</manifest>', `${lines}\n</manifest>`);
    changed = true;
  }
  if (!xml.includes('android.hardware.microphone')) {
    xml = xml.replace(
      '</manifest>',
      '    <uses-feature android:name="android.hardware.microphone" android:required="false" />\n</manifest>'
    );
    changed = true;
  }

  // Foreground service tipe microphone
  if (!xml.includes('.ClapService')) {
    xml = xml.replace(
      '</application>',
      '        <service android:name=".ClapService" android:exported="false" android:foregroundServiceType="microphone" />\n    </application>'
    );
    changed = true;
  }

  if (changed) {
    fs.writeFileSync(manifestPath, xml, 'utf-8');
    console.log('Berhasil mengonfigurasi AndroidManifest.xml (izin + ClapService).');
  } else {
    console.log('AndroidManifest.xml sudah terkonfigurasi.');
  }
} else {
  console.log('AndroidManifest.xml belum ditemukan pada:', manifestPath);
}

// 2. Salin kode native (MainActivity + ClapService) ke project Android
const javaDir = path.resolve('android/app/src/main/java/com/firdaus/temukanhp');
const nativeSrcDir = path.resolve('native/android');

if (fs.existsSync(javaDir) && fs.existsSync(nativeSrcDir)) {
  for (const file of ['MainActivity.java', 'ClapService.java']) {
    fs.copyFileSync(path.join(nativeSrcDir, file), path.join(javaDir, file));
    console.log(`Berhasil menyalin ${file} ke project Android.`);
  }
} else {
  console.log('Folder Java Android atau native/android belum ditemukan:', javaDir, nativeSrcDir);
}

// 3. Configure Android App Launcher Icons (Smartphone + Radar Icon)
const resDir = path.resolve('android/app/src/main/res');
const iconSrc512 = path.resolve('public/pwa-512x512.png');
const iconSrc192 = path.resolve('public/pwa-192x192.png');

if (fs.existsSync(resDir) && (fs.existsSync(iconSrc512) || fs.existsSync(iconSrc192))) {
  const iconSource = fs.existsSync(iconSrc512) ? iconSrc512 : iconSrc192;
  const mipmapDirs = [
    'mipmap-mdpi',
    'mipmap-hdpi',
    'mipmap-xhdpi',
    'mipmap-xxhdpi',
    'mipmap-xxxhdpi'
  ];

  mipmapDirs.forEach(dirName => {
    const targetDir = path.join(resDir, dirName);
    if (!fs.existsSync(targetDir)) {
      fs.mkdirSync(targetDir, { recursive: true });
    }
    fs.copyFileSync(iconSource, path.join(targetDir, 'ic_launcher.png'));
    fs.copyFileSync(iconSource, path.join(targetDir, 'ic_launcher_round.png'));
    fs.copyFileSync(iconSource, path.join(targetDir, 'ic_launcher_foreground.png'));
  });

  console.log('Berhasil memperbarui ikon aplikasi Android (Bentuk HP + Simbol Radar) di semua folder mipmap.');
}
