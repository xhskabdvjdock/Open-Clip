import { useEffect, useMemo, useRef, useState } from "react";
import { Search } from "lucide-react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import type { ClipboardItem } from "./types";
import { useStore } from "./lib/store";
import { copyText, hidePickerWindow, isTauriEnv } from "./lib/store-api";
import { preview, timeAgo } from "./lib/format";
import { TypeIcon, typeLabel } from "./components/ItemCard";

/**
 * Quick Picker window: small popup, keyboard-first.
 * Up / Down / Enter / Esc / Ctrl+F focusing.
 */
export default function Picker() {
  const { strings: t, lang, items } = useStore();
  const [q, setQ] = useState("");
  const [idx, setIdx] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);

  const list = useMemo(() => {
    const query = q.trim().toLowerCase();
    const sorted = [...items].sort((a, b) => b.last_copied_at - a.last_copied_at);
    if (!query) return sorted.slice(0, 50);
    return sorted
      .filter(
        (i) =>
          i.content.toLowerCase().includes(query) ||
          i.content_type.toLowerCase().includes(query),
      )
      .slice(0, 50);
  }, [items, q]);

  useEffect(() => {
    setIdx(0);
  }, [q]);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  // Fresh state on every open (the webview is hidden, not destroyed).
  // When the picker regains focus, clear the search and focus the input.
  useEffect(() => {
    if (!isTauriEnv()) return;
    let unlisten: (() => void) | undefined;
    (async () => {
      try {
        unlisten = await getCurrentWindow().onFocusChanged(({ payload: focused }) => {
          if (focused) {
            setQ("");
            setIdx(0);
            // wait a tick so the window is fully visible before focusing
            setTimeout(() => inputRef.current?.focus(), 30);
          }
        });
      } catch {
        /* ignore */
      }
    })();
    return () => unlisten?.();
  }, []);

  useEffect(() => {
    listRef.current
      ?.querySelector(`[data-idx="${idx}"]`)
      ?.scrollIntoView({ block: "nearest" });
  }, [idx]);

  async function choose(item: ClipboardItem) {
    try {
      await copyText(item.content);
    } catch {
      /* ignore */
    }
    await hidePickerWindow();
  }

  function onKey(e: React.KeyboardEvent) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setIdx((i) => Math.min(list.length - 1, i + 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setIdx((i) => Math.max(0, i - 1));
    } else if (e.key === "Enter") {
      e.preventDefault();
      const it = list[idx];
      if (it) void choose(it);
    } else if (e.key === "Escape") {
      e.preventDefault();
      void hidePickerWindow();
    }
  }

  // global Esc when input not focused
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") void hidePickerWindow();
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "f") {
        e.preventDefault();
        inputRef.current?.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <div className="flex h-screen flex-col overflow-hidden rounded-xl border border-neutral-300 bg-white shadow-2xl dark:border-neutral-600 dark:bg-neutral-900">
      <div className="flex items-center gap-2 border-b border-neutral-200 px-3.5 py-2.5 dark:border-neutral-700">
        <Search className="h-4 w-4 shrink-0 text-neutral-400" />
        <input
          ref={inputRef}
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={onKey}
          placeholder={t.searchPicker}
          aria-label={t.searchPicker}
          className="w-full bg-transparent text-[14px] outline-none placeholder:text-neutral-400"
        />
        <kbd dir="ltr" className="rounded border border-neutral-300 px-1.5 py-0.5 font-mono text-[10.5px] text-neutral-400 dark:border-neutral-600">
          esc
        </kbd>
      </div>

      <ul ref={listRef} className="flex-1 overflow-y-auto p-1.5" role="listbox" aria-label={t.quickPaste}>
        {list.map((item, i) => (
          <li key={item.id}>
            <button
              data-idx={i}
              role="option"
              aria-selected={i === idx}
              onMouseEnter={() => setIdx(i)}
              onClick={() => void choose(item)}
              onKeyDown={onKey}
              className={`block w-full rounded-lg px-3 py-2 text-start ${
                i === idx ? "bg-neutral-100 dark:bg-neutral-700" : ""
              }`}
            >
              <span className="item-preview text-[13.5px] leading-5 text-neutral-800 dark:text-neutral-100">
                {preview(item.content, 140)}
              </span>
              <span className="mt-1 flex items-center gap-1.5 text-[11.5px] text-neutral-500 dark:text-neutral-400">
                <TypeIcon type={item.content_type} className="h-3 w-3" />
                <span className="capitalize">{typeLabel(item.content_type, t)}</span>
                <span aria-hidden>·</span>
                <span>{timeAgo(item.last_copied_at, lang)}</span>
              </span>
            </button>
          </li>
        ))}
        {list.length === 0 && (
          <li className="px-3 py-8 text-center text-[13px] text-neutral-500">{t.noResults}</li>
        )}
      </ul>

      <div className="flex items-center gap-3 border-t border-neutral-200 px-3.5 py-1.5 text-[11px] text-neutral-400 dark:border-neutral-700 dark:text-neutral-500">
        <span>
          <Kbd>↑↓</Kbd> navigate
        </span>
        <span>
          <Kbd>↵</Kbd> select
        </span>
        <span>
          <Kbd>esc</Kbd> close
        </span>
      </div>
    </div>
  );
}

function Kbd({ children }: { children: React.ReactNode }) {
  return (
    <kbd dir="ltr" className="rounded border border-neutral-300 px-1 font-mono dark:border-neutral-600">
      {children}
    </kbd>
  );
}
