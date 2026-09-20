import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { listen } from "@tauri-apps/api/event";
import type {
  AppSettings,
  ClipboardItem,
  DateFilter,
  TypeFilter,
} from "../types";
import { DEFAULT_SETTINGS } from "../types";
import { STRINGS } from "../i18n";
import {
  clearHistoryCmd,
  copyText,
  deleteAllCmd,
  deleteItemCmd,
  forceSaveText,
  isTauriEnv,
  loadItems,
  loadSettings,
  saveSettings,
  setPausedCmd,
  togglePinCmd,
} from "./store-api";

interface Store {
  items: ClipboardItem[];
  settings: AppSettings;
  strings: (typeof STRINGS)["en"];
  lang: "en" | "ar";
  search: string;
  setSearch: (s: string) => void;
  typeFilter: TypeFilter;
  setTypeFilter: (f: TypeFilter) => void;
  dateFilter: DateFilter;
  setDateFilter: (f: DateFilter) => void;
  filtered: ClipboardItem[];
  pinned: ClipboardItem[];
  unpinnedFiltered: ClipboardItem[];
  monitoringPaused: boolean;
  monitorError: boolean;
  blockedNotice: boolean;
  setBlockedNotice: (b: boolean) => void;
  pendingSensitive: string | null;
  savePendingOnce: () => Promise<void>;
  dismissPending: () => void;
  refresh: () => Promise<void>;
  updateSettings: (patch: Partial<AppSettings>) => Promise<void>;
  doCopy: (item: ClipboardItem) => Promise<void>;
  doPin: (id: string) => Promise<void>;
  doDelete: (id: string) => Promise<void>;
  doClear: () => Promise<void>;
  doDeleteAll: () => Promise<void>;
  setPaused: (p: boolean) => Promise<void>;
  lastCopiedId: string | null;
}

const Ctx = createContext<Store | null>(null);

function matchesDate(ts: number, f: DateFilter): boolean {
  if (f === "all") return true;
  const d = new Date(ts);
  const now = new Date();
  const day = (x: Date) => `${x.getFullYear()}-${x.getMonth()}-${x.getDate()}`;
  if (f === "today") return day(d) === day(now);
  if (f === "yesterday") {
    const y = new Date(now);
    y.setDate(now.getDate() - 1);
    return day(d) === day(y);
  }
  const diff = Date.now() - ts;
  if (f === "7d") return diff <= 7 * 86400_000;
  return diff <= 30 * 86400_000;
}

function matchesType(t: string, f: TypeFilter): boolean {
  if (f === "all") return true;
  if (f === "links") return t === "url" || t === "email";
  if (f === "images") return t === "image";
  if (f === "other") return t === "number" || t === "email";
  if (f === "text") return t === "text";
  if (f === "code") return t === "code";
  return true;
}

export function StoreProvider({ children }: { children: React.ReactNode }) {
  const [items, setItems] = useState<ClipboardItem[]>([]);
  const [settings, setSettings] = useState<AppSettings>(DEFAULT_SETTINGS);
  const [search, setSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState<TypeFilter>("all");
  const [dateFilter, setDateFilter] = useState<DateFilter>("all");
  const [monitorError, setMonitorError] = useState(false);
  const [blockedNotice, setBlockedNotice] = useState(false);
  const [pendingSensitive, setPendingSensitive] = useState<string | null>(null);
  const [lastCopiedId, setLastCopiedId] = useState<string | null>(null);
  const settingsRef = useRef(settings);
  settingsRef.current = settings;

  const refresh = useCallback(async () => {
    const [it, s] = await Promise.all([loadItems(), loadSettings()]);
    setItems(it.sort((a, b) => b.last_copied_at - a.last_copied_at));
    setSettings({ ...DEFAULT_SETTINGS, ...s });
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  // Apply theme + dir + lang
  useEffect(() => {
    const root = document.documentElement;
    const theme = settings.theme;
    const dark =
      theme === "dark" ||
      (theme === "system" &&
        window.matchMedia("(prefers-color-scheme: dark)").matches);
    root.classList.toggle("dark", dark);
    root.lang = settings.lang;
    root.dir = settings.lang === "ar" ? "rtl" : "ltr";
  }, [settings.theme, settings.lang]);

  // Tauri events: new clipboard item / list changed / monitor error / sensitive blocked
  useEffect(() => {
    if (!isTauriEnv()) return;
    let unsubs: (() => void)[] = [];
    (async () => {
      try {
        unsubs.push(
          await listen<ClipboardItem>("clipboard://new-item", (e) => {
            setItems((prev) => {
              const exists = prev.find((i) => i.id === e.payload.id);
              if (exists) {
                return prev
                  .map((i) => (i.id === e.payload.id ? e.payload : i))
                  .sort((a, b) => b.last_copied_at - a.last_copied_at);
              }
              return [e.payload, ...prev].sort(
                (a, b) => b.last_copied_at - a.last_copied_at,
              );
            });
          }),
        );
        unsubs.push(
          await listen<ClipboardItem[]>("clipboard://list-changed", (e) => {
            setItems([...e.payload].sort((a, b) => b.last_copied_at - a.last_copied_at));
          }),
        );
        unsubs.push(
          await listen("clipboard://sensitive-blocked", () => setBlockedNotice(true)),
        );
        unsubs.push(
          await listen<{ content: string }>("clipboard://sensitive-ask", (e) => {
            setPendingSensitive(e.payload.content);
          }),
        );
        unsubs.push(
          await listen("clipboard://monitor-error", () => setMonitorError(true)),
        );
        unsubs.push(
          await listen<AppSettings>("settings://changed", (e) => {
            setSettings({ ...DEFAULT_SETTINGS, ...e.payload });
          }),
        );
      } catch {
        /* ignore */
      }
    })();
    return () => {
      unsubs.forEach((u) => u());
    };
  }, []);

  // Browser dev fallback: outside Tauri there is no system monitor.
  // (No fake history: list stays empty until the real backend runs.)
  useEffect(() => {
    if (isTauriEnv()) return;
    const onCopy = () => {};
    window.addEventListener("copy", onCopy);
    return () => window.removeEventListener("copy", onCopy);
  }, []);

  const updateSettings = useCallback(
    async (patch: Partial<AppSettings>) => {
      const next = { ...settingsRef.current, ...patch };
      setSettings(next);
      await saveSettings(next);
    },
    [],
  );

  const doCopy = useCallback(async (item: ClipboardItem) => {
    await copyText(item.content);
    setLastCopiedId(item.id);
    setTimeout(() => setLastCopiedId(null), 1200);
  }, []);

  const doPin = useCallback(
    async (id: string) => {
      await togglePinCmd(id);
      if (isTauriEnv()) {
        const it = await loadItems();
        setItems(it.sort((a, b) => b.last_copied_at - a.last_copied_at));
      } else {
        setItems((prev) =>
          prev.map((i) => (i.id === id ? { ...i, is_pinned: !i.is_pinned } : i)),
        );
      }
    },
    [],
  );

  const doDelete = useCallback(async (id: string) => {
    await deleteItemCmd(id);
    setItems((prev) => prev.filter((i) => i.id !== id));
  }, []);

  const doClear = useCallback(async () => {
    await clearHistoryCmd();
    if (isTauriEnv()) {
      const it = await loadItems();
      setItems(it);
    } else {
      setItems((prev) => prev.filter((i) => i.is_pinned));
    }
  }, []);

  const doDeleteAll = useCallback(async () => {
    await deleteAllCmd();
    setItems([]);
    const next = { ...DEFAULT_SETTINGS, onboardingDone: true, lang: settingsRef.current.lang };
    setSettings(next);
    await saveSettings(next);
  }, []);

  const setPaused = useCallback(
    async (p: boolean) => {
      await setPausedCmd(p);
      await updateSettings({ monitoringPaused: p });
    },
    [updateSettings],
  );

  const savePendingOnce = useCallback(async () => {
    const content = pendingSensitive;
    if (!content) return;
    setPendingSensitive(null);
    try {
      await forceSaveText(content);
      const it = await loadItems();
      setItems(it.sort((a, b) => b.last_copied_at - a.last_copied_at));
    } catch {
      /* ignore */
    }
  }, [pendingSensitive]);

  const dismissPending = useCallback(() => setPendingSensitive(null), []);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return items.filter((i) => {
      if (!matchesType(i.content_type, typeFilter)) return false;
      if (!matchesDate(i.last_copied_at, dateFilter)) return false;
      if (!q) return true;
      if (i.content.toLowerCase().includes(q)) return true;
      if (i.content_type.toLowerCase().includes(q)) return true;
      if (new Date(i.last_copied_at).toLocaleString().toLowerCase().includes(q))
        return true;
      return false;
    });
  }, [items, search, typeFilter, dateFilter]);

  const pinned = useMemo(
    () => filtered.filter((i) => i.is_pinned),
    [filtered],
  );
  const unpinnedFiltered = useMemo(
    () => filtered.filter((i) => !i.is_pinned),
    [filtered],
  );

  const value: Store = {
    items,
    settings,
    strings: STRINGS[settings.lang],
    lang: settings.lang,
    search,
    setSearch,
    typeFilter,
    setTypeFilter,
    dateFilter,
    setDateFilter,
    filtered,
    pinned,
    unpinnedFiltered,
    monitoringPaused: !!settings.monitoringPaused,
    monitorError,
    blockedNotice,
    setBlockedNotice,
    pendingSensitive,
    savePendingOnce,
    dismissPending,
    refresh,
    updateSettings,
    doCopy,
    doPin,
    doDelete,
    doClear,
    doDeleteAll,
    setPaused,
    lastCopiedId,
  };

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useStore(): Store {
  const s = useContext(Ctx);
  if (!s) throw new Error("Store not ready");
  return s;
}
