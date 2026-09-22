import { useEffect } from "react";
import { AlertTriangle, Copy, ExternalLink, Pin, Trash2, X } from "lucide-react";
import { openUrl } from "@tauri-apps/plugin-opener";
import type { ClipboardItem } from "../types";
import { useStore } from "../lib/store";
import { counts, fullDate, preview } from "../lib/format";
import { useImagePreview } from "../lib/useImagePreview";
import { isTauriEnv } from "../lib/store-api";
import { typeLabel } from "./ItemCard";

export function ConfirmModal({
  title,
  body,
  confirmLabel,
  danger = false,
  onCancel,
  onConfirm,
}: {
  title: string;
  body: string;
  confirmLabel: string;
  danger?: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const { strings: t } = useStore();
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onCancel();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onCancel]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4"
      role="dialog"
      aria-modal="true"
      aria-label={title}
      onClick={onCancel}
    >
      <div
        className="modal-panel animate-fadeIn w-full max-w-sm rounded-xl border border-neutral-200 bg-white p-5 shadow-lg dark:border-neutral-700 dark:bg-neutral-800"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="text-[15px] font-semibold text-neutral-900 dark:text-neutral-50">
          {title}
        </h2>
        <p className="mt-1.5 text-[13px] leading-5 text-neutral-600 dark:text-neutral-300">
          {body}
        </p>
        <div className="mt-4 flex justify-end gap-2">
          <button
            onClick={onCancel}
            className="rounded-lg border border-neutral-300 px-3.5 py-1.5 text-[13px] font-medium text-neutral-700 hover:bg-neutral-100 dark:border-neutral-600 dark:text-neutral-200 dark:hover:bg-neutral-700"
          >
            {t.cancel}
          </button>
          <button
            onClick={onConfirm}
            autoFocus
            className={`rounded-lg px-3.5 py-1.5 text-[13px] font-medium text-white ${
              danger ? "bg-red-600 hover:bg-red-700" : "btn-primary"
            }`}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

export function DetailsModal({
  item,
  onClose,
}: {
  item: ClipboardItem;
  onClose: () => void;
}) {
  const { strings: t, lang, doCopy, doPin, doDelete } = useStore();
  const c = counts(item.content);
  const fullPreview = useImagePreview(item, 768);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const isUrl = item.content_type === "url";

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4"
      role="dialog"
      aria-modal="true"
      aria-label={t.details}
      onClick={onClose}
    >
      <div
        className="modal-panel animate-fadeIn flex max-h-[85vh] w-full max-w-lg flex-col rounded-xl border border-neutral-200 bg-white shadow-xl dark:border-neutral-700 dark:bg-neutral-800"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-neutral-200 px-4 py-3 dark:border-neutral-700">
          <span className="text-[13px] font-medium text-neutral-500 dark:text-neutral-400">
            {typeLabel(item.content_type, t)} · {fullDate(item.created_at, lang)}
          </span>
          <button
            onClick={onClose}
            aria-label={t.close}
            title={t.close}
            className="rounded-md p-1.5 text-neutral-500 hover:bg-neutral-100 dark:text-neutral-300 dark:hover:bg-neutral-700"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="textscale overflow-y-auto px-4 py-3">
          {item.content_type === "code" ? (
            <pre className="overflow-x-auto rounded-lg border border-neutral-200 bg-neutral-50 p-3 dark:border-neutral-700 dark:bg-neutral-900">
              <code className="codeblock whitespace-pre-wrap break-words text-neutral-800 dark:text-neutral-100">
                {item.content}
              </code>
            </pre>
          ) : item.content_type === "image" ? (
            fullPreview ? (
              <img
                src={fullPreview}
                alt="clipboard preview"
                className="max-h-64 rounded-lg border border-neutral-200 object-contain dark:border-neutral-700"
              />
            ) : (
              <span className="flex h-32 items-center justify-center rounded-lg border border-neutral-200 bg-neutral-100 text-[13px] text-neutral-400 dark:border-neutral-700 dark:bg-neutral-900">
                {preview(item.content || "Image", 60)}
              </span>
            )
          ) : (
            <p className="whitespace-pre-wrap break-words text-[14px] leading-6 text-neutral-900 dark:text-neutral-50">
              {item.content}
            </p>
          )}

          <dl className="mt-4 grid grid-cols-2 gap-x-4 gap-y-2 text-[12.5px]">
            <Detail label={t.created} value={fullDate(item.created_at, lang)} />
            <Detail label={t.lastCopied} value={fullDate(item.last_copied_at, lang)} />
            <Detail label={t.chars} value={String(item.char_count ?? c.chars)} />
            <Detail label={t.words} value={String(item.word_count ?? c.words)} />
          </dl>

          {item.is_sensitive && (
            <p className="mt-3 flex items-start gap-2 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-[12.5px] text-amber-800 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-200">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
              {t.sensitiveBlocked}
            </p>
          )}
        </div>

        <div className="flex items-center gap-2 border-t border-neutral-200 px-4 py-3 dark:border-neutral-700">
          <button
            onClick={() => void doCopy(item)}
            className="btn-primary flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[13px] font-medium"
          >
            <Copy className="h-3.5 w-3.5" /> {t.copy}
          </button>
          {isUrl && (
            <button
              onClick={() => {
                const url = item.content.trim();
                if (isTauriEnv()) {
                  void openUrl(url).catch(() => window.open(url, "_blank", "noopener"));
                } else {
                  window.open(url, "_blank", "noopener");
                }
              }}
              className="flex items-center gap-1.5 rounded-lg border border-neutral-300 px-3 py-1.5 text-[13px] font-medium text-neutral-700 hover:bg-neutral-100 dark:border-neutral-600 dark:text-neutral-200 dark:hover:bg-neutral-700"
            >
              <ExternalLink className="h-3.5 w-3.5" /> {t.openLink}
            </button>
          )}
          <button
            onClick={() => void doPin(item.id)}
            className="flex items-center gap-1.5 rounded-lg border border-neutral-300 px-3 py-1.5 text-[13px] font-medium text-neutral-700 hover:bg-neutral-100 dark:border-neutral-600 dark:text-neutral-200 dark:hover:bg-neutral-700"
          >
            <Pin className="h-3.5 w-3.5" /> {item.is_pinned ? t.unpin : t.pin}
          </button>
          <span className="flex-1" />
          <button
            onClick={() => {
              void doDelete(item.id);
              onClose();
            }}
            aria-label={t.delete}
            title={t.delete}
            className="rounded-lg p-2 text-neutral-500 hover:bg-red-50 hover:text-red-600 dark:text-neutral-400 dark:hover:bg-red-950"
          >
            <Trash2 className="h-4 w-4" />
          </button>
        </div>
      </div>
    </div>
  );
}

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-neutral-500 dark:text-neutral-400">{label}</dt>
      <dd className="mt-0.5 font-medium text-neutral-800 dark:text-neutral-100">{value}</dd>
    </div>
  );
}

export function Banner({
  kind,
  children,
  onClose,
}: {
  kind: "warn" | "error";
  children: React.ReactNode;
  onClose?: () => void;
}) {
  return (
    <div
      role="alert"
      className={`flex items-start gap-2 rounded-lg border px-3 py-2 text-[13px] ${
        kind === "error"
          ? "border-red-300 bg-red-50 text-red-800 dark:border-red-800 dark:bg-red-950 dark:text-red-200"
          : "border-amber-300 bg-amber-50 text-amber-800 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-200"
      }`}
    >
      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
      <span className="flex-1">{children}</span>
      {onClose && (
        <button onClick={onClose} aria-label="dismiss" className="rounded p-0.5 hover:bg-black/5">
          <X className="h-3.5 w-3.5" />
        </button>
      )}
    </div>
  );
}
