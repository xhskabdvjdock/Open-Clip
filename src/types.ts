export type ContentType = "text" | "url" | "code" | "number" | "email" | "image";

export interface ClipboardItem {
  id: string;
  content: string;
  /** for images: file path or data-url preview; text content stays short label */
  content_type: ContentType;
  created_at: number; // epoch ms
  last_copied_at: number; // epoch ms
  is_pinned: boolean;
  is_sensitive: boolean;
  content_hash: string;
  char_count?: number;
  word_count?: number;
  /** image-only */
  image_path?: string | null;
}

export type HistoryLimit = 100 | 500 | 1000;
export type AutoDelete = "never" | "1h" | "1d" | "7d" | "30d";
export type SensitiveMode = "never" | "ask" | "allow";
export type Theme = "light" | "dark" | "system";
export type Lang = "en" | "ar";

export interface AppSettings {
  startOnStartup: boolean;
  minimizeToTray: boolean;
  theme: Theme;
  lang: Lang;
  historyLimit: HistoryLimit;
  autoDelete: AutoDelete;
  monitoringPaused: boolean;
  sensitiveMode: SensitiveMode;
  quickPasteShortcut: string; // e.g. "Alt+V"
  pasteAutomatically: boolean;
  startMinimized: boolean;
  onboardingDone: boolean;
}

export const DEFAULT_SETTINGS: AppSettings = {
  startOnStartup: false,
  minimizeToTray: true,
  theme: "system",
  lang: "en",
  historyLimit: 500,
  autoDelete: "never",
  monitoringPaused: false,
  sensitiveMode: "never",
  quickPasteShortcut: "Alt+V",
  pasteAutomatically: false,
  startMinimized: true,
  onboardingDone: false,
};

export type TypeFilter = "all" | "text" | "links" | "code" | "images" | "other";
export type DateFilter = "today" | "yesterday" | "7d" | "30d" | "all";
