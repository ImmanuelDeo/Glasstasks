import { invoke } from "@tauri-apps/api/core";
import { listen, UnlistenFn } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { open as openShellUrl } from "@tauri-apps/plugin-shell";
import {
  enable as enableAutostart,
  disable as disableAutostart,
} from "@tauri-apps/plugin-autostart";
import {
  register as registerShortcut,
  unregisterAll as unregisterAllShortcuts,
} from "@tauri-apps/plugin-global-shortcut";
import {
  DeleteTaskRequest,
  NewTaskRequest,
  PerformanceMetrics,
  TaskItem,
  TaskPatchRequest,
  UndoRecord,
  VaultConfig,
  WidgetSettings,
  WriteOutcome,
} from "../types/task";
import { INITIAL_DEMO_FILES } from "../core/demoVault";
import { parseMarkdownTasksTS, patchTaskRawLineTS } from "../core/parser";

export function isTauriRuntime(): boolean {
  return (
    typeof window !== "undefined" &&
    ("__TAURI_INTERNALS__" in window || "__TAURI__" in window)
  );
}

export const DEFAULT_WIDGET_SETTINGS: WidgetSettings = {
  theme: "dark_glass",
  accentColor: "#38bdf8",
  opacity: 0.84,
  blurIntensity: 18,
  nativeEffect: "acrylic",
  density: "comfortable",
  reducedMotion: false,
  alwaysOnTop: false,
  windowMode: "floating",
  clickThrough: false,
  hideToTrayOnClose: true,
  startMinimized: false,
  autostartEnabled: true,
  globalHotkey: "Control+Alt+G",
  showCompletedSection: true,
  customStatusMap: {},
  windowBounds: { x: 100, y: 90, width: 410, height: 640 },
};

// Isolated in-memory state used ONLY when user explicitly activates Demo Mode
let demoFilesState: Record<string, string> = { ...INITIAL_DEMO_FILES };
let demoUndoStack: UndoRecord[] = [];

function parseAllDemoTasks(customStatusMap: Record<string, string>): TaskItem[] {
  const all: TaskItem[] = [];
  for (const [relPath, content] of Object.entries(demoFilesState)) {
    all.push(...parseMarkdownTasksTS(relPath, content, customStatusMap));
  }
  return all;
}

export async function fetchInitialState(): Promise<{
  vaultConfig: VaultConfig | null;
  widgetSettings: WidgetSettings;
  tasks: TaskItem[];
  vaultAvailable: boolean;
  errorMessage: string | null;
  undoAvailable: UndoRecord | null;
}> {
  if (isTauriRuntime()) {
    return await invoke("get_initial_state");
  }
  return {
    vaultConfig: null,
    widgetSettings: DEFAULT_WIDGET_SETTINGS,
    tasks: [],
    vaultAvailable: true,
    errorMessage: null,
    undoAvailable: null,
  };
}

export async function pickVaultDirectory(): Promise<string | null> {
  if (isTauriRuntime()) {
    const selected = await openDialog({
      directory: true,
      multiple: false,
      title: "Pilih Folder Vault Obsidian Anda",
    });
    return typeof selected === "string" ? selected : null;
  }
  return null;
}

export async function listVaultMarkdownFiles(
  vaultPath: string
): Promise<string[]> {
  if (isTauriRuntime()) {
    return await invoke<string[]>("list_vault_markdown_files", { vaultPath });
  }
  return Object.keys(demoFilesState);
}

export async function previewVaultScope(config: VaultConfig): Promise<{
  fileCount: number;
  taskCount: number;
  sampleTasks: TaskItem[];
  defaultTargetExists: boolean;
}> {
  if (config.demoMode || !isTauriRuntime()) {
    const tasks = parseAllDemoTasks({});
    return {
      fileCount: Object.keys(demoFilesState).length,
      taskCount: tasks.length,
      sampleTasks: tasks.slice(0, 25),
      defaultTargetExists: true,
    };
  }
  return await invoke("preview_vault_scope", { config });
}

export async function saveVaultConfig(
  config: VaultConfig,
  customStatusMap: Record<string, string>
): Promise<TaskItem[]> {
  if (config.demoMode) {
    demoFilesState = { ...INITIAL_DEMO_FILES };
    demoUndoStack = [];
    if (isTauriRuntime()) {
      await invoke("save_vault_config", { config });
    }
    return parseAllDemoTasks(customStatusMap);
  }
  return await invoke<TaskItem[]>("save_vault_config", { config });
}

export async function refreshTasks(
  demoMode: boolean,
  customStatusMap: Record<string, string>
): Promise<TaskItem[]> {
  if (demoMode || !isTauriRuntime()) {
    return parseAllDemoTasks(customStatusMap);
  }
  return await invoke<TaskItem[]>("refresh_vault_tasks");
}

export async function reconcileOnResume(
  demoMode: boolean
): Promise<{ changed: boolean; tasks: TaskItem[] }> {
  if (demoMode || !isTauriRuntime()) {
    return { changed: false, tasks: [] };
  }
  return await invoke("reconcile_on_resume");
}

export async function patchTaskItem(
  demoMode: boolean,
  customStatusMap: Record<string, string>,
  req: TaskPatchRequest
): Promise<WriteOutcome> {
  if (demoMode || !isTauriRuntime()) {
    const start = performance.now();
    const content = demoFilesState[req.relativePath];
    if (content === undefined) {
      return {
        success: false,
        syncStatus: "vault_unavailable",
        message: `File demo '${req.relativePath}' tidak ditemukan.`,
        conflictDetected: false,
        updatedFileTasks: parseAllDemoTasks(customStatusMap),
        undoAvailable: demoUndoStack[0] ?? null,
        writeLatencyMs: performance.now() - start,
      };
    }
    const lines = content.split("\n");
    const idx = req.anchor.lineNumber - 1;
    if (lines[idx] !== req.originalRawLine) {
      return {
        success: false,
        syncStatus: "conflict",
        message: "Konflik terdeteksi pada baris sumber.",
        conflictDetected: true,
        updatedFileTasks: parseAllDemoTasks(customStatusMap),
        undoAvailable: demoUndoStack[0] ?? null,
        writeLatencyMs: performance.now() - start,
      };
    }
    try {
      const patched = patchTaskRawLineTS(lines[idx], req);
      const before = lines[idx];
      lines[idx] = patched;
      demoFilesState[req.relativePath] = lines.join("\n");
      const undo: UndoRecord = {
        id: `demo_undo_${Date.now()}`,
        description: "Perubahan task (Demo)",
        relativePath: req.relativePath,
        lineNumber: req.anchor.lineNumber,
        beforeLine: before,
        afterLine: patched,
        fileHashAfterWrite: "demo",
        timestampMs: Date.now(),
      };
      demoUndoStack.unshift(undo);
      return {
        success: true,
        syncStatus: "synced",
        message: "Tersinkron (Mode Demo)",
        conflictDetected: false,
        updatedFileTasks: parseAllDemoTasks(customStatusMap),
        undoAvailable: undo,
        writeLatencyMs: performance.now() - start,
      };
    } catch (err: any) {
      return {
        success: false,
        syncStatus: "save_failed",
        message: err?.message ?? "Gagal mengubah task",
        conflictDetected: false,
        updatedFileTasks: parseAllDemoTasks(customStatusMap),
        undoAvailable: demoUndoStack[0] ?? null,
        writeLatencyMs: performance.now() - start,
      };
    }
  }
  return await invoke<WriteOutcome>("patch_task", { req });
}

export async function createNewTaskItem(
  demoMode: boolean,
  customStatusMap: Record<string, string>,
  req: NewTaskRequest
): Promise<WriteOutcome> {
  if (demoMode || !isTauriRuntime()) {
    const start = performance.now();
    const exists = req.relativePath in demoFilesState;
    if (!exists && !req.createFileApproved) {
      return {
        success: false,
        syncStatus: "save_failed",
        message: `NEEDS_CREATE_APPROVAL: File '${req.relativePath}' belum ada. Konfirmasi untuk membuat file baru.`,
        conflictDetected: false,
        updatedFileTasks: parseAllDemoTasks(customStatusMap),
        undoAvailable: demoUndoStack[0] ?? null,
        writeLatencyMs: performance.now() - start,
      };
    }
    const parts = [`- [ ] ${req.title.trim()}`];
    if (req.dueDate) parts.push(`📅 ${req.dueDate}`);
    for (const tag of req.tags) {
      const normalizedTag = tag.startsWith("#") ? tag : `#${tag}`;
      if (!req.title.includes(normalizedTag)) parts.push(normalizedTag);
    }
    const line = parts.join(" ");
    const prev = demoFilesState[req.relativePath] ?? "";
    const updated = prev.endsWith("\n") || prev.length === 0
      ? `${prev}${line}\n`
      : `${prev}\n${line}\n`;
    demoFilesState[req.relativePath] = updated;
    const lineCount = updated.trimEnd().split("\n").length;
    const undo: UndoRecord = {
      id: `demo_undo_${Date.now()}`,
      description: `Tambah task '${req.title.trim()}'`,
      relativePath: req.relativePath,
      lineNumber: lineCount,
      beforeLine: null,
      afterLine: line,
      fileHashAfterWrite: "demo",
      timestampMs: Date.now(),
    };
    demoUndoStack.unshift(undo);
    return {
      success: true,
      syncStatus: "synced",
      message: "Task ditambahkan (Mode Demo)",
      conflictDetected: false,
      updatedFileTasks: parseAllDemoTasks(customStatusMap),
      undoAvailable: undo,
      writeLatencyMs: performance.now() - start,
    };
  }
  return await invoke<WriteOutcome>("create_task", { req });
}

export async function deleteTaskItem(
  demoMode: boolean,
  customStatusMap: Record<string, string>,
  req: DeleteTaskRequest
): Promise<WriteOutcome> {
  if (demoMode || !isTauriRuntime()) {
    const start = performance.now();
    const content = demoFilesState[req.relativePath];
    if (!content) {
      return {
        success: false,
        syncStatus: "vault_unavailable",
        message: "File tidak ditemukan.",
        conflictDetected: false,
        updatedFileTasks: parseAllDemoTasks(customStatusMap),
        undoAvailable: demoUndoStack[0] ?? null,
        writeLatencyMs: performance.now() - start,
      };
    }
    const lines = content.split("\n");
    const idx = req.anchor.lineNumber - 1;
    if (lines[idx] !== req.originalRawLine) {
      return {
        success: false,
        syncStatus: "conflict",
        message: "Konflik saat menghapus task.",
        conflictDetected: true,
        updatedFileTasks: parseAllDemoTasks(customStatusMap),
        undoAvailable: demoUndoStack[0] ?? null,
        writeLatencyMs: performance.now() - start,
      };
    }
    const [removed] = lines.splice(idx, 1);
    demoFilesState[req.relativePath] = lines.join("\n");
    const undo: UndoRecord = {
      id: `demo_undo_${Date.now()}`,
      description: "Hapus task",
      relativePath: req.relativePath,
      lineNumber: req.anchor.lineNumber,
      beforeLine: removed,
      afterLine: null,
      fileHashAfterWrite: "demo",
      timestampMs: Date.now(),
    };
    demoUndoStack.unshift(undo);
    return {
      success: true,
      syncStatus: "synced",
      message: "Task dihapus (Undo tersedia)",
      conflictDetected: false,
      updatedFileTasks: parseAllDemoTasks(customStatusMap),
      undoAvailable: undo,
      writeLatencyMs: performance.now() - start,
    };
  }
  return await invoke<WriteOutcome>("delete_task", { req });
}

export async function undoLastTaskAction(
  demoMode: boolean,
  customStatusMap: Record<string, string>
): Promise<WriteOutcome> {
  if (demoMode || !isTauriRuntime()) {
    const start = performance.now();
    const rec = demoUndoStack.shift();
    if (!rec) {
      return {
        success: false,
        syncStatus: "synced",
        message: "Tidak ada aksi untuk di-undo.",
        conflictDetected: false,
        updatedFileTasks: parseAllDemoTasks(customStatusMap),
        undoAvailable: null,
        writeLatencyMs: 0,
      };
    }
    const content = demoFilesState[rec.relativePath] ?? "";
    const lines = content.split("\n");
    const idx = rec.lineNumber - 1;
    if (rec.beforeLine !== null && rec.afterLine !== null) {
      if (lines[idx] === rec.afterLine) lines[idx] = rec.beforeLine;
    } else if (rec.beforeLine === null && rec.afterLine !== null) {
      const foundIdx = lines.lastIndexOf(rec.afterLine);
      if (foundIdx >= 0) lines.splice(foundIdx, 1);
    } else if (rec.beforeLine !== null && rec.afterLine === null) {
      lines.splice(idx, 0, rec.beforeLine);
    }
    demoFilesState[rec.relativePath] = lines.join("\n");
    return {
      success: true,
      syncStatus: "synced",
      message: `Undo berhasil: ${rec.description}`,
      conflictDetected: false,
      updatedFileTasks: parseAllDemoTasks(customStatusMap),
      undoAvailable: demoUndoStack[0] ?? null,
      writeLatencyMs: performance.now() - start,
    };
  }
  return await invoke<WriteOutcome>("undo_last_action");
}

export async function persistWidgetSettings(
  settings: WidgetSettings
): Promise<string> {
  if (isTauriRuntime()) {
    try {
      if (settings.autostartEnabled) {
        await enableAutostart();
      } else {
        await disableAutostart();
      }
    } catch {
      // Autostart plugin may be restricted in dev mode
    }

    return await invoke<string>("save_widget_settings", { settings });
  }
  return "css_translucent_fallback";
}

/** Register global shortcut - handled natively in Rust backend */
export async function registerGlobalHotkeyOnly(_hotkey: string): Promise<void> {
  // Handled natively in Rust setup and save_widget_settings
}

export async function openNoteInObsidian(
  vaultName: string,
  relativePath: string,
  headingContext: string | null
): Promise<string> {
  let uri: string;
  if (isTauriRuntime()) {
    uri = await invoke<string>("build_obsidian_uri", {
      vaultName,
      relativePath,
      headingContext,
    });
    await openShellUrl(uri);
  } else {
    const cleanRel = relativePath.replace(/\.md$/i, "");
    const target = headingContext
      ? `${cleanRel}#${headingContext.replace(/^#+\s*/, "").trim()}`
      : cleanRel;
    uri = `obsidian://open?vault=${encodeURIComponent(
      vaultName
    )}&file=${encodeURIComponent(target)}`;
  }
  return uri;
}

export async function fetchPerformanceMetrics(): Promise<PerformanceMetrics> {
  if (isTauriRuntime()) {
    return await invoke<PerformanceMetrics>("get_performance_metrics");
  }
  return {
    startupMs: 14.2,
    lastIndexMs: 1.8,
    indexedFilesCount: Object.keys(demoFilesState).length,
    indexedTasksCount: parseAllDemoTasks({}).length,
    lastWatcherToUiMs: 0.9,
    lastWriteMs: 1.4,
  };
}

export async function subscribeToVaultEvents(handlers: {
  onTasksUpdated: (payload: { tasks: TaskItem[]; latencyMs: number }) => void;
  onWatcherError: (payload: { error: string }) => void;
  onSettingsUpdated: (settings: WidgetSettings) => void;
  onManualRefreshRequested: () => void;
  onFocusReconcile: () => void;
}): Promise<UnlistenFn[]> {
  if (!isTauriRuntime()) return [];
  const u1 = await listen<{ tasks: TaskItem[]; latencyMs: number }>(
    "vault-tasks-updated",
    (ev) => handlers.onTasksUpdated(ev.payload)
  );
  const u2 = await listen<{ error: string }>("vault-watcher-error", (ev) =>
    handlers.onWatcherError(ev.payload)
  );
  const u3 = await listen<WidgetSettings>("settings-updated", (ev) =>
    handlers.onSettingsUpdated(ev.payload)
  );
  const u4 = await listen("request-manual-refresh", () =>
    handlers.onManualRefreshRequested()
  );
  const u5 = await listen("window-focused-reconcile", () =>
    handlers.onFocusReconcile()
  );
  return [u1, u2, u3, u4, u5];
}
