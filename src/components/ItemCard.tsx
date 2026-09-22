import {
  Check,
  Code2,
  Copy,
  Hash,
  Image as ImageIcon,
  Link2,
  Mail,
  Pin,
  Trash2,
} from "lucide-react";
import type { ClipboardItem, ContentType } from "../types";
import { fullDate, preview, timeAgo, timeOnly } from "../lib/format";
import { useImagePreview } from "../lib/useImagePreview";
import { PREVIEW_LENGTH_MAP, useAppearance } from "../lib/appearance";
import { useStore } from "../lib/store";

export function TypeIcon({ type, className = "h-3.5 w-3.5" }: { type: ContentType; className?: string }) {
  switch (type) {
    case "url":
      return <Link2 className={className} aria-hidden />;
    case "code":
      return <Code2 className={className} aria-hidden />;
    case "email":
      return <Mail className={className} aria-hidden />;
    case "number":
      return <Hash className={className} aria-hidden />;
    case "image":
      return <ImageIcon className={className} aria-hidden />;
    default:
      return null;
  }
}

export function typeLabel(type: ContentType, t: Record<string, string>): string {
  switch (type) {
    case "url":
      return t.typeLinks;
    case "code":
      return t.typeCode;
    case "email":
      return "Email";
    case "number":
      return "Number";
    case "image":
      return t.typeImages;
    default:
      return t.typeText;
  }
}

export default function ItemCard({
  item,
  onOpenDetails,
  compact = false,
}: {
  item: ClipboardItem;
  onOpenDetails: (item: ClipboardItem) => void;
  compact?: boolean;
}) {
  const { strings: t, lang, doCopy, doPin, doDelete, lastCopiedId } = useStore();
  const { appearance } = useAppearance();
  const copied = lastCopiedId === item.id;
  const thumb = useImagePreview(item, 112);
  const maxPreview = PREVIEW_LENGTH_MAP[appearance.previewLength];

  const timeText =
    appearance.timestampStyle === "absolute"
      ? timeOnly(item.last_copied_at, lang)
      : appearance.timestampStyle === "full"
        ? fullDate(item.last_copied_at, lang)
        : timeAgo(item.last_copied_at, lang);
  const words = item.word_count ?? 0;
  const showMeta =
    appearance.showType ||
    appearance.showTime ||
    (appearance.showWords && words > 0) ||
    item.is_pinned;

  return (
    <div
      className="clip-card group relative rounded-lg border border-neutral-200 bg-white px-3 py-2.5 hover:border-neutral-300 hover:shadow-sm dark:border-neutral-700 dark:bg-neutral-800 dark:hover:border-neutral-600"
      role="listitem"
    >
      <button
        className="block w-full text-start"
        onClick={() => onOpenDetails(item)}
        aria-label={`${typeLabel(item.content_type, t)}: ${preview(item.content, 80)}`}
      >
        {item.content_type === "code" ? (
          <code className="codeblock item-preview whitespace-pre-wrap text-neutral-800 dark:text-neutral-100">
            {preview(item.content, maxPreview)}
          </code>
        ) : item.content_type === "image" ? (
          <span className="flex items-center gap-2.5">
            {thumb ? (
              <img
                src={thumb}
                alt="clipboard"
                className="h-11 w-11 shrink-0 rounded-md border border-neutral-200 object-cover dark:border-neutral-700"
              />
            ) : (
              <span
                aria-hidden
                className="flex h-11 w-11 shrink-0 items-center justify-center rounded-md border border-neutral-200 bg-neutral-100 text-neutral-400 dark:border-neutral-700 dark:bg-neutral-900"
              >
                <ImageIcon className="h-5 w-5" />
              </span>
            )}
            <span className="item-preview text-neutral-800 dark:text-neutral-100">
              {preview(item.content || "Image", maxPreview)}
            </span>
          </span>
        ) : (
          <span className="item-preview text-[13.5px] leading-5 text-neutral-800 dark:text-neutral-100">
            {preview(item.content, compact ? 120 : maxPreview)}
          </span>
        )}
        {showMeta && (
          <span className="mt-1.5 flex items-center gap-1.5 text-xs text-neutral-500 dark:text-neutral-400">
            {appearance.showType && (
              <>
                <TypeIcon type={item.content_type} />
                <span className="capitalize">{typeLabel(item.content_type, t)}</span>
              </>
            )}
            {appearance.showType && appearance.showTime && <span aria-hidden>·</span>}
            {appearance.showTime && (
              <time dateTime={new Date(item.last_copied_at).toISOString()}>{timeText}</time>
            )}
            {(appearance.showType || appearance.showTime) && appearance.showWords && words > 0 && (
              <span aria-hidden>·</span>
            )}
            {appearance.showWords && words > 0 && (
              <span>
                {words} {t.wordsShort}
              </span>
            )}
            {item.is_pinned && (
              <Pin className="h-3 w-3 text-neutral-400" aria-label={t.pin} />
            )}
          </span>
        )}
      </button>

      {/* Hover actions */}
      <div className="absolute end-2 top-2 hidden gap-1 group-hover:flex group-focus-within:flex">
        <IconBtn
          title={copied ? t.copied : t.copy}
          label={t.copy}
          onClick={() => void doCopy(item)}
        >
          {copied ? <Check className="h-4 w-4 text-green-600" /> : <Copy className="h-4 w-4" />}
        </IconBtn>
        <IconBtn
          title={item.is_pinned ? t.unpin : t.pin}
          label={item.is_pinned ? t.unpin : t.pin}
          onClick={() => void doPin(item.id)}
          active={item.is_pinned}
        >
          <Pin className="h-4 w-4" />
        </IconBtn>
        <IconBtn title={t.delete} label={t.delete} onClick={() => void doDelete(item.id)}>
          <Trash2 className="h-4 w-4" />
        </IconBtn>
      </div>
    </div>
  );
}

export function IconBtn({
  children,
  title,
  label,
  onClick,
  active = false,
}: {
  children: React.ReactNode;
  title: string;
  label: string;
  onClick: () => void;
  active?: boolean;
}) {
  return (
    <button
      type="button"
      title={title}
      aria-label={label}
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
      className={`rounded-md border p-1.5 shadow-sm transition-colors ${
        active
          ? "border-neutral-400 bg-neutral-800 text-white dark:border-neutral-500 dark:bg-neutral-100 dark:text-neutral-900"
          : "border-neutral-200 bg-white text-neutral-600 hover:bg-neutral-100 dark:border-neutral-600 dark:bg-neutral-900 dark:text-neutral-300 dark:hover:bg-neutral-700"
      }`}
    >
      {children}
    </button>
  );
}
