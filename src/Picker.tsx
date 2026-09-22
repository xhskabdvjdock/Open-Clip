import { useEffect, useMemo, useRef, useState } from "react";
import { Pin, Search } from "lucide-react";
import { invoke } from "@tauri-apps/api/core";
import { currentMonitor, getCurrentWindow } from "@tauri-apps/api/window";
import { LogicalSize, PhysicalPosition } from "@tauri-apps/api/dpi";
import type { ClipboardItem } from "./types";
import { useStore } from "./lib/store";
import { copyText, hidePickerWindow, isTauriEnv } from "./lib/store-api";
import { preview, timeAgo } from "./lib/format";
import { useImagePreview } from "./lib/useImagePreview";
import { PICKER_SIZE_MAP, useAppearance } from "./lib/appearance";
import type { PickerPosition, PickerSize } from "./lib/appearance";
import { TypeIcon, typeLabel } from "./components/ItemCard";

/** Apply picker window size + position. Center/top work everywhere;
 *  near-cursor uses real cursor coordinates on Windows, else centers. */
export async function applyPickerGeometry(size: PickerSize, position: PickerPosition) {
  if (!isTauriEnv()) return;
  try {
    const win = getCurrentWindow();
    const { w, h } = PICKER_SIZE_MAP[size];
    await win.setSize(new LogicalSize(w, h));
    if (position === "center") {
      await win.center();
      return;
    }
    const monitor = await currentMonitor();
    if (!monitor) {
      await win.center();
      return;
    }
    const scale = await win.scaleFactor();
    const winW = Math.round(w * scale);
    const winH = Math.round(h * scale);
    const mx = monitor.position.x;
    const my = monitor.position.y;
    const mw = monitor.size.width;
    const mh = monitor.size.height;
    if (position === "top") {
      await win.setPosition(
        new PhysicalPosition(Math.round(mx + (mw - winW) / 2), Math.round(my + 100 * scale)),
      );
      return;
    }
    // Near cursor (Windows): real cursor position via backend.
    try {
      const [cx, cy] = await invoke<[number, number]>("get_cursor_position");
      const x = Math.min(Math.max(Math.round(cx - winW / 2), mx), mx + mw - winW);
      const y = Math.min(Math.max(Math.round(cy + 20), my), my + mh - winH);
      await win.setPosition(new PhysicalPosition(x, y));
    } catch {
      await win.center();
    }
  } catch {
    /* ignore — window keeps its default geometry */
  }
}

/**
 * Quick Picker window: small popup, keyboard-first.
 * Up / Down / Enter / Esc / Ctrl+F focusing.
 */
export default function Picker() {
  const { strings: t, lang, items, settings } = useStore();
  const { appearance } = useAppearance();
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
  // When the picker regains focus: reset search, focus input, apply geometry
  // (so "near cursor" follows the mouse and size changes take effect).
  useEffect(() => {
    if (!isTauriEnv()) return;
    let unlisten: (() => void) | undefined;
    (async () => {
      try {
        unlisten = await getCurrentWindow().onFocusChanged(({ payload: focused }) => {
          if (focused) {
            setQ("");
            setIdx(0);
            void applyPickerGeometry(appearance.pickerSize, appearance.pickerPosition);
            // wait a tick so the window is fully visible before focusing
            setTimeout(() => inputRef.current?.focus(), 30);
          }
        });
      } catch {
        /* ignore */
      }
    })();
    return () => unlisten?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Apply size/position on mount and whenever the settings change.
  useEffect(() => {
    void applyPickerGeometry(appearance.pickerSize, appearance.pickerPosition);
  }, [appearance.pickerSize, appearance.pickerPosition]);

  useEffect(() => {
    listRef.current
      ?.querySelector(`[data-idx="${idx}"]`)
      ?.scrollIntoView({ block: "nearest" });
  }, [idx]);

  async function choose(item: ClipboardItem) {
    try {
      if (isTauriEnv() && settings.pasteAutomatically) {
        // Real auto-paste: copy + hide + refocus previous app + Ctrl+V.
        await invoke("paste_item_by_id", { id: item.id });
      } else {
        await copyText(item.content);
        await hidePickerWindow();
      }
    } catch {
      try {
        await hidePickerWindow();
      } catch {
        /* ignore */
      }
    }
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
    <div className="picker-shell flex h-screen flex-col overflow-hidden rounded-xl border border-neutral-300 bg-white shadow-2xl dark:border-neutral-600 dark:bg-neutral-900">
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

      <ul ref={listRef} className="textscale flex-1 overflow-y-auto p-1.5" role="listbox" aria-label={t.quickPaste}>
        {list.map((item, i) => (
          <PickerRow
            key={item.id}
            item={item}
            index={i}
            selected={i === idx}
            onHover={() => setIdx(i)}
            onChoose={() => void choose(item)}
            onKey={onKey}
          />
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

export function PickerRow({
  item,
  index,
  selected,
  onHover,
  onChoose,
  onKey,
}: {
  item: ClipboardItem;
  index: number;
  selected: boolean;
  onHover: () => void;
  onChoose: () => void;
  onKey: (e: React.KeyboardEvent) => void;
}) {
  const { strings: t, lang } = useStore();
  const { appearance } = useAppearance();
  const thumb = useImagePreview(item, 64);
  const isImage = item.content_type === "image";
  const detailed = appearance.pickerStyle === "detailed";
  const minimal = appearance.pickerStyle === "minimal";

  return (
    <li>
      <button
        data-idx={index}
        role="option"
        aria-selected={selected}
        onMouseEnter={onHover}
        onClick={onChoose}
        onKeyDown={onKey}
        className={`picker-row block w-full rounded-lg px-3 py-2 text-start ${
          selected ? "picker-selected" : ""
        }`}
      >
        <span className="flex items-center gap-2.5">
          {isImage &&
            (thumb ? (
              <img
                src={thumb}
                alt=""
                className="h-9 w-9 shrink-0 rounded-md border border-neutral-200 object-cover dark:border-neutral-600"
              />
            ) : (
              <span
                aria-hidden
                className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md border border-neutral-200 bg-neutral-100 text-neutral-400 dark:border-neutral-600 dark:bg-neutral-800"
              >
                <TypeIcon type="image" className="h-4 w-4" />
              </span>
            ))}
          <span className="min-w-0 flex-1">
            <span className="item-preview text-[13.5px] leading-5 text-neutral-800 dark:text-neutral-100">
              {preview(item.content, 140)}
            </span>
            {!minimal && (
              <span className="mt-1 flex items-center gap-1.5 text-[11.5px] text-neutral-500 dark:text-neutral-400">
                <TypeIcon type={item.content_type} className="h-3 w-3" />
                <span className="capitalize">{typeLabel(item.content_type, t)}</span>
                <span aria-hidden>·</span>
                <span>{timeAgo(item.last_copied_at, lang)}</span>
                {detailed && item.is_pinned && (
                  <>
                    <span aria-hidden>·</span>
                    <Pin className="h-3 w-3" aria-label={t.pin} />
                  </>
                )}
              </span>
            )}
          </span>
        </span>
      </button>
    </li>
  );
}

function Kbd({ children }: { children: React.ReactNode }) {
  return (
    <kbd dir="ltr" className="rounded border border-neutral-300 px-1 font-mono dark:border-neutral-600">
      {children}
    </kbd>
  );
}
