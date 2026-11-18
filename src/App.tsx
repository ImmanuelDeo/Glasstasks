import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  Plus,
  RefreshCw,
  Settings,
  Search,
  Undo2,
  Pin,
  ExternalLink,
  AlertTriangle,
  CheckCircle2,
  Loader2,
  FolderOpen,
  Sparkles,
  Bell,
  Check,
} from "lucide-react";
import {
  FilterPreset,
  NewTaskRequest,
  SortOption,
  SyncStatus,
  TaskItem,
  UndoRecord,
  VaultConfig,
  WidgetSettings,
} from "./types/task";
import { getTodayLocalDateString } from "./core/dateUtils";
import { filterTasks, isTaskCompleted, sortTasks } from "./core/sorter";
import {
  createNewTaskItem,
   DEFAULT_WIDGET_SETTINGS,
  deleteTaskItem,
  fetchInitialState,
  listVaultMarkdownFiles,
  openNoteInObsidian,
  patchTaskItem,
  persistWidgetSettings,
  reconcileOnResume,
  refreshTasks,
  registerGlobalHotkeyOnly,
  saveVaultConfig,
  subscribeToVaultEvents,
  undoLastTaskAction,
} from "./services/tauriBridge";
import { listen } from "@tauri-apps/api/event";
import { OnboardingModal } from "./components/OnboardingModal";
import { TaskRow } from "./components/TaskRow";
import { QuickAddModal } from "./components/QuickAddModal";
import { SettingsModal } from "./components/SettingsModal";

export const App: React.FC = () => {
  const [vaultConfig, setVaultConfig] = useState<VaultConfig | null>(null);
  const [settings, setSettings] = useState<WidgetSettings>(
    DEFAULT_WIDGET_SETTINGS
  );
  const [tasks, setTasks] = useState<TaskItem[]>([]);
  const [availableFiles, setAvailableFiles] = useState<string[]>([]);
  const [syncStatus, setSyncStatus] = useState<SyncStatus>("synced");
  const [statusMessage, setStatusMessage] = useState<string>("Tersinkron");
  const [undoRecord, setUndoRecord] = useState<UndoRecord | null>(null);
  const [todayLocal, setTodayLocal] = useState<string>(() =>
    getTodayLocalDateString()
  );

  // Filter & Sort states
  const [filterPreset, setFilterPreset] = useState<FilterPreset>("all_active");
  const [sortBy, setSortBy] = useState<SortOption>("deadline_asc");
  const [searchQuery, setSearchQuery] = useState<string>("");
  const [fileFilter, setFileFilter] = useState<string | null>(null);
  const [tagFilter, setTagFilter] = useState<string | null>(null);

  // Modals & confirmations
  const [showOnboarding, setShowOnboarding] = useState<boolean>(false);
  const [showQuickAdd, setShowQuickAdd] = useState<boolean>(false);
  const [showSettings, setShowSettings] = useState<boolean>(false);
  const [deleteConfirmTarget, setDeleteConfirmTarget] = useState<{
    task: TaskItem;
    hasSubtasks: boolean;
  } | null>(null);

  // Toast notifications
  const [toasts, setToasts] = useState<Array<{ id: number; type: "success" | "error" | "info"; message: string }>>([]);

  const showToast = useCallback((type: "success" | "error" | "info", message: string) => {
    const id = Date.now();
    setToasts((prev) => [...prev, { id, type, message }]);
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, 3000);
  }, []);

  // Virtualization scroll state for large vaults (>100 tasks)
  const [scrollTop, setScrollTop] = useState(0);

  // Load initial state on startup
  useEffect(() => {
    let mounted = true;
    fetchInitialState()
      .then(async (init) => {
        if (!mounted) return;
        setSettings(init.widgetSettings);
        setUndoRecord(init.undoAvailable);
        // Global hotkey is registered natively in Rust backend on startup
        if (!init.vaultConfig) {
          setShowOnboarding(true);
        } else {
          setVaultConfig(init.vaultConfig);
          setTasks(init.tasks);
          if (!init.vaultAvailable) {
            setSyncStatus("vault_unavailable");
            setStatusMessage(
              init.errorMessage ?? "Folder vault tidak tersedia."
            );
          } else {
            const files = await listVaultMarkdownFiles(
              init.vaultConfig.vaultPath
            ).catch(() => []);
            setAvailableFiles(files);
          }
        }
      })
      .catch((err) => {
        setSyncStatus("vault_unavailable");
        setStatusMessage(String(err));
      });
    return () => {
      mounted = false;
    };
  }, []);

  // Subscribe to backend watcher events, focus reconciliation, and local date rollover
  useEffect(() => {
    let unlisteners: (() => void)[] = [];
    subscribeToVaultEvents({
      onTasksUpdated: ({ tasks: newTasks, latencyMs }) => {
        setSyncStatus("loading_changes");
        setTasks(newTasks);
        setSyncStatus("synced");
        setStatusMessage(
          `Diperbarui dari Obsidian (${latencyMs.toFixed(1)} ms)`
        );
      },
      onWatcherError: ({ error }) => {
        setSyncStatus("vault_unavailable");
        setStatusMessage(error);
      },
      onSettingsUpdated: (newSettings) => {
        setSettings(newSettings);
      },
      onManualRefreshRequested: () => {
        handleManualRefresh();
      },
      onFocusReconcile: () => {
        setTodayLocal(getTodayLocalDateString());
        if (vaultConfig) {
          reconcileOnResume(vaultConfig.demoMode)
            .then((res) => {
              if (res.changed) {
                setTasks(res.tasks);
                setStatusMessage("Rekonsiliasi perubahan eksternal selesai");
              }
            })
            .catch(() => {});
        }
      },
    }).then((list) => {
      unlisteners = list;
    });

    // Listen for open-settings-modal event from tray
    listen("open-settings-modal", () => {
      setShowSettings(true);
    }).then((unlistenSettings) => {
      unlisteners.push(unlistenSettings);
    });

    // Local midnight rollover check every 30 seconds
    const timer = window.setInterval(() => {
      const currentDay = getTodayLocalDateString();
      setTodayLocal((prev) => (prev !== currentDay ? currentDay : prev));
    }, 30_000);

    return () => {
      unlisteners.forEach((u) => u());
      window.clearInterval(timer);
    };
  }, [vaultConfig]);

  const handleManualRefresh = useCallback(async () => {
    if (!vaultConfig) return;
    setSyncStatus("loading_changes");
    setStatusMessage("Memuat perubahan...");
    try {
      const latest = await refreshTasks(
        vaultConfig.demoMode,
        settings.customStatusMap
      );
      setTasks(latest);
      setTodayLocal(getTodayLocalDateString());
      setSyncStatus("synced");
      setStatusMessage("Tersinkron");
    } catch (err: any) {
      setSyncStatus("vault_unavailable");
      setStatusMessage(err?.message ?? "Vault tidak tersedia");
    }
  }, [vaultConfig, settings.customStatusMap]);

  const handleOnboardingComplete = async (cfg: VaultConfig) => {
    setSyncStatus("loading_changes");
    const loadedTasks = await saveVaultConfig(cfg, settings.customStatusMap);
    setVaultConfig(cfg);
    setTasks(loadedTasks);
    const files = await listVaultMarkdownFiles(cfg.vaultPath).catch(() => []);
    setAvailableFiles(files);
    setShowOnboarding(false);
    setSyncStatus("synced");
    setStatusMessage(
      cfg.demoMode ? "Mode Demo Aktif" : `Terhubung ke ${cfg.vaultName}`
    );
  };

  const handleToggleStatus = async (task: TaskItem) => {
    if (!vaultConfig || task.isReadOnly) return;
    const targetStatus = task.status === "done" ? "todo" : "done";
    const previousTasks = tasks;

    // Optimistic UI update
    setSyncStatus("saving");
    setStatusMessage("Menyimpan...");
    setTasks((curr) =>
      curr.map((t) => (t.id === task.id ? { ...t, status: targetStatus } : t))
    );

    const outcome = await patchTaskItem(
      vaultConfig.demoMode,
      settings.customStatusMap,
      {
        taskId: task.id,
        relativePath: task.relativePath,
        anchor: task.anchor,
        originalRawLine: task.rawLine,
        newStatus: targetStatus,
        todayLocal,
      }
    );

    if (outcome.success) {
      setTasks(outcome.updatedFileTasks);
      setUndoRecord(outcome.undoAvailable);
      setSyncStatus("synced");
      setStatusMessage(outcome.message);
    } else {
      // Rollback optimistic UI or reload latest on conflict
      setTasks(
        outcome.updatedFileTasks.length > 0
          ? outcome.updatedFileTasks
          : previousTasks
      );
      setSyncStatus(outcome.syncStatus);
      setStatusMessage(outcome.message);
    }
  };

  const handleSaveTitle = async (task: TaskItem, newTitle: string) => {
    if (!vaultConfig || task.isReadOnly) return;
    setSyncStatus("saving");
    setStatusMessage("Menyimpan perubahan judul...");

    const outcome = await patchTaskItem(
      vaultConfig.demoMode,
      settings.customStatusMap,
      {
        taskId: task.id,
        relativePath: task.relativePath,
        anchor: task.anchor,
        originalRawLine: task.rawLine,
        newTitle,
        todayLocal,
      }
    );

    if (outcome.success) {
      setTasks(outcome.updatedFileTasks);
      setUndoRecord(outcome.undoAvailable);
      setSyncStatus("synced");
      setStatusMessage("Judul task diperbarui");
    } else {
      if (outcome.updatedFileTasks.length > 0) {
        setTasks(outcome.updatedFileTasks);
      }
      setSyncStatus(outcome.syncStatus);
      setStatusMessage(outcome.message);
    }
  };

  const handleSaveDueDate = async (
    task: TaskItem,
    newDueDate: string | null
  ) => {
    if (!vaultConfig || task.isReadOnly) return;
    setSyncStatus("saving");
    setStatusMessage("Menyimpan perubahan deadline...");

    const outcome = await patchTaskItem(
      vaultConfig.demoMode,
      settings.customStatusMap,
      {
        taskId: task.id,
        relativePath: task.relativePath,
        anchor: task.anchor,
        originalRawLine: task.rawLine,
        newDueDate,
        todayLocal,
      }
    );

    if (outcome.success) {
      setTasks(outcome.updatedFileTasks);
      setUndoRecord(outcome.undoAvailable);
      setSyncStatus("synced");
      setStatusMessage("Deadline diperbarui & urutan dihitung ulang");
    } else {
      if (outcome.updatedFileTasks.length > 0) {
        setTasks(outcome.updatedFileTasks);
      }
      setSyncStatus(outcome.syncStatus);
      setStatusMessage(outcome.message);
    }
  };

  const handleAddTask = async (
    req: NewTaskRequest
  ): Promise<{ needsCreateApproval?: boolean }> => {
    if (!vaultConfig) return {};
    setSyncStatus("saving");
    setStatusMessage("Menambahkan task baru...");

    const outcome = await createNewTaskItem(
      vaultConfig.demoMode,
      settings.customStatusMap,
      req
    );

    if (outcome.message.startsWith("NEEDS_CREATE_APPROVAL:")) {
      setSyncStatus("synced");
      setStatusMessage("Konfirmasi pembuatan file diperlukan");
      return { needsCreateApproval: true };
    }

    if (outcome.success) {
      setTasks(outcome.updatedFileTasks);
      setUndoRecord(outcome.undoAvailable);
      setSyncStatus("synced");
      setStatusMessage(outcome.message);
    } else {
      setSyncStatus(outcome.syncStatus);
      setStatusMessage(outcome.message);
    }
    return {};
  };

  const handleConfirmDelete = async () => {
    if (!vaultConfig || !deleteConfirmTarget) return;
    const target = deleteConfirmTarget.task;
    setDeleteConfirmTarget(null);
    setSyncStatus("saving");
    setStatusMessage("Menghapus task...");

    const outcome = await deleteTaskItem(
      vaultConfig.demoMode,
      settings.customStatusMap,
      {
        taskId: target.id,
        relativePath: target.relativePath,
        anchor: target.anchor,
        originalRawLine: target.rawLine,
      }
    );

    if (outcome.success) {
      setTasks(outcome.updatedFileTasks);
      setUndoRecord(outcome.undoAvailable);
      setSyncStatus("synced");
      setStatusMessage(outcome.message);
    } else {
      if (outcome.updatedFileTasks.length > 0) {
        setTasks(outcome.updatedFileTasks);
      }
      setSyncStatus(outcome.syncStatus);
      setStatusMessage(outcome.message);
    }
  };

  const handleUndo = async () => {
    if (!vaultConfig || !undoRecord) return;
    setSyncStatus("saving");
    setStatusMessage("Membatalkan perubahan terakhir...");

    const outcome = await undoLastTaskAction(
      vaultConfig.demoMode,
      settings.customStatusMap
    );
    if (outcome.updatedFileTasks.length > 0 || outcome.success) {
      setTasks(outcome.updatedFileTasks);
    }
    setUndoRecord(outcome.undoAvailable);
    setSyncStatus(outcome.syncStatus);
    setStatusMessage(outcome.message);
  };

  // All unique tags and files for filter dropdowns
  const allTags = useMemo(() => {
    const s = new Set<string>();
    tasks.forEach((t) => t.tags.forEach((tag) => s.add(tag)));
    return Array.from(s).sort();
  }, [tasks]);

  const allSourceFiles = useMemo(() => {
    const s = new Set<string>(availableFiles);
    tasks.forEach((t) => s.add(t.relativePath));
    return Array.from(s).sort();
  }, [availableFiles, tasks]);

  // Active & Completed task lists after filtering & sorting
  const filteredTasks = useMemo(
    () =>
      filterTasks(tasks, {
        preset: filterPreset,
        searchQuery,
        fileFilter,
        tagFilter,
        todayLocal,
      }),
    [tasks, filterPreset, searchQuery, fileFilter, tagFilter, todayLocal]
  );

  const sortedDisplayTasks = useMemo(
    () => sortTasks(filteredTasks, sortBy),
    [filteredTasks, sortBy]
  );

  const completedTasksSection = useMemo(() => {
    if (filterPreset !== "all_active" || !settings.showCompletedSection) {
      return [];
    }
    const doneFiltered = filterTasks(tasks, {
      preset: "completed",
      searchQuery,
      fileFilter,
      tagFilter,
      todayLocal,
    });
    return sortTasks(doneFiltered, sortBy);
  }, [
    tasks,
    filterPreset,
     settings.showCompletedSection,
    searchQuery,
    fileFilter,
    tagFilter,
    todayLocal,
    sortBy,
  ]);

  const activeCount = useMemo(
    () => tasks.filter((t) => !isTaskCompleted(t.status)).length,
    [tasks]
  );

  // Determine effective theme class
  const effectiveThemeClass = useMemo(() => {
    if (settings.theme === "light_glass") return "theme-light-glass";
    if (settings.theme === "dark_glass") return "theme-dark-glass";
    const prefersDark =
      typeof window !== "undefined" &&
      window.matchMedia?.("(prefers-color-scheme: dark)").matches;
    return prefersDark ? "theme-dark-glass" : "theme-light-glass";
  }, [settings.theme]);

  // Virtualization windowing when sortedDisplayTasks exceeds 100 items
  const useVirtualList = sortedDisplayTasks.length > 100;
  const rowHeight = settings.density === "compact" ? 50 : 62;
  const visibleSlice = useMemo(() => {
    if (!useVirtualList) {
      return {
        items: sortedDisplayTasks,
        topSpacer: 0,
        bottomSpacer: 0,
      };
    }
    const startIdx = Math.max(0, Math.floor(scrollTop / rowHeight) - 6);
    const endIdx = Math.min(
      sortedDisplayTasks.length,
      startIdx + 24
    );
    return {
      items: sortedDisplayTasks.slice(startIdx, endIdx),
      topSpacer: startIdx * rowHeight,
      bottomSpacer: Math.max(
        0,
        (sortedDisplayTasks.length - endIdx) * rowHeight
      ),
    };
  }, [useVirtualList, sortedDisplayTasks, scrollTop, rowHeight]);

  return (
    <div
      className={`glass-widget-shell ${effectiveThemeClass} ${
        settings.nativeEffect === "fallback" ? "effect-fallback" : ""
      } ${settings.reducedMotion ? "reduced-motion" : ""}`}
      style={
        {
          "--glass-accent": settings.accentColor,
          "--glass-opacity": settings.opacity,
          "--glass-blur": `${settings.blurIntensity}px`,
        } as React.CSSProperties
      }
    >
      {/* HEADER (Draggable except interactive buttons) */}
      <header
        data-tauri-drag-region
        className="px-3.5 pt-3 pb-2.5 border-b border-white/10 flex items-center justify-between gap-2 select-none"
      >
        <div
          data-tauri-drag-region
          className="flex items-center gap-2 min-w-0"
        >
          <div
            data-tauri-drag-region
            className="w-2.5 h-2.5 rounded-full shrink-0"
            style={{ backgroundColor: settings.accentColor }}
          />
          <h1
            data-tauri-drag-region
            className="text-sm font-bold tracking-tight truncate"
          >
            GlassTasks
          </h1>
          <span
            data-tauri-drag-region
            className="rounded-full bg-white/10 px-2 py-0.5 text-[11px] font-medium"
          >
            {activeCount} aktif
          </span>
          {vaultConfig?.demoMode && (
            <span className="inline-flex items-center gap-1 rounded-full bg-amber-500/25 border border-amber-400/40 px-2 py-0.5 text-[10px] font-semibold text-amber-200">
              <Sparkles className="w-2.5 h-2.5" />
              DEMO
            </span>
          )}
        </div>

        {/* Header Interactive Buttons (NOT part of drag region) */}
        <div className="flex items-center gap-1">
          {undoRecord && (
            <button
              type="button"
              onClick={handleUndo}
              title={`Undo: ${undoRecord.description}`}
              className="p-1.5 rounded-lg hover:bg-white/10 text-amber-300 transition"
            >
              <Undo2 className="w-3.5 h-3.5" />
            </button>
          )}

          <button
            type="button"
            onClick={async () => {
              const nextAot = !settings.alwaysOnTop;
              const nextSettings: WidgetSettings = {
                ...settings,
                alwaysOnTop: nextAot,
                windowMode: nextAot ? "always_on_top" : "floating",
              };
              setSettings(nextSettings);
              await persistWidgetSettings(nextSettings).catch(() => {});
            }}
            title={
              settings.alwaysOnTop
                ? "Always-on-Top Aktif (Klik untuk mematikan)"
                : "Aktifkan Always-on-Top"
            }
            className={`p-1.5 rounded-lg transition ${
              settings.alwaysOnTop
                ? "bg-sky-500/25 text-sky-300"
                : "hover:bg-white/10 opacity-70 hover:opacity-100"
            }`}
          >
            <Pin className="w-3.5 h-3.5" />
          </button>

          <button
            type="button"
            onClick={handleManualRefresh}
            title="Refresh manual dari Vault"
            className="p-1.5 rounded-lg hover:bg-white/10 opacity-80 hover:opacity-100 transition"
          >
            <RefreshCw
              className={`w-3.5 h-3.5 ${
                syncStatus === "loading_changes" ? "animate-spin" : ""
              }`}
            />
          </button>

          <button
            type="button"
            onClick={() => setShowQuickAdd(true)}
            title="Tambah Task Baru"
            className="inline-flex items-center gap-1 rounded-lg px-2.5 py-1 text-xs font-semibold text-slate-950 shadow-sm transition hover:brightness-110"
            style={{ backgroundColor: settings.accentColor }}
          >
            <Plus className="w-3.5 h-3.5 stroke-[2.5]" />
            <span>Tambah</span>
          </button>

          <button
            type="button"
            onClick={() => setShowSettings(true)}
            title="Pengaturan Widget"
            className="p-1.5 rounded-lg hover:bg-white/10 opacity-80 hover:opacity-100 transition"
          >
            <Settings className="w-3.5 h-3.5" />
          </button>
        </div>
      </header>

      {/* FILTER & SEARCH BAR */}
      <section className="px-3.5 py-2 border-b border-white/10 space-y-2">
        {/* Preset Pills */}
        <div className="flex items-center gap-1 overflow-x-auto no-scrollbar pb-0.5">
          {(
            [
              { id: "all_active", label: "Semua" },
              { id: "today", label: "Hari Ini" },
              { id: "upcoming_7d", label: "7 Hari" },
              { id: "overdue", label: "Overdue" },
              { id: "no_deadline", label: "Tanpa Tenggat" },
              { id: "completed", label: "Selesai" },
            ] as { id: FilterPreset; label: string }[]
          ).map((tab) => (
            <button
              key={tab.id}
              type="button"
              onClick={() => setFilterPreset(tab.id)}
              className={`rounded-lg px-2.5 py-1 text-[11px] font-medium whitespace-nowrap transition ${
                filterPreset === tab.id
                  ? "bg-sky-500/25 text-sky-300 border border-sky-400/40"
                  : "hover:bg-white/10 opacity-75"
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {/* Search + Sort + Tag/File Filter Row */}
        <div className="flex items-center gap-1.5">
          <div className="relative flex-1">
            <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 opacity-50" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Cari task, catatan, atau #tag..."
              aria-label="Cari task"
              className="w-full rounded-lg bg-white/10 border border-white/10 pl-7 pr-2 py-1 text-xs placeholder:opacity-50"
            />
          </div>

          <select
            value={sortBy}
            onChange={(e) => setSortBy(e.target.value as SortOption)}
            aria-label="Urutkan task"
            title="Urutan task"
            className="rounded-lg bg-slate-800/80 border border-white/10 px-2 py-1 text-[11px] text-slate-200"
          >
            <option value="deadline_asc">Urut: Deadline Terdekat</option>
            <option value="deadline_desc">Urut: Deadline Terjauh</option>
            <option value="priority">Urut: Prioritas</option>
            <option value="source">Urut: Posisi Sumber</option>
            <option value="title_asc">Urut: Judul A–Z</option>
          </select>
        </div>

        {/* Optional File & Tag secondary filter pills */}
        {(allSourceFiles.length > 1 || allTags.length > 0) && (
          <div className="flex items-center gap-1.5 text-[10px]">
            {allSourceFiles.length > 1 && (
              <select
                value={fileFilter ?? ""}
                onChange={(e) => setFileFilter(e.target.value || null)}
                aria-label="Filter berdasarkan file"
                className="rounded bg-slate-800/70 border border-white/10 px-1.5 py-0.5 text-slate-300 max-w-[150px] truncate"
              >
                <option value="">Semua File ({allSourceFiles.length})</option>
                {allSourceFiles.map((f) => (
                  <option key={f} value={f}>
                    {f}
                  </option>
                ))}
              </select>
            )}

            {allTags.length > 0 && (
              <select
                value={tagFilter ?? ""}
                onChange={(e) => setTagFilter(e.target.value || null)}
                aria-label="Filter berdasarkan tag"
                className="rounded bg-slate-800/70 border border-white/10 px-1.5 py-0.5 text-slate-300 max-w-[130px] truncate"
              >
                <option value="">Semua Tag ({allTags.length})</option>
                {allTags.map((tag) => (
                  <option key={tag} value={tag}>
                    {tag}
                  </option>
                ))}
              </select>
            )}
          </div>
        )}
      </section>

      {/* CONFLICT OR ERROR BANNER */}
      {(syncStatus === "conflict" ||
        syncStatus === "save_failed" ||
        syncStatus === "vault_unavailable") && (
        <div className="mx-3.5 mt-2 flex items-center justify-between gap-2 rounded-xl border border-rose-400/50 bg-rose-950/70 px-3 py-2 text-xs text-rose-200">
          <div className="flex items-center gap-2 min-w-0">
            <AlertTriangle className="w-4 h-4 text-rose-400 shrink-0" />
            <span className="truncate" title={statusMessage}>
              {statusMessage}
            </span>
          </div>
          <button
            type="button"
            onClick={handleManualRefresh}
            className="shrink-0 rounded bg-rose-500/30 px-2 py-0.5 text-[11px] font-medium hover:bg-rose-500/50"
          >
            Muat Ulang
          </button>
        </div>
      )}

      {/* SCROLLABLE TASK LIST AREA */}
      <main
        onScroll={(e) => setScrollTop(e.currentTarget.scrollTop)}
        className="task-list-scroll flex-1 px-3.5 py-2.5 space-y-1.5"
      >
        {sortedDisplayTasks.length === 0 ? (
          <div className="h-48 flex flex-col items-center justify-center text-center px-4 opacity-70">
            <FolderOpen className="w-7 h-7 mb-2 opacity-60" />
            <p className="text-xs font-medium">
              Tidak ada task untuk filter ini
            </p>
            <p className="text-[11px] opacity-75 mt-0.5">
              Klik tombol <strong>+ Tambah</strong> di atas atau ubah filter
              pencarian Anda.
            </p>
          </div>
        ) : (
          <>
            {visibleSlice.topSpacer > 0 && (
              <div style={{ height: `${visibleSlice.topSpacer}px` }} />
            )}
            {visibleSlice.items.map((task, idx) => {
              const nextTask = visibleSlice.items[idx + 1];
              const hasSubtasksBelow =
                !!nextTask &&
                nextTask.relativePath === task.relativePath &&
                nextTask.anchor.lineNumber === task.anchor.lineNumber + 1 &&
                nextTask.nestingLevel > task.nestingLevel;

              return (
                <TaskRow
                  key={task.id}
                  task={task}
                  todayLocal={todayLocal}
                  density={settings.density}
                  hasSubtasksBelow={hasSubtasksBelow}
                  onToggleStatus={handleToggleStatus}
                  onSaveTitle={handleSaveTitle}
                  onSaveDueDate={handleSaveDueDate}
                  onOpenInObsidian={(t) =>
                    openNoteInObsidian(
                      vaultConfig?.vaultName ?? "Vault",
                      t.relativePath,
                      t.headingContext
                    )
                  }
                  onRequestDelete={(t, hasSub) =>
                    setDeleteConfirmTarget({ task: t, hasSubtasks: hasSub })
                  }
                />
              );
            })}
            {visibleSlice.bottomSpacer > 0 && (
              <div style={{ height: `${visibleSlice.bottomSpacer}px` }} />
            )}
          </>
        )}

        {/* Collapsible Completed Section when viewing "Semua" */}
        {completedTasksSection.length > 0 && (
          <details className="pt-2">
            <summary className="cursor-pointer text-[11px] font-medium opacity-65 hover:opacity-100 py-1 select-none">
              Selesai ({completedTasksSection.length})
            </summary>
            <div className="mt-1.5 space-y-1.5">
              {completedTasksSection.map((task) => (
                <TaskRow
                  key={task.id}
                  task={task}
                  todayLocal={todayLocal}
                  density={settings.density}
                  hasSubtasksBelow={false}
                  onToggleStatus={handleToggleStatus}
                  onSaveTitle={handleSaveTitle}
                  onSaveDueDate={handleSaveDueDate}
                  onOpenInObsidian={(t) =>
                    openNoteInObsidian(
                      vaultConfig?.vaultName ?? "Vault",
                      t.relativePath,
                      t.headingContext
                    )
                  }
                  onRequestDelete={(t, hasSub) =>
                    setDeleteConfirmTarget({ task: t, hasSubtasks: hasSub })
                  }
                />
              ))}
            </div>
          </details>
        )}
      </main>

      {/* DELETE CONFIRMATION DIALOG */}
      {deleteConfirmTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/70 p-4 backdrop-blur-sm">
          <div className="w-full max-w-xs rounded-2xl border border-white/15 bg-slate-900 p-4 text-xs text-slate-100 shadow-2xl space-y-3">
            <div className="font-semibold text-rose-300">
              Konfirmasi Hapus Task
            </div>
            <p className="text-slate-300">
              Hapus baris task{" "}
              <strong>"{deleteConfirmTarget.task.displayTitle}"</strong> dari
              catatan <code>{deleteConfirmTarget.task.relativePath}</code>?
            </p>
            {deleteConfirmTarget.hasSubtasks && (
              <div className="rounded-lg border border-amber-400/40 bg-amber-950/40 p-2 text-amber-200 text-[11px]">
                Perhatian: Task ini memiliki subtask bersarang (nested) di
                bawahnya. Hanya baris task induk ini yang akan dihapus; subtask
                di bawahnya tidak ikut dihapus otomatis.
              </div>
            )}
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setDeleteConfirmTarget(null)}
                className="px-3 py-1.5 rounded-lg border border-white/10 hover:bg-white/5"
              >
                Batal
              </button>
              <button
                type="button"
                onClick={handleConfirmDelete}
                className="px-3 py-1.5 rounded-lg bg-rose-500 font-semibold text-white hover:bg-rose-400"
              >
                Hapus (Undo Tersedia)
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MODALS */}
      {showOnboarding && (
        <OnboardingModal
          initialConfig={vaultConfig}
          onComplete={handleOnboardingComplete}
          onCancel={vaultConfig ? () => setShowOnboarding(false) : undefined}
        />
      )}

      {showQuickAdd && vaultConfig && (
        <QuickAddModal
          availableFiles={allSourceFiles}
          defaultTargetFile={vaultConfig.defaultTargetFile}
          todayLocal={todayLocal}
          onAdd={handleAddTask}
          onClose={() => setShowQuickAdd(false)}
        />
      )}

      {showSettings && (
        <SettingsModal
          settings={settings}
          onSaveSettings={async (newSettings) => {
            setSettings(newSettings);
            await persistWidgetSettings(newSettings);
            showToast("success", "Pengaturan berhasil disimpan ✓");
          }}
          onOpenVaultPicker={() => setShowOnboarding(true)}
          onClose={() => setShowSettings(false)}
        />
      )}

      {/* TOAST NOTIFICATIONS */}
      <div className="fixed bottom-4 right-4 z-50 flex flex-col gap-2 pointer-events-none">
        {toasts.map((toast) => (
          <div
            key={toast.id}
            className={`pointer-events-auto flex items-center gap-2 px-3 py-2 rounded-lg shadow-lg text-xs font-medium transition-all animate-slide-in ${
              toast.type === "success"
                ? "bg-emerald-600 text-white border border-emerald-400"
                : toast.type === "error"
                ? "bg-rose-600 text-white border border-rose-400"
                : "bg-sky-600 text-white border border-sky-400"
            }`}
          >
            {toast.type === "success" && <Check className="w-4 h-4" />}
            {toast.type === "error" && <AlertTriangle className="w-4 h-4" />}
            {toast.type === "info" && <Bell className="w-4 h-4" />}
            <span>{toast.message}</span>
          </div>
        ))}
      </div>
    </div>
  );
};
