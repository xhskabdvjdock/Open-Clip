import { useEffect, useMemo, useRef, useState } from "react";
import { CornerDownLeft, Search } from "lucide-react";
import { useStore } from "../lib/store";

export default function CommandMenu({ onClose }: { onClose: () => void }) {
  const {
    strings: t,
    setSearch,
    doClear,
    setPaused,
    monitoringPaused,
  } = useStore();
  const [q, setQ] = useState("");
  const [idx, setIdx] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  const commands = useMemo(
    () => [
      { id: "search", label: t.cmdSearch, run: () => setSearch(q) },
      {
        id: "clear",
        label: t.cmdClear,
        run: () => void doClear(),
      },
      {
        id: "pause",
        label: monitoringPaused ? t.cmdResume : t.cmdPause,
        run: () => void setPaused(!monitoringPaused),
      },
      { id: "settings", label: t.cmdSettings, run: () => window.dispatchEvent(new CustomEvent("openclip:settings")) },
      { id: "picker", label: t.cmdPicker, run: () => window.dispatchEvent(new CustomEvent("openclip:picker")) },
    ],
    [t, q, doClear, setPaused, monitoringPaused, setSearch],
  );

  const list = commands.filter((c) => c.label.toLowerCase().includes(q.toLowerCase()));

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      else if (e.key === "ArrowDown") {
        e.preventDefault();
        setIdx((i) => Math.min(list.length - 1, i + 1));
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setIdx((i) => Math.max(0, i - 1));
      } else if (e.key === "Enter") {
        list[idx]?.run();
        onClose();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/30 p-4 pt-[12vh]" onClick={onClose}>
      <div
        className="modal-panel animate-fadeIn w-full max-w-md overflow-hidden rounded-xl border border-neutral-200 bg-white shadow-xl dark:border-neutral-700 dark:bg-neutral-800"
        role="dialog"
        aria-modal="true"
        aria-label={t.commandTitle}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-2 border-b border-neutral-200 px-3.5 py-2.5 dark:border-neutral-700">
          <Search className="h-4 w-4 text-neutral-400" />
          <input
            ref={inputRef}
            value={q}
            onChange={(e) => {
              setQ(e.target.value);
              setIdx(0);
            }}
            placeholder={t.commandTitle}
            className="w-full bg-transparent text-[14px] outline-none placeholder:text-neutral-400"
            aria-label={t.commandTitle}
          />
        </div>
        <ul className="max-h-64 overflow-y-auto p-1.5" role="listbox">
          {list.map((c, i) => (
            <li key={c.id}>
              <button
                role="option"
                aria-selected={i === idx}
                onMouseEnter={() => setIdx(i)}
                onClick={() => {
                  c.run();
                  onClose();
                }}
                className={`flex w-full items-center justify-between rounded-lg px-3 py-2 text-[13.5px] ${
                  i === idx
                    ? "picker-selected"
                    : "text-neutral-700 dark:text-neutral-200"
                }`}
              >
                {c.label}
                {i === idx && <CornerDownLeft className="h-3.5 w-3.5 text-neutral-400" />}
              </button>
            </li>
          ))}
          {list.length === 0 && (
            <li className="px-3 py-4 text-center text-[13px] text-neutral-500">{t.noResults}</li>
          )}
        </ul>
      </div>
    </div>
  );
}
