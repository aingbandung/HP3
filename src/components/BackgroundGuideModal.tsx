import React, { useState, useEffect } from 'react';
import {
  Moon,
  ShieldCheck,
  BatteryCharging,
  Smartphone,
  Bell,
  CheckCircle2,
  X,
  Sparkles,
  ExternalLink,
  Settings,
  Flame,
  Volume2,
  Radio,
  Check
} from 'lucide-react';
import {
  openAndroidBatterySettings,
  openAndroidAppSettings,
  isNativeAndroidApp,
  isAndroidDevice,
  applyAllBackgroundSettings,
  canDrawOverApps,
  openOverlaySettings,
} from '../services/backgroundSettingsService';
import { requestNotificationPermission } from '../services/notificationService';

interface BackgroundGuideModalProps {
  isOpen: boolean;
  onClose: () => void;
  isWakeLockActive: boolean;
  onToggleWakeLock: () => void;
  onApplyAllSettings?: () => void;
}

export const BackgroundGuideModal: React.FC<BackgroundGuideModalProps> = ({
  isOpen,
  onClose,
  isWakeLockActive,
  onToggleWakeLock,
  onApplyAllSettings,
}) => {
  const [notificationStatus, setNotificationStatus] = useState<NotificationPermission | 'unsupported'>('default');
  const [justConfigured, setJustConfigured] = useState(true);
  const [selectedBrand, setSelectedBrand] = useState<'all' | 'samsung' | 'xiaomi' | 'oppo'>('all');

  useEffect(() => {
    if (isOpen) {
      if ('Notification' in window) {
        setNotificationStatus(Notification.permission);
      } else {
        setNotificationStatus('unsupported');
      }
      setJustConfigured(true);
    }
  }, [isOpen]);

  if (!isOpen) return null;

  const handleRequestNotification = async () => {
    const res = await requestNotificationPermission();
    setNotificationStatus(res);
  };

  const handleOpenBatterySettings = () => {
    openAndroidBatterySettings();
  };

  const handleOpenAppSettings = () => {
    openAndroidAppSettings();
  };

  const [overlayGranted, setOverlayGranted] = useState<boolean>(() => canDrawOverApps());

  // Perbarui status izin setelah pengguna kembali dari halaman pengaturan Android
  useEffect(() => {
    const refresh = () => setOverlayGranted(canDrawOverApps());
    document.addEventListener('visibilitychange', refresh);
    window.addEventListener('focus', refresh);
    return () => {
      document.removeEventListener('visibilitychange', refresh);
      window.removeEventListener('focus', refresh);
    };
  }, []);

  const handleReapplyAll = async () => {
    await applyAllBackgroundSettings(true);
    if ('Notification' in window) {
      setNotificationStatus(Notification.permission);
    }
    if (onApplyAllSettings) {
      onApplyAllSettings();
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/85 backdrop-blur-md p-4 animate-in fade-in">
      <div className="relative w-full max-w-lg rounded-3xl bg-slate-900 border border-slate-800 p-6 shadow-2xl text-slate-100 max-h-[92vh] overflow-y-auto">
        {/* Header */}
        <div className="flex items-center justify-between pb-4 border-b border-slate-800">
          <div className="flex items-center gap-2.5">
            <div className="p-2.5 rounded-2xl bg-indigo-500/20 text-indigo-400 border border-indigo-500/30">
              <Moon className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-base font-bold text-white flex items-center gap-2">
                Pengaturan Mode Background
                <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-emerald-500/20 text-emerald-300 border border-emerald-500/30">
                  OTOMATIS
                </span>
              </h3>
              <p className="text-xs text-slate-400">Ponsel tetap mendeteksi tepukan saat diminimize / layar mati</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-xl text-slate-400 hover:text-white hover:bg-slate-800 transition"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Immediate feedback banner */}
        {justConfigured && (
          <div className="mt-4 p-3.5 rounded-2xl bg-gradient-to-r from-emerald-950/80 to-slate-900 border border-emerald-500/40 text-xs text-emerald-200 flex items-center gap-3">
            <div className="w-8 h-8 rounded-xl bg-emerald-500/20 text-emerald-400 flex items-center justify-center shrink-0 border border-emerald-500/30">
              <CheckCircle2 className="w-4 h-4" />
            </div>
            <div className="flex-1">
              <strong className="text-white block font-semibold">Mode Background Diterapkan:</strong>
              <span>Screen Wake Lock & saluran audio Keep-Alive telah diset aktif agar sistem HP tidak membekukan deteksi.</span>
            </div>
          </div>
        )}

        {/* Interactive Toggles & System Actions */}
        <div className="mt-5 space-y-3">
          <h4 className="font-bold text-white text-xs uppercase tracking-wider text-slate-400 flex items-center justify-between">
            <span>Status Pengaturan Sistem HP:</span>
            <button
              onClick={handleReapplyAll}
              className="text-[11px] text-indigo-400 hover:text-indigo-300 font-normal underline"
            >
              Set Ulang Semua
            </button>
          </h4>

          {/* 1. Battery Optimization - Direct One-Click Button */}
          <div className="p-4 rounded-2xl bg-gradient-to-br from-indigo-950/50 via-slate-800/80 to-slate-900 border border-indigo-500/30 space-y-3">
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-start gap-3">
                <div className="p-2 rounded-xl bg-amber-500/20 text-amber-400 shrink-0 mt-0.5">
                  <BatteryCharging className="w-4 h-4" />
                </div>
                <div>
                  <div className="font-bold text-white text-xs flex items-center gap-1.5">
                    Pengoptimalan Baterai HP Android
                    <span className="text-[10px] px-1.5 py-0.2 rounded bg-amber-500/20 text-amber-300 border border-amber-500/30">
                      PENTING
                    </span>
                  </div>
                  <p className="text-slate-400 text-[11px] mt-0.5 leading-relaxed">
                    Setel ke <strong>"Tidak Dibatasi / Unrestricted"</strong> agar Android tidak mematikan mikrofon saat layar HP mati/dikunci.
                  </p>
                </div>
              </div>
            </div>

            <div className="pt-1 flex flex-wrap gap-2">
              <button
                onClick={handleOpenBatterySettings}
                className="flex-1 min-w-[170px] flex items-center justify-center gap-2 px-3.5 py-2.5 rounded-xl text-xs font-bold bg-indigo-600 hover:bg-indigo-500 text-white shadow-lg shadow-indigo-600/30 transition active:scale-95"
              >
                <Settings className="w-3.5 h-3.5" />
                <span>Buka Pengaturan Baterai HP</span>
                <ExternalLink className="w-3 h-3 text-indigo-200" />
              </button>

              <button
                onClick={handleOpenAppSettings}
                className="flex items-center justify-center gap-1.5 px-3 py-2.5 rounded-xl text-xs font-medium bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-700 transition"
              >
                <span>Info Aplikasi</span>
              </button>
            </div>
          </div>

          {/* 1b. Auto-open saat layar mati (khusus APK Android) */}
          {isNativeAndroidApp() && (
            <div className="p-4 rounded-2xl bg-gradient-to-br from-emerald-950/40 via-slate-800/80 to-slate-900 border border-emerald-500/30 space-y-3">
              <div className="flex items-start gap-3">
                <div className="p-2 rounded-xl bg-emerald-500/20 text-emerald-400 shrink-0 mt-0.5">
                  <Smartphone className="w-4 h-4" />
                </div>
                <div>
                  <div className="font-bold text-white text-xs flex items-center gap-1.5">
                    Buka Otomatis Saat Layar Mati
                    <span
                      className={`text-[10px] px-1.5 py-0.2 rounded border ${
                        overlayGranted
                          ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/30'
                          : 'bg-amber-500/20 text-amber-300 border-amber-500/30'
                      }`}
                    >
                      {overlayGranted ? 'AKTIF' : 'PERLU IZIN'}
                    </span>
                  </div>
                  <p className="text-slate-400 text-[11px] mt-0.5 leading-relaxed">
                    Saat tepukan terdeteksi, layar menyala dan aplikasi terbuka sendiri. Aktifkan izin
                    <strong> "Tampil di atas aplikasi lain"</strong> agar Android mengizinkan aplikasi terbuka dari latar belakang.
                  </p>
                </div>
              </div>
              {!overlayGranted && (
                <button
                  onClick={() => openOverlaySettings()}
                  className="w-full flex items-center justify-center gap-2 px-3.5 py-2.5 rounded-xl text-xs font-bold bg-emerald-600 hover:bg-emerald-500 text-white shadow-lg shadow-emerald-600/30 transition active:scale-95"
                >
                  <Settings className="w-3.5 h-3.5" />
                  <span>Aktifkan Izin Tampil di Atas Aplikasi Lain</span>
                  <ExternalLink className="w-3 h-3 text-emerald-200" />
                </button>
              )}
            </div>
          )}

          {/* 2. Wake Lock Feature */}
          <div className="p-3.5 rounded-2xl bg-slate-800/60 border border-slate-700/60 flex items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-xl bg-blue-500/20 text-blue-400 shrink-0">
                <Sparkles className="w-4 h-4" />
              </div>
              <div>
                <div className="font-bold text-white text-xs">
                  Kunci Layar Tetap Aktif (Wake Lock)
                </div>
                <p className="text-slate-400 text-[11px] mt-0.5">
                  Mencegah HP tidur otomatis saat diletakkan di meja/kamar.
                </p>
              </div>
            </div>
            <button
              onClick={onToggleWakeLock}
              className={`px-3 py-1.5 rounded-xl text-xs font-bold transition shrink-0 ${
                isWakeLockActive
                  ? 'bg-emerald-600 text-white shadow-md shadow-emerald-500/25'
                  : 'bg-slate-700 text-slate-300 hover:bg-slate-600'
              }`}
            >
              {isWakeLockActive ? 'Aktif ✓' : 'Nyalakan'}
            </button>
          </div>

          {/* 3. Notification Permission */}
          <div className="p-3.5 rounded-2xl bg-slate-800/60 border border-slate-700/60 flex items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-xl bg-purple-500/20 text-purple-400 shrink-0">
                <Bell className="w-4 h-4" />
              </div>
              <div>
                <div className="font-bold text-white text-xs">
                  Izin Notifikasi HP
                </div>
                <p className="text-slate-400 text-[11px] mt-0.5">
                  Dibutuhkan Android 13+ untuk notifikasi siaga & alarm di background.
                </p>
              </div>
            </div>
            <button
              onClick={handleRequestNotification}
              disabled={notificationStatus === 'granted'}
              className={`px-3 py-1.5 rounded-xl text-xs font-bold transition shrink-0 ${
                notificationStatus === 'granted'
                  ? 'bg-emerald-600/30 text-emerald-300 border border-emerald-500/40 cursor-default'
                  : 'bg-indigo-600 text-white hover:bg-indigo-500 shadow-md shadow-indigo-600/25'
              }`}
            >
              {notificationStatus === 'granted' ? 'Diizinkan ✓' : 'Izinkan'}
            </button>
          </div>

          {/* 4. Keep-Alive MediaSession */}
          <div className="p-3.5 rounded-2xl bg-slate-800/60 border border-slate-700/60 flex items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-xl bg-emerald-500/20 text-emerald-400 shrink-0">
                <Volume2 className="w-4 h-4" />
              </div>
              <div>
                <div className="font-bold text-white text-xs">
                  Audio Keep-Alive & MediaSession
                </div>
                <p className="text-slate-400 text-[11px] mt-0.5">
                  Menjaga status browser tetap sebagai pemutar aktif di bar status Android.
                </p>
              </div>
            </div>
            <span className="text-[11px] px-2.5 py-1 rounded-lg bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 font-medium">
              Aktif ✓
            </span>
          </div>
        </div>

        {/* Brand Specific Tips */}
        <div className="mt-5 pt-4 border-t border-slate-800">
          <div className="flex items-center justify-between mb-2.5">
            <h4 className="font-bold text-white text-xs uppercase tracking-wider text-slate-400">
              Panduan Cepat Sesuai Merk HP:
            </h4>
          </div>

          {/* Brand tabs */}
          <div className="flex gap-1.5 mb-3 overflow-x-auto pb-1 text-[11px]">
            <button
              onClick={() => setSelectedBrand('all')}
              className={`px-3 py-1 rounded-xl transition ${
                selectedBrand === 'all'
                  ? 'bg-indigo-600 text-white font-bold'
                  : 'bg-slate-800 text-slate-400 hover:text-white'
              }`}
            >
              Semua HP
            </button>
            <button
              onClick={() => setSelectedBrand('samsung')}
              className={`px-3 py-1 rounded-xl transition ${
                selectedBrand === 'samsung'
                  ? 'bg-indigo-600 text-white font-bold'
                  : 'bg-slate-800 text-slate-400 hover:text-white'
              }`}
            >
              Samsung
            </button>
            <button
              onClick={() => setSelectedBrand('xiaomi')}
              className={`px-3 py-1 rounded-xl transition ${
                selectedBrand === 'xiaomi'
                  ? 'bg-indigo-600 text-white font-bold'
                  : 'bg-slate-800 text-slate-400 hover:text-white'
              }`}
            >
              Xiaomi / POCO
            </button>
            <button
              onClick={() => setSelectedBrand('oppo')}
              className={`px-3 py-1 rounded-xl transition ${
                selectedBrand === 'oppo'
                  ? 'bg-indigo-600 text-white font-bold'
                  : 'bg-slate-800 text-slate-400 hover:text-white'
              }`}
            >
              Oppo / Vivo / Realme
            </button>
          </div>

          <div className="p-3.5 rounded-2xl bg-slate-800/40 border border-slate-800 text-xs text-slate-300 leading-relaxed">
            {selectedBrand === 'all' && (
              <div>
                <strong className="text-white block mb-1">Pengaturan Baterai Umum Android:</strong>
                <ol className="list-decimal list-inside space-y-1 text-slate-400 text-[11px]">
                  <li>Tekan tombol <strong>"Buka Pengaturan Baterai HP"</strong> di atas.</li>
                  <li>Pilih menu <strong>Penggunaan Baterai / Battery usage</strong>.</li>
                  <li>Ubah dari <em>"Dioptimalkan"</em> menjadi <strong>"Tidak Dibatasi / Unrestricted"</strong>.</li>
                  <li>Kini aplikasi dapat mendeteksi tepukan selamanya meskipun layar dikunci.</li>
                </ol>
              </div>
            )}

            {selectedBrand === 'samsung' && (
              <div>
                <strong className="text-white block mb-1">Panduan Khusus Samsung One UI:</strong>
                <p className="text-slate-400 text-[11px]">
                  Buka <em>Pengaturan HP &gt; Perawatan Perangkat &gt; Baterai &gt; Batas penggunaan latar belakang</em>.
                  Pastikan <strong>Temukan HP</strong> dimasukkan ke dalam daftar <strong>"Aplikasi yang tidak pernah tidur (Never sleeping apps)"</strong>.
                </p>
              </div>
            )}

            {selectedBrand === 'xiaomi' && (
              <div>
                <strong className="text-white block mb-1">Panduan Khusus Xiaomi / POCO / HyperOS:</strong>
                <p className="text-slate-400 text-[11px]">
                  Buka <em>Pengaturan &gt; Aplikasi &gt; Kelola Aplikasi &gt; Temukan HP</em> &gt; Aktifkan <strong>"Mulai Otomatis (Autostart)"</strong>.
                  Pada <em>Penghemat Baterai</em>, pilih <strong>"Tidak ada pembatasan (No restrictions)"</strong>.
                </p>
              </div>
            )}

            {selectedBrand === 'oppo' && (
              <div>
                <strong className="text-white block mb-1">Panduan Khusus Oppo / Vivo / Realme:</strong>
                <p className="text-slate-400 text-[11px]">
                  Buka <em>Pengaturan &gt; Manajemen Aplikasi &gt; Temukan HP &gt; Penggunaan Baterai</em> &gt; Aktifkan <strong>"Izinkan aktivitas latar belakang (Allow background activity)"</strong> dan <strong>"Izinkan mulai otomatis"</strong>.
                </p>
              </div>
            )}
          </div>
        </div>

        <button
          onClick={onClose}
          className="mt-6 w-full rounded-2xl bg-indigo-600 py-3 text-sm font-bold text-white hover:bg-indigo-500 transition shadow-lg shadow-indigo-500/20"
        >
          Selesai & Tutup
        </button>
      </div>
    </div>
  );
};
