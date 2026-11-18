import React, { useEffect, useState } from "react";
import { Settings, X, Activity, FolderSync, ShieldAlert } from "lucide-react";
import { PerformanceMetrics, WidgetSettings } from "../types/task";
import { fetchPerformanceMetrics } from "../services/tauriBridge";

interface SettingsModalProps {
  settings: WidgetSettings;
  onSaveSettings: (newSettings: WidgetSettings) => Promise<void>;
  onOpenVaultPicker: () => void;
  onClose: () => void;
}

export const SettingsModal: React.FC<SettingsModalProps> = ({
  settings,
  onSaveSettings,
  onOpenVaultPicker,
  onClose,
}) => {
  const [draft, setDraft] = useState<WidgetSettings>({ ...settings });
  const [metrics, setMetrics] = useState<PerformanceMetrics | null>(null);
  const [statusMsg, setStatusMsg] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  useEffect(() => {
    fetchPerformanceMetrics().then(setMetrics).catch(() => {});
  }, []);

  const handleApply = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);
    setStatusMsg(null);
    try {
      await onSaveSettings(draft);
      setStatusMsg("Pengaturan berhasil diterapkan dan disimpan.");
    } catch (err: any) {
      setErrorMsg(err?.message ?? String(err));
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/70 p-3 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
    >
      <form
        onSubmit={handleApply}
        className="w-full max-w-md max-h-[90vh] flex flex-col rounded-2xl border border-white/15 bg-slate-900/95 text-xs text-slate-100 shadow-2xl overflow-hidden"
      >
        <div className="px-4 py-3 border-b border-white/10 flex items-center justify-between">
          <span className="font-semibold flex items-center gap-1.5 text-sky-300">
            <Settings className="w-4 h-4" />
            Pengaturan GlassTasks & Perilaku Windows
          </span>
          <button
            type="button"
            onClick={onClose}
            className="p-1 text-slate-400 hover:text-white rounded"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-4 space-y-4 overflow-y-auto flex-1 task-list-scroll">
          {/* Vault Source Change */}
          <div className="flex items-center justify-between rounded-xl border border-white/10 bg-slate-800/60 p-2.5">
            <div>
              <div className="font-medium text-slate-200">Sumber Vault & Scope</div>
              <div className="text-[11px] text-slate-400">
                Ubah folder vault, daftar file, atau keluar dari Mode Demo
              </div>
            </div>
            <button
              type="button"
              onClick={() => {
                onClose();
                onOpenVaultPicker();
              }}
              className="inline-flex items-center gap-1 rounded-lg bg-sky-500/20 border border-sky-400/40 px-2.5 py-1.5 text-sky-300 hover:bg-sky-500/30"
            >
              <FolderSync className="w-3.5 h-3.5" />
              Atur Sumber
            </button>
          </div>

          {/* Theme & Glass Appearance */}
          <div className="space-y-2.5">
            <div className="font-semibold text-slate-200">Tampilan Glass Interface</div>

            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="block text-[11px] text-slate-400 mb-1">Tema</label>
                <select
                  value={draft.theme}
                  onChange={(e) =>
                    setDraft({ ...draft, theme: e.target.value as any })
                  }
                  className="w-full rounded-lg bg-slate-800 border border-white/10 px-2 py-1.5 text-white"
                >
                  <option value="dark_glass">Dark Glass</option>
                  <option value="light_glass">Light Glass</option>
                  <option value="system">Ikuti Sistem (Follow System)</option>
                </select>
              </div>

              <div>
                <label className="block text-[11px] text-slate-400 mb-1">
                  Efek Native Windows
                </label>
                <select
                  value={draft.nativeEffect}
                  onChange={(e) =>
                    setDraft({ ...draft, nativeEffect: e.target.value as any })
                  }
                  className="w-full rounded-lg bg-slate-800 border border-white/10 px-2 py-1.5 text-white"
                >
                  <option value="acrylic">Acrylic Blur (Win 10/11)</option>
                  <option value="mica">Mica (Win 11)</option>
                  <option value="blur">DirectComposition Blur</option>
                  <option value="fallback">Translucent Fallback Stabil</option>
                </select>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-[11px] text-slate-400 mb-1">
                  Opacity Panel ({Math.round(draft.opacity * 100)}%)
                </label>
                <input
                  type="range"
                  min="0.50"
                  max="0.98"
                  step="0.02"
                  value={draft.opacity}
                  onChange={(e) =>
                    setDraft({ ...draft, opacity: parseFloat(e.target.value) })
                  }
                  className="w-full"
                />
              </div>

              <div>
                <label className="block text-[11px] text-slate-400 mb-1">
                  Intensitas Blur Internal ({draft.blurIntensity}px)
                </label>
                <input
                  type="range"
                  min="0"
                  max="32"
                  step="2"
                  value={draft.blurIntensity}
                  onChange={(e) =>
                    setDraft({
                      ...draft,
                      blurIntensity: parseInt(e.target.value, 10),
                    })
                  }
                  className="w-full"
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="block text-[11px] text-slate-400 mb-1">
                  Kerapatan Baris (Density)
                </label>
                <select
                  value={draft.density}
                  onChange={(e) =>
                    setDraft({ ...draft, density: e.target.value as any })
                  }
                  className="w-full rounded-lg bg-slate-800 border border-white/10 px-2 py-1.5 text-white"
                >
                  <option value="comfortable">Comfortable</option>
                  <option value="compact">Compact</option>
                </select>
              </div>

              <div>
                <label className="block text-[11px] text-slate-400 mb-1">
                  Warna Aksen
                </label>
                <input
                  type="color"
                  value={draft.accentColor}
                  onChange={(e) =>
                    setDraft({ ...draft, accentColor: e.target.value })
                  }
                  className="h-8 w-full rounded bg-slate-800 border border-white/10 px-1"
                />
              </div>
            </div>
          </div>

          {/* Windows Desktop Behavior */}
          <div className="space-y-2 pt-1 border-t border-white/10">
            <div className="font-semibold text-slate-200">
              Perilaku Jendela Desktop Windows
            </div>

            <div>
              <label className="block text-[11px] text-slate-400 mb-1">
                Mode Posisi Jendela
              </label>
              <select
                value={draft.windowMode}
                onChange={(e) => {
                  const mode = e.target.value as any;
                  setDraft({
                    ...draft,
                    windowMode: mode,
                    alwaysOnTop: mode === "always_on_top",
                  });
                }}
                className="w-full rounded-lg bg-slate-800 border border-white/10 px-2 py-1.5 text-white"
              >
                <option value="floating">
                  1. Floating Widget Biasa (Baseline Stabil)
                </option>
                <option value="always_on_top">
                  2. Always-on-Top (Selalu di Atas Aplikasi Lain)
                </option>
                <option value="desktop_pinned">
                  3. Desktop-Pinned Z-Order Bawah (Lanjutan / HWND_BOTTOM)
                </option>
              </select>
            </div>

            <label className="flex items-center justify-between py-1 cursor-pointer">
              <span>Sembunyikan ke System Tray saat tombol Tutup diklik</span>
              <input
                type="checkbox"
                checked={draft.hideToTrayOnClose}
                onChange={(e) =>
                  setDraft({ ...draft, hideToTrayOnClose: e.target.checked })
                }
              />
            </label>

            <label className="flex items-center justify-between py-1 cursor-pointer">
              <span>Mulai terminimalkan di System Tray (Start Minimized)</span>
              <input
                type="checkbox"
                checked={draft.startMinimized}
                onChange={(e) =>
                  setDraft({ ...draft, startMinimized: e.target.checked })
                }
              />
            </label>

            <label className="flex items-center justify-between py-1 cursor-pointer">
              <span>Jalankan otomatis saat login Windows (Auto-start)</span>
              <input
                type="checkbox"
                checked={draft.autostartEnabled}
                onChange={(e) =>
                  setDraft({ ...draft, autostartEnabled: e.target.checked })
                }
              />
            </label>

            <label className="flex items-center justify-between py-1 cursor-pointer">
              <span>Kurangi animasi (Reduced Motion)</span>
              <input
                type="checkbox"
                checked={draft.reducedMotion}
                onChange={(e) =>
                  setDraft({ ...draft, reducedMotion: e.target.checked })
                }
              />
            </label>

            <label className="flex items-start justify-between gap-2 py-1 cursor-pointer text-amber-200">
              <span>
                Mode Click-Through (Abaikan klik mouse; dapat dimatikan kembali
                lewat ikon System Tray atau Global Hotkey)
              </span>
              <input
                type="checkbox"
                checked={draft.clickThrough}
                onChange={(e) =>
                  setDraft({ ...draft, clickThrough: e.target.checked })
                }
              />
            </label>

            <div>
              <label className="block text-[11px] text-slate-400 mb-1">
                Global Hotkey Tampilkan/Sembunyikan Widget
              </label>
              <input
                type="text"
                value={draft.globalHotkey}
                onChange={(e) =>
                  setDraft({ ...draft, globalHotkey: e.target.value })
                }
                placeholder="CommandOrControl+Shift+G"
                className="w-full rounded-lg bg-slate-800 border border-white/10 px-2.5 py-1.5 text-white"
              />
            </div>
          </div>

          {/* Real-time Performance Metrics */}
          {metrics && (
            <div className="rounded-xl border border-white/10 bg-slate-950/60 p-3 space-y-1.5">
              <div className="flex items-center gap-1.5 font-medium text-sky-300">
                <Activity className="w-3.5 h-3.5" />
                <span>Metrik Performa Runtime</span>
              </div>
              <div className="grid grid-cols-2 gap-1 text-[11px] text-slate-300">
                <div>Waktu Startup: {metrics.startupMs.toFixed(1)} ms</div>
                <div>Waktu Indexing: {metrics.lastIndexMs.toFixed(2)} ms</div>
                <div>Latensi Write: {metrics.lastWriteMs.toFixed(2)} ms</div>
                <div>
                  File / Task: {metrics.indexedFilesCount} file ({metrics.indexedTasksCount} task)
                </div>
              </div>
            </div>
          )}

          {statusMsg && (
            <div className="rounded-lg border border-emerald-400/40 bg-emerald-950/50 p-2 text-emerald-200">
              {statusMsg}
            </div>
          )}
          {errorMsg && (
            <div className="flex items-start gap-2 rounded-lg border border-rose-500/40 bg-rose-950/50 p-2 text-rose-200">
              <ShieldAlert className="w-4 h-4 shrink-0 mt-0.5" />
              <span>{errorMsg}</span>
            </div>
          )}
        </div>

        <div className="px-4 py-3 border-t border-white/10 bg-slate-950/70 flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="px-3 py-1.5 rounded-lg border border-white/10 text-slate-300 hover:bg-white/5"
          >
            Tutup
          </button>
          <button
            type="submit"
            className="px-4 py-1.5 rounded-lg bg-sky-400 font-semibold text-slate-950 hover:bg-sky-300"
          >
            Simpan Pengaturan
          </button>
        </div>
      </form>
    </div>
  );
};
