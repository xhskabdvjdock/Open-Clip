import { invoke } from "@tauri-apps/api/core";
import type { AppSettings, ClipboardItem } from "../types";
import { DEFAULT_SETTINGS } from "../types";
import { classifyContent, hashContent, isSensitive } from "./classify";

function isTauri(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

const LS_ITEMS = "openclip.items.v1";
const LS_SETTINGS = "openclip.settings.v1";

/** Load settings: Tauri backend first, localStorage fallback (dev/browser). */
export async function loadSettings(): Promise<AppSettings> {
  if (isTauri()) {
    try {
      const s = await invoke<AppSettings>("get_settings");
      return { ...DEFAULT_SETTINGS, ...s };
    } catch {
      // fall through
    }
  }
  try {
    const raw = localStorage.getItem(LS_SETTINGS);
    if (raw) return { ...DEFAULT_SETTINGS, ...JSON.parse(raw) };
  } catch { /* ignore */ }
  return { ...DEFAULT_SETTINGS };
}

export async function saveSettings(s: AppSettings): Promise<void> {
  if (isTauri()) {
    try {
      await invoke("set_settings", { settings: s });
      return;
    } catch { /* fallback also saves locally */ }
  }
  try {
    localStorage.setItem(LS_SETTINGS, JSON.stringify(s));
  } catch { /* ignore */ }
}

export async function loadItems(): Promise<ClipboardItem[]> {
  if (isTauri()) {
    try {
      return await invoke<ClipboardItem[]>("get_items", { limit: 2000 });
    } catch {
      return [];
    }
  }
  try {
    const raw = localStorage.getItem(LS_ITEMS);
    if (!raw) return [];
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? arr : [];
  } catch {
    return [];
  }
}

/** Dev/browser fallback: add item locally with same rules as Rust. Used only outside Tauri. */
export async function devAddClipboardText(
  text: string,
  settings: AppSettings,
  existing: ClipboardItem[],
): Promise<{ items: ClipboardItem[]; blockedSensitive: boolean }> {
  const { sensitive } = isSensitive(text);
  if (sensitive && settings.sensitiveMode === "never") {
    return { items: existing, blockedSensitive: true };
  }
  const hash = hashContent(text);
  const now = Date.now();
  const dup = existing.find((i) => i.content_hash === hash);
  if (dup) {
    const items = existing.map((i) =>
      i.id === dup.id ? { ...i, last_copied_at: now } : i,
    );
    persistLocal(items);
    return { items, blockedSensitive: false };
  }
  const type = classifyContent(text);
  const { chars, words } = { chars: [...text].length, words: text.trim() ? text.trim().split(/\s+/).length : 0 };
  const item: ClipboardItem = {
    id: `${now}-${hash}`,
    content: text,
    content_type: type,
    created_at: now,
    last_copied_at: now,
    is_pinned: false,
    is_sensitive: sensitive,
    content_hash: hash,
    char_count: chars,
    word_count: words,
  };
  let items = [item, ...existing];
  // enforce limit (unpinned oldest removed)
  const limit = settings.historyLimit;
  const pinned = items.filter((i) => i.is_pinned);
  const rest = items.filter((i) => !i.is_pinned).slice(0, Math.max(0, limit - pinned.length));
  items = [...pinned.filter((p) => items.includes(p)), ...rest].sort(
    (a, b) => (b.is_pinned ? 1 : 0) - (a.is_pinned ? 1 : 0) || b.last_copied_at - a.last_copied_at,
  );
  // simpler: keep pinned + newest rest, sorted with pinned first
  const merged = [...items.filter((i) => i.is_pinned), ...items.filter((i) => !i.is_pinned)];
  persistLocal(merged);
  return { items: merged, blockedSensitive: false };
}

function persistLocal(items: ClipboardItem[]) {
  try {
    localStorage.setItem(LS_ITEMS, JSON.stringify(items.slice(0, 1000)));
  } catch { /* ignore */ }
}

export async function copyText(text: string): Promise<void> {
  if (isTauri()) {
    await invoke("copy_to_clipboard", { content: text });
    return;
  }
  await navigator.clipboard.writeText(text);
}

export async function deleteItemCmd(id: string): Promise<void> {
  if (isTauri()) {
    await invoke("delete_item", { id });
    return;
  }
  try {
    const raw = localStorage.getItem(LS_ITEMS);
    const arr: ClipboardItem[] = raw ? JSON.parse(raw) : [];
    localStorage.setItem(LS_ITEMS, JSON.stringify(arr.filter((i) => i.id !== id)));
  } catch { /* ignore */ }
}

export async function togglePinCmd(id: string): Promise<void> {
  if (isTauri()) {
    await invoke("toggle_pin", { id });
    return;
  }
  try {
    const raw = localStorage.getItem(LS_ITEMS);
    const arr: ClipboardItem[] = raw ? JSON.parse(raw) : [];
    localStorage.setItem(
      LS_ITEMS,
      JSON.stringify(arr.map((i) => (i.id === id ? { ...i, is_pinned: !i.is_pinned } : i))),
    );
  } catch { /* ignore */ }
}

export async function clearHistoryCmd(): Promise<void> {
  if (isTauri()) {
    await invoke("clear_history");
    return;
  }
  try {
    const raw = localStorage.getItem(LS_ITEMS);
    const arr: ClipboardItem[] = raw ? JSON.parse(raw) : [];
    localStorage.setItem(LS_ITEMS, JSON.stringify(arr.filter((i) => i.is_pinned)));
  } catch { /* ignore */ }
}

export async function deleteAllCmd(): Promise<void> {
  if (isTauri()) {
    await invoke("delete_all_data");
    return;
  }
  localStorage.removeItem(LS_ITEMS);
  localStorage.removeItem(LS_SETTINGS);
}

export async function setPausedCmd(paused: boolean): Promise<void> {
  if (isTauri()) {
    await invoke("set_monitoring_paused", { paused });
  }
}

export async function forceSaveText(content: string) {
  if (isTauri()) {
    return invoke("force_save_text", { content });
  }
}

export async function openPickerWindow(): Promise<void> {
  if (isTauri()) {
    try {
      await invoke("show_picker");
    } catch { /* ignore */ }
  }
}

export async function hidePickerWindow(): Promise<void> {
  if (isTauri()) {
    try {
      await invoke("hide_picker");
    } catch { /* ignore */ }
  }
}

export function isTauriEnv(): boolean {
  return isTauri();
}
