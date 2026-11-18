export type CheckboxStatus = "todo" | "done" | { custom: string };

export type PriorityLevel =
  | "highest"
  | "high"
  | "medium"
  | "none"
  | "low"
  | "lowest";

export interface SourceAnchor {
  lineNumber: number;
  byteStart: number;
  byteEnd: number;
  fileHash: string;
  duplicateOccurrenceIndex: number;
  contextBefore: string[];
  contextAfter: string[];
}

export interface TaskItem {
  id: string;
  rawLine: string;
  relativePath: string;
  headingContext: string | null;
  anchor: SourceAnchor;
  indent: string;
  nestingLevel: number;
  bulletMarker: string;
  checkboxChar: string;
  status: CheckboxStatus;
  displayTitle: string;
  dueDate: string | null;
  hasInvalidDueDate: boolean;
  rawInvalidDueDate: string | null;
  scheduledDate: string | null;
  startDate: string | null;
  doneDate: string | null;
  createdDate: string | null;
  priority: PriorityLevel;
  recurrenceRule: string | null;
  isRecurring: boolean;
  isReadOnly: boolean;
  readOnlyReason: string | null;
  tags: string[];
  links: string[];
  unrecognizedMetadata: string[];
  conflictInfo: string | null;
}

export type SourceScopeMode =
  | "single_file"
  | "multiple_files"
  | "folder"
  | "whole_vault";

export interface VaultConfig {
  vaultPath: string;
  vaultName: string;
  scopeMode: SourceScopeMode;
  selectedFiles: string[];
  selectedFolder: string | null;
  defaultTargetFile: string;
  demoMode: boolean;
}

export interface WindowBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface WidgetSettings {
  theme: "light_glass" | "dark_glass" | "system";
  accentColor: string;
  opacity: number;
  blurIntensity: number;
  nativeEffect: "mica" | "acrylic" | "blur" | "fallback";
  density: "compact" | "comfortable";
  reducedMotion: boolean;
  alwaysOnTop: boolean;
  windowMode: "floating" | "always_on_top" | "desktop_pinned";
  clickThrough: boolean;
  hideToTrayOnClose: boolean;
  startMinimized: boolean;
  autostartEnabled: boolean;
  globalHotkey: string;
  showCompletedSection: boolean;
  customStatusMap: Record<string, string>;
  windowBounds: WindowBounds;
}

export type SyncStatus =
  | "synced"
  | "saving"
  | "loading_changes"
  | "conflict"
  | "save_failed"
  | "vault_unavailable";

export type FilterPreset =
  | "all_active"
  | "overdue"
  | "today"
  | "upcoming_7d"
  | "no_deadline"
  | "completed";

export type SortOption =
  | "deadline_asc"
  | "deadline_desc"
  | "priority"
  | "source"
  | "title_asc";

export interface TaskPatchRequest {
  taskId: string;
  relativePath: string;
  anchor: SourceAnchor;
  originalRawLine: string;
  newStatus?: CheckboxStatus | null;
  newTitle?: string | null;
  /** undefined = keep unchanged; null = remove due date; string = set/update due date */
  newDueDate?: string | null;
  todayLocal: string;
}

export interface NewTaskRequest {
  relativePath: string;
  title: string;
  dueDate: string | null;
  tags: string[];
  targetHeading: string | null;
  createFileApproved: boolean;
}

export interface DeleteTaskRequest {
  taskId: string;
  relativePath: string;
  anchor: SourceAnchor;
  originalRawLine: string;
}

export interface UndoRecord {
  id: string;
  description: string;
  relativePath: string;
  lineNumber: number;
  beforeLine: string | null;
  afterLine: string | null;
  fileHashAfterWrite: string;
  timestampMs: number;
}

export interface WriteOutcome {
  success: boolean;
  syncStatus: SyncStatus;
  message: string;
  conflictDetected: boolean;
  updatedFileTasks: TaskItem[];
  undoAvailable: UndoRecord | null;
  writeLatencyMs: number;
}

export interface PerformanceMetrics {
  startupMs: number;
  lastIndexMs: number;
  indexedFilesCount: number;
  indexedTasksCount: number;
  lastWatcherToUiMs: number;
  lastWriteMs: number;
}
