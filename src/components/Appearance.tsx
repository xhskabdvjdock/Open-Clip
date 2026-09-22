import { useRef, useState } from "react";
import { open, save } from "@tauri-apps/plugin-dialog";
import { readTextFile, writeTextFile } from "@tauri-apps/plugin-fs";
import {
  AlertTriangle,
  Check,
  Copy,
  Download,
  Pencil,
  Plus,
  RotateCcw,
  Trash2,
  Upload,
  X,
} from "lucide-react";
import type { ClipboardItem } from "../types";
import { useStore } from "../lib/store";
import { isTauriEnv } from "../lib/store-api";
import {
  ACCENT_PRESETS,
  THEME_PRESETS,
  autoForeground,
  buildThemeFile,
  contrastRatio,
  isValidHex,
  normalizeHex,
  useAppearance,
  validateThemeFile,
} from "../lib/appearance";
import type {
  BordersId,
  CardStyleId,
  ColorTokens,
  DensityId,
  FontId,
  HeaderStyle,
  PickerPosition,
  PickerSize,
  PickerStyle,
  PreviewLength,
  RadiusId,
  ShadowId,
  TextSize,
  TimestampStyle,
} from "../lib/appearance";
import ItemCard from "./ItemCard";
import { FilterChip } from "../App";
import { PickerRow } from "../Picker";
import { ConfirmModal } from "./Modals";

const SAMPLE_NOW = Date.now();
const SAMPLE_ITEMS: ClipboardItem[] = [
  {
    id: "preview-1",
    content: "npm install next",
    content_type: "code",
    created_at: SAMPLE_NOW - 120_000,
    last_copied_at: SAMPLE_NOW - 120_000,
    is_pinned: true,
    is_sensitive: false,
    content_hash: "preview1",
    char_count: 17,
    word_count: 3,
  },
  {
    id: "preview-2",
    content: "https://github.com/openclip",
    content_type: "url",
    created_at: SAMPLE_NOW - 300_000,
    last_copied_at: SAMPLE_NOW - 300_000,
    is_pinned: false,
    is_sensitive: false,
    content_hash: "preview2",
    char_count: 27,
    word_count: 1,
  },
  {
    id: "preview-3",
    content: "Hello, this is a test of the new theme system...",
    content_type: "text",
    created_at: SAMPLE_NOW - 480_000,
    last_copied_at: SAMPLE_NOW - 480_000,
    is_pinned: false,
    is_sensitive: false,
    content_hash: "preview3",
    char_count: 48,
    word_count: 9,
  },
];

export default function Appearance() {
  const { strings: t } = useStore();
  const { appearance, resetAll, importTheme } = useAppearance();
  const [showReset, setShowReset] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  async function handleExport() {
    setErr(null);
    try {
      const activeName =
        appearance.presetId === "custom"
          ? "custom-theme"
          : appearance.presetId.startsWith("my:")
            ? (appearance.myThemes.find((m) => `my:${m.id}` === appearance.presetId)?.name ?? "theme")
            : (THEME_PRESETS.find((p) => p.id === appearance.presetId)?.name ?? "theme");
      const file = buildThemeFile(activeName, appearance);
      const json = JSON.stringify(file, null, 2);
      if (isTauriEnv()) {
        const path = await save({
          defaultPath: `${activeName.toLowerCase().replace(/[^a-z0-9]+/g, "-")}.openclip-theme.json`,
          filters: [{ name: "Open Clip Theme", extensions: ["json"] }],
        });
        if (!path) return;
        await writeTextFile(path, json);
      } else {
        const a = document.createElement("a");
        a.href = URL.createObjectURL(new Blob([json], { type: "application/json" }));
        a.download = "open-clip-theme.json";
        a.click();
        setTimeout(() => URL.revokeObjectURL(a.href), 2000);
      }
    } catch {
      setErr(t.invalidTheme);
    }
  }

  async function handleImportText(text: string) {
    setErr(null);
    try {
      const parsed = JSON.parse(text);
      const res = validateThemeFile(parsed);
      if (!res.ok) {
        setErr(t.invalidTheme);
        return;
      }
      // Valid → store as My Theme and apply live (preview == applied).
      importTheme(res.file.name, res.file.appearance);
    } catch {
      setErr(t.invalidTheme);
    }
  }

  async function handleImportPick() {
    if (isTauriEnv()) {
      try {
        const path = await open({
          multiple: false,
          filters: [{ name: "Open Clip Theme", extensions: ["json"] }],
        });
        if (!path) return;
        const text = await readTextFile(path as string);
        await handleImportText(text);
      } catch {
        setErr(t.invalidTheme);
      }
    } else {
      fileRef.current?.click();
    }
  }

  return (
    <div className="flex flex-col gap-6 min-[720px]:grid min-[720px]:grid-cols-[minmax(0,1fr)_260px]">
      {/* Controls */}
      <div className="min-w-0 space-y-6">
        {err && (
          <div className="flex items-start gap-2 rounded-lg border border-red-300 bg-red-50 px-3 py-2 text-[13px] text-red-800 dark:border-red-800 dark:bg-red-950 dark:text-red-200">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
            <span className="flex-1">{err}</span>
            <button onClick={() => setErr(null)} aria-label={t.cancel} className="rounded p-0.5 hover:bg-black/5">
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        )}
        <ThemeSection />
        <AccentSection />
        {appearance.presetId === "custom" && <ColorsSection />}
        <InterfaceSection />
        <ClipboardSection />
        <PickerSection />
        <TypographySection />
        <MyThemesSection />
        <div className="flex flex-wrap gap-2">
          <button
            onClick={() => void handleExport()}
            className="flex items-center gap-1.5 rounded-lg border border-neutral-300 px-3 py-1.5 text-[13px] font-medium text-neutral-700 hover:bg-neutral-100 dark:border-neutral-600 dark:text-neutral-200 dark:hover:bg-neutral-700"
          >
            <Download className="h-3.5 w-3.5" /> {t.exportTheme}
          </button>
          <button
            onClick={() => void handleImportPick()}
            className="flex items-center gap-1.5 rounded-lg border border-neutral-300 px-3 py-1.5 text-[13px] font-medium text-neutral-700 hover:bg-neutral-100 dark:border-neutral-600 dark:text-neutral-200 dark:hover:bg-neutral-700"
          >
            <Upload className="h-3.5 w-3.5" /> {t.importTheme}
          </button>
          <span className="flex-1" />
          <button
            onClick={() => setShowReset(true)}
            className="flex items-center gap-1.5 rounded-lg border border-red-300 px-3 py-1.5 text-[13px] font-medium text-red-700 hover:bg-red-50 dark:border-red-800 dark:text-red-200 dark:hover:bg-red-950"
          >
            <RotateCcw className="h-3.5 w-3.5" /> {t.resetAppearance}
          </button>
        </div>
      </div>

      {/* Live preview */}
      <div className="min-w-0 min-[720px]:sticky min-[720px]:top-0 min-[720px]:self-start">
        <LivePreview />
      </div>

      {showReset && (
        <ConfirmModal
          title={t.resetAppearanceTitle}
          body={t.resetAppearanceBody}
          confirmLabel={t.resetAppearance}
          onCancel={() => setShowReset(false)}
          onConfirm={() => {
            resetAll();
            setShowReset(false);
          }}
        />
      )}
      <input
        ref={fileRef}
        type="file"
        accept=".json"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (!f) return;
          f.text().then((text) => void handleImportText(text));
          e.target.value = "";
        }}
      />
    </div>
  );
}

/* ================= Sections ================= */

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <h3 className="mb-2 text-[12.5px] font-semibold uppercase tracking-wide text-neutral-500 dark:text-neutral-400">
        {title}
      </h3>
      <div className="space-y-3">{children}</div>
    </section>
  );
}

function Seg<T extends string>({
  options,
  value,
  onChange,
}: {
  options: { v: T; l: string }[];
  value: T;
  onChange: (v: T) => void;
}) {
  return (
    <div role="radiogroup" className="flex flex-wrap gap-1">
      {options.map((o) => (
        <button
          key={o.v}
          role="radio"
          aria-checked={value === o.v}
          onClick={() => onChange(o.v)}
          className={`rounded-full border px-2.5 py-1 text-[12.5px] font-medium transition-colors ${
            value === o.v
              ? "seg-active border-transparent"
              : "border-neutral-300 bg-white text-neutral-600 hover:bg-neutral-100 dark:border-neutral-600 dark:bg-neutral-800 dark:text-neutral-300 dark:hover:bg-neutral-700"
          }`}
        >
          {o.l}
        </button>
      ))}
    </div>
  );
}

function SwitchRow({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <label className="flex cursor-pointer items-center justify-between gap-3">
      <span className="text-[13px] text-neutral-700 dark:text-neutral-200">{label}</span>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={label}
        onClick={() => onChange(!checked)}
        className={`relative h-5 w-9 shrink-0 rounded-full transition-colors ${
          checked ? "toggle-on" : "bg-neutral-300 dark:bg-neutral-600"
        }`}
      >
        <span
          className="absolute top-0.5 h-4 w-4 rounded-full bg-white shadow"
          style={
            document.documentElement.dir === "rtl"
              ? { right: checked ? "18px" : "2px", left: "auto" }
              : { left: checked ? "18px" : "2px" }
          }
        />
      </button>
    </label>
  );
}

/* ================= Theme presets ================= */

function ThemeSection() {
  const { strings: t } = useStore();
  const { appearance, update } = useAppearance();
  return (
    <Section title={t.themeSection}>
      <div className="grid grid-cols-3 gap-2">
        {THEME_PRESETS.map((p) => (
          <PresetCard
            key={p.id}
            name={p.name}
            scheme={p.schemes.light}
            active={appearance.presetId === p.id}
            onClick={() => update({ presetId: p.id })}
          />
        ))}
        <button
          onClick={() => update({ presetId: "custom" })}
          aria-pressed={appearance.presetId === "custom"}
          className={`rounded-lg border p-2 text-start transition-colors ${
            appearance.presetId === "custom"
              ? "border-neutral-500 dark:border-neutral-300"
              : "border-dashed border-neutral-300 hover:bg-neutral-100 dark:border-neutral-600 dark:hover:bg-neutral-800"
          }`}
        >
          <span className="flex h-[52px] items-center justify-center rounded-md bg-neutral-100 text-neutral-500 dark:bg-neutral-800 dark:text-neutral-400">
            <Plus className="h-5 w-5" />
          </span>
          <span className="mt-1 flex items-center justify-between text-[12px] font-medium text-neutral-700 dark:text-neutral-200">
            {t.customTheme}
            {appearance.presetId === "custom" && <Check className="h-3.5 w-3.5" />}
          </span>
        </button>
      </div>
    </Section>
  );
}

function PresetCard({
  name,
  scheme,
  active,
  onClick,
}: {
  name: string;
  scheme: ColorTokens;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      aria-pressed={active}
      className={`rounded-lg border p-2 text-start transition-colors ${
        active
          ? "border-neutral-500 dark:border-neutral-300"
          : "border-neutral-200 hover:bg-neutral-100 dark:border-neutral-700 dark:hover:bg-neutral-800"
      }`}
    >
      <span
        className="block rounded-md border p-1.5"
        style={{ background: scheme.surface, borderColor: scheme.border }}
      >
        <span className="flex gap-1">
          <span className="h-1.5 w-1.5 rounded-full" style={{ background: scheme.accent }} />
          <span className="h-1.5 w-1.5 rounded-full" style={{ background: scheme.success }} />
          <span className="h-1.5 w-1.5 rounded-full" style={{ background: scheme.danger }} />
        </span>
        <span
          className="mt-1.5 block h-1.5 w-3/4 rounded-full opacity-80"
          style={{ background: scheme.foreground }}
        />
        <span
          className="mt-1 block h-1.5 w-1/2 rounded-full opacity-60"
          style={{ background: scheme.muted }}
        />
      </span>
      <span className="mt-1 flex items-center justify-between text-[12px] font-medium text-neutral-700 dark:text-neutral-200">
        {name}
        {active && <Check className="h-3.5 w-3.5" />}
      </span>
    </button>
  );
}

/* ================= Accent ================= */

function AccentSection() {
  const { strings: t } = useStore();
  const { appearance, update } = useAppearance();
  const [hex, setHex] = useState("");

  const commitHex = (v: string) => {
    setHex(v);
    if (isValidHex(v)) update({ accent: normalizeHex(v) });
  };

  return (
    <Section title={t.accentLabel}>
      <div className="flex flex-wrap items-center gap-1.5" role="radiogroup" aria-label={t.accentLabel}>
        {ACCENT_PRESETS.map((c) => {
          const active = appearance.accent === c.hex;
          return (
            <button
              key={c.hex}
              role="radio"
              aria-checked={active}
              title={c.name}
              aria-label={c.name}
              onClick={() => update({ accent: c.hex })}
              className={`h-7 w-7 rounded-full transition-transform hover:scale-110 ${
                active ? "ring-2 ring-neutral-500 ring-offset-2 dark:ring-neutral-300 dark:ring-offset-neutral-800" : ""
              }`}
              style={{ background: c.hex }}
            />
          );
        })}
        <label
          title={t.customColor}
          className="relative h-7 w-7 cursor-pointer overflow-hidden rounded-full border border-dashed border-neutral-400"
        >
          <input
            type="color"
            className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
            value={appearance.accent ?? "#6366F1"}
            onChange={(e) => commitHex(e.target.value)}
            aria-label={t.customColor}
          />
          <Plus className="pointer-events-none absolute inset-0 m-auto h-4 w-4 text-neutral-400" />
        </label>
      </div>
      <div className="flex items-center gap-2">
        <input
          value={hex || appearance.accent || ""}
          onChange={(e) => commitHex(e.target.value)}
          onBlur={() => setHex("")}
          placeholder="#6366F1"
          spellCheck={false}
          dir="ltr"
          aria-label={t.customColor}
          className="w-28 rounded-lg border border-neutral-300 bg-white px-2.5 py-1.5 font-mono text-[12.5px] uppercase dark:border-neutral-600 dark:bg-neutral-900"
        />
        {appearance.accent && (
          <button
            onClick={() => update({ accent: null })}
            className="flex items-center gap-1 rounded-md px-2 py-1 text-[12px] font-medium text-neutral-500 hover:bg-neutral-200/60 dark:text-neutral-400 dark:hover:bg-neutral-800"
          >
            <X className="h-3.5 w-3.5" /> {t.resetColors}
          </button>
        )}
      </div>
      {appearance.recentColors.length > 0 && (
        <div className="flex items-center gap-1.5">
          <span className="text-[12px] text-neutral-500 dark:text-neutral-400">{t.recentColors}</span>
          {appearance.recentColors.map((c) => (
            <button
              key={c}
              title={c}
              aria-label={c}
              onClick={() => update({ accent: c })}
              className="h-5 w-5 rounded-full border border-neutral-300 dark:border-neutral-600"
              style={{ background: c }}
            />
          ))}
        </div>
      )}
    </Section>
  );
}

/* ================= Custom colors ================= */

const COLOR_FIELDS: { key: keyof ColorTokens; label: (t: ReturnType<typeof useStore>["strings"]) => string }[] = [
  { key: "background", label: (t) => t.cBackground },
  { key: "surface", label: (t) => t.cSurface },
  { key: "surfaceElevated", label: (t) => t.cElevated },
  { key: "foreground", label: (t) => t.cText },
  { key: "muted", label: (t) => t.cMuted },
  { key: "border", label: (t) => t.cBorder },
  { key: "accent", label: (t) => t.cAccent },
  { key: "danger", label: (t) => t.cDanger },
  { key: "success", label: (t) => t.cSuccess },
  { key: "warning", label: (t) => t.cWarning },
];

function ColorsSection() {
  const { strings: t } = useStore();
  const { appearance, update, resetColors } = useAppearance();
  const ratio = contrastRatio(appearance.customTokens.foreground, appearance.customTokens.background);

  return (
    <Section title={t.colorsSection}>
      <div className="grid grid-cols-1 gap-2">
        {COLOR_FIELDS.map((f) => (
          <ColorField
            key={f.key}
            label={f.label(t)}
            value={appearance.customTokens[f.key]}
            onChange={(hex) =>
              update({ customTokens: { ...appearance.customTokens, [f.key]: hex } })
            }
          />
        ))}
      </div>
      {ratio < 4.5 && (
        <div
          role="alert"
          className="flex items-start gap-2 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-[12.5px] text-amber-800 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-200"
        >
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>
            <strong>{t.lowContrast}</strong> ({ratio.toFixed(1)}:1). {t.lowContrastBody}
          </span>
        </div>
      )}
      <button
        onClick={resetColors}
        className="flex items-center gap-1.5 rounded-lg border border-neutral-300 px-3 py-1.5 text-[13px] font-medium text-neutral-700 hover:bg-neutral-100 dark:border-neutral-600 dark:text-neutral-200 dark:hover:bg-neutral-700"
      >
        <RotateCcw className="h-3.5 w-3.5" /> {t.resetColors}
      </button>
    </Section>
  );
}

function ColorField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (hex: string) => void;
}) {
  const [text, setText] = useState<string | null>(null);
  const shown = text ?? value;
  return (
    <label className="flex items-center justify-between gap-2">
      <span className="flex items-center gap-2 text-[13px] text-neutral-700 dark:text-neutral-200">
        <span
          className="relative block h-6 w-6 shrink-0 cursor-pointer overflow-hidden rounded-md border border-neutral-300 dark:border-neutral-600"
          style={{ background: isValidHex(shown) ? normalizeHex(shown) : "transparent" }}
        >
          <input
            type="color"
            className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
            value={value.slice(0, 7)}
            onChange={(e) => {
              setText(null);
              onChange(normalizeHex(e.target.value));
            }}
            aria-label={label}
          />
        </span>
        {label}
      </span>
      <span className="text-[11px] text-neutral-400" dir="ltr">
        {autoForeground(value) === "#FFFFFF" ? "●" : "○"}
      </span>
      <input
        value={shown}
        onChange={(e) => {
          setText(e.target.value);
          if (isValidHex(e.target.value)) onChange(normalizeHex(e.target.value));
        }}
        onBlur={() => setText(null)}
        spellCheck={false}
        dir="ltr"
        aria-label={label}
        className="w-24 rounded-lg border border-neutral-300 bg-white px-2 py-1 font-mono text-[12px] uppercase dark:border-neutral-600 dark:bg-neutral-900"
      />
    </label>
  );
}

/* ================= Interface / Clipboard / Picker / Type ================= */

function InterfaceSection() {
  const { strings: t } = useStore();
  const { appearance, update } = useAppearance();
  return (
    <Section title={t.interfaceSection}>
      <LabeledRow label={t.radiusLabel}>
        <Seg<RadiusId>
          value={appearance.radius}
          onChange={(v) => update({ radius: v })}
          options={[
            { v: "sharp", l: t.radiusSharp },
            { v: "small", l: t.radiusSmall },
            { v: "medium", l: t.radiusMedium },
            { v: "large", l: t.radiusLarge },
            { v: "round", l: t.radiusRound },
          ]}
        />
      </LabeledRow>
      <LabeledRow label={t.densityLabel}>
        <Seg<DensityId>
          value={appearance.density}
          onChange={(v) => update({ density: v })}
          options={[
            { v: "compact", l: t.densityCompact },
            { v: "comfortable", l: t.densityComfortable },
            { v: "spacious", l: t.densitySpacious },
          ]}
        />
      </LabeledRow>
      <LabeledRow label={t.cardStyleLabel}>
        <Seg<CardStyleId>
          value={appearance.cardStyle}
          onChange={(v) => update({ cardStyle: v })}
          options={[
            { v: "minimal", l: t.styleMinimal },
            { v: "cards", l: t.styleCards },
            { v: "list", l: t.styleList },
          ]}
        />
      </LabeledRow>
      <LabeledRow label={t.shadowLabel}>
        <Seg<ShadowId>
          value={appearance.shadow}
          onChange={(v) => update({ shadow: v })}
          options={[
            { v: "none", l: t.shadowNone },
            { v: "soft", l: t.shadowSoft },
            { v: "medium", l: t.shadowMedium },
            { v: "strong", l: t.shadowStrong },
          ]}
        />
      </LabeledRow>
      <LabeledRow label={t.bordersLabel}>
        <Seg<BordersId>
          value={appearance.borders}
          onChange={(v) => update({ borders: v })}
          options={[
            { v: "none", l: t.bordersNone },
            { v: "subtle", l: t.bordersSubtle },
            { v: "visible", l: t.bordersVisible },
          ]}
        />
      </LabeledRow>
    </Section>
  );
}

function LabeledRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <span className="text-[13px] font-medium text-neutral-800 dark:text-neutral-100">{label}</span>
      {children}
    </div>
  );
}

function ClipboardSection() {
  const { strings: t } = useStore();
  const { appearance, update } = useAppearance();
  return (
    <Section title={t.clipboardSection}>
      <SwitchRow label={t.showType} checked={appearance.showType} onChange={(v) => update({ showType: v })} />
      <SwitchRow label={t.showTime} checked={appearance.showTime} onChange={(v) => update({ showTime: v })} />
      <SwitchRow label={t.showWords} checked={appearance.showWords} onChange={(v) => update({ showWords: v })} />
      <LabeledRow label={t.timestampLabel}>
        <Seg<TimestampStyle>
          value={appearance.timestampStyle}
          onChange={(v) => update({ timestampStyle: v })}
          options={[
            { v: "relative", l: t.tsRelative },
            { v: "absolute", l: t.tsAbsolute },
            { v: "full", l: t.tsFull },
          ]}
        />
      </LabeledRow>
      <LabeledRow label={t.previewLengthLabel}>
        <Seg<PreviewLength>
          value={appearance.previewLength}
          onChange={(v) => update({ previewLength: v })}
          options={[
            { v: "short", l: t.lenShort },
            { v: "medium", l: t.lenMedium },
            { v: "long", l: t.lenLong },
          ]}
        />
      </LabeledRow>
    </Section>
  );
}

function PickerSection() {
  const { strings: t } = useStore();
  const { appearance, update } = useAppearance();
  return (
    <Section title={t.pickerSection}>
      <LabeledRow label={t.pickerSizeLabel}>
        <Seg<PickerSize>
          value={appearance.pickerSize}
          onChange={(v) => update({ pickerSize: v })}
          options={[
            { v: "small", l: t.sizeSmall },
            { v: "medium", l: t.sizeMedium },
            { v: "large", l: t.sizeLarge },
          ]}
        />
      </LabeledRow>
      <LabeledRow label={t.pickerPosLabel}>
        <Seg<PickerPosition>
          value={appearance.pickerPosition}
          onChange={(v) => update({ pickerPosition: v })}
          options={[
            { v: "center", l: t.posCenter },
            { v: "top", l: t.posTop },
            { v: "cursor", l: t.posCursor },
          ]}
        />
      </LabeledRow>
      <LabeledRow label={t.pickerStyleLabel}>
        <Seg<PickerStyle>
          value={appearance.pickerStyle}
          onChange={(v) => update({ pickerStyle: v })}
          options={[
            { v: "minimal", l: t.pickerMinimal },
            { v: "compact", l: t.pickerCompact },
            { v: "detailed", l: t.pickerDetailed },
          ]}
        />
      </LabeledRow>
    </Section>
  );
}

function TypographySection() {
  const { strings: t } = useStore();
  const { appearance, update } = useAppearance();
  return (
    <Section title={t.typographySection}>
      <LabeledRow label={t.textSizeLabel}>
        <Seg<TextSize>
          value={appearance.textSize}
          onChange={(v) => update({ textSize: v })}
          options={[
            { v: "small", l: t.sizeSmall },
            { v: "medium", l: t.sizeMedium },
            { v: "large", l: t.sizeLarge },
          ]}
        />
      </LabeledRow>
      <LabeledRow label={t.fontLabel}>
        <Seg<FontId>
          value={appearance.font}
          onChange={(v) => update({ font: v })}
          options={[
            { v: "system", l: t.fontSystem },
            { v: "plex", l: t.fontPlex },
          ]}
        />
      </LabeledRow>
      <LabeledRow label={t.headerLabel}>
        <Seg<HeaderStyle>
          value={appearance.headerStyle}
          onChange={(v) => update({ headerStyle: v })}
          options={[
            { v: "minimal", l: t.headerMinimal },
            { v: "standard", l: t.headerStandard },
            { v: "prominent", l: t.headerProminent },
          ]}
        />
      </LabeledRow>
    </Section>
  );
}

/* ================= My themes ================= */

function MyThemesSection() {
  const { strings: t } = useStore();
  const { appearance, saveAsTheme, renameTheme, deleteTheme, duplicateTheme, update } = useAppearance();
  const [name, setName] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState("");

  return (
    <Section title={t.myThemes}>
      <div className="flex gap-2">
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && name.trim()) {
              saveAsTheme(name);
              setName("");
            }
          }}
          placeholder={t.themeNamePh}
          aria-label={t.saveTheme}
          className="min-w-0 flex-1 rounded-lg border border-neutral-300 bg-white px-2.5 py-1.5 text-[13px] dark:border-neutral-600 dark:bg-neutral-900"
        />
        <button
          onClick={() => {
            if (!name.trim()) return;
            saveAsTheme(name);
            setName("");
          }}
          className="btn-primary flex shrink-0 items-center gap-1.5 rounded-lg px-3 py-1.5 text-[13px] font-medium"
        >
          <Plus className="h-3.5 w-3.5" /> {t.saveBtn}
        </button>
      </div>
      {appearance.myThemes.length === 0 ? null : (
        <ul className="space-y-1.5">
          {appearance.myThemes.map((m) => {
            const active = appearance.presetId === `my:${m.id}`;
            const editing = editingId === m.id;
            return (
              <li
                key={m.id}
                className={`flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 ${
                  active
                    ? "border-neutral-400 dark:border-neutral-500"
                    : "border-neutral-200 dark:border-neutral-700"
                }`}
              >
                <span
                  className="flex shrink-0 gap-0.5"
                  aria-hidden
                  style={{ direction: "ltr" }}
                >
                  {[m.snapshot.colors.accent, m.snapshot.colors.success, m.snapshot.colors.danger].map(
                    (c, i) => (
                      <span key={i} className="h-3 w-3 rounded-full border border-black/10" style={{ background: c }} />
                    ),
                  )}
                </span>
                {editing ? (
                  <input
                    value={editingName}
                    autoFocus
                    onChange={(e) => setEditingName(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        renameTheme(m.id, editingName);
                        setEditingId(null);
                      } else if (e.key === "Escape") {
                        setEditingId(null);
                      }
                    }}
                    className="min-w-0 flex-1 rounded-md border border-neutral-300 bg-white px-2 py-0.5 text-[13px] dark:border-neutral-600 dark:bg-neutral-900"
                  />
                ) : (
                  <button
                    onClick={() => update({ presetId: `my:${m.id}` })}
                    title={t.applyBtn}
                    className="min-w-0 flex-1 truncate text-start text-[13px] font-medium text-neutral-800 dark:text-neutral-100"
                  >
                    {m.name}
                    {active && <Check className="ms-1 inline h-3.5 w-3.5" />}
                  </button>
                )}
                {editing ? (
                  <button
                    title={t.saveBtn}
                    aria-label={t.saveBtn}
                    onClick={() => {
                      renameTheme(m.id, editingName);
                      setEditingId(null);
                    }}
                    className="rounded-md p-1.5 text-neutral-500 hover:bg-neutral-200/60 dark:text-neutral-300 dark:hover:bg-neutral-700"
                  >
                    <Check className="h-4 w-4" />
                  </button>
                ) : (
                  <button
                    title={t.renameBtn}
                    aria-label={t.renameBtn}
                    onClick={() => {
                      setEditingId(m.id);
                      setEditingName(m.name);
                    }}
                    className="rounded-md p-1.5 text-neutral-500 hover:bg-neutral-200/60 dark:text-neutral-300 dark:hover:bg-neutral-700"
                  >
                    <Pencil className="h-4 w-4" />
                  </button>
                )}
                <button
                  title={t.duplicateBtn}
                  aria-label={t.duplicateBtn}
                  onClick={() => duplicateTheme(m.id)}
                  className="rounded-md p-1.5 text-neutral-500 hover:bg-neutral-200/60 dark:text-neutral-300 dark:hover:bg-neutral-700"
                >
                  <Copy className="h-4 w-4" />
                </button>
                <button
                  title={t.delete}
                  aria-label={t.delete}
                  onClick={() => deleteTheme(m.id)}
                  className="rounded-md p-1.5 text-neutral-500 hover:bg-red-50 hover:text-red-600 dark:text-neutral-400 dark:hover:bg-red-950"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </Section>
  );
}

/* ================= Live preview (real components, sample rows) ================= */

function LivePreview() {
  const { strings: t } = useStore();
  const [mode, setMode] = useState<"main" | "picker">("main");
  return (
    <div className="rounded-xl border border-neutral-200 bg-neutral-50 p-3 dark:border-neutral-700 dark:bg-neutral-900">
      <div className="mb-2 flex items-center justify-between">
        <span className="text-[12.5px] font-semibold uppercase tracking-wide text-neutral-500 dark:text-neutral-400">
          {t.previewTab}
        </span>
        <div role="tablist" className="flex gap-1">
          {(["main", "picker"] as const).map((m) => (
            <button
              key={m}
              role="tab"
              aria-selected={mode === m}
              onClick={() => setMode(m)}
              className={`rounded-md px-2 py-0.5 text-[12px] font-medium ${
                mode === m
                  ? "seg-active"
                  : "text-neutral-500 hover:bg-neutral-200/60 dark:text-neutral-400 dark:hover:bg-neutral-700"
              }`}
            >
              {m === "main" ? t.previewMain : t.previewPicker}
            </button>
          ))}
        </div>
      </div>
      <div aria-hidden className="pointer-events-none select-none">
        {mode === "main" ? <MainPreview /> : <PickerPreview />}
      </div>
    </div>
  );
}

function MainPreview() {
  const { strings: t } = useStore();
  const noop = () => {};
  return (
    <div
      className="overflow-hidden rounded-lg border border-neutral-200 bg-white dark:border-neutral-700 dark:bg-neutral-800"
      style={{ background: "var(--surface)", borderColor: "var(--border)" }}
    >
      <div className="border-b border-neutral-200 px-3 py-2 text-[13px] font-semibold dark:border-neutral-700">
        {t.appName}
      </div>
      <div className="space-y-2 p-3">
        <div className="app-search w-full rounded-lg border border-neutral-300 bg-white px-2.5 py-1.5 text-[12.5px] text-neutral-400 dark:border-neutral-600 dark:bg-neutral-800">
          {t.searchPlaceholder}
        </div>
        <div className="flex gap-1">
          <FilterChip active={true} onClick={noop} label={t.typeAll} />
          <FilterChip active={false} onClick={noop} label={t.typeCode} />
        </div>
        <p className="pt-1 text-[11px] font-semibold uppercase tracking-wide text-neutral-500 dark:text-neutral-400">
          {t.pinned}
        </p>
        <div className="clip-list space-y-2" role="list">
          <ItemCard item={SAMPLE_ITEMS[0]} onOpenDetails={noop} />
        </div>
        <p className="pt-1 text-[11px] font-semibold uppercase tracking-wide text-neutral-500 dark:text-neutral-400">
          {t.history}
        </p>
        <div className="clip-list space-y-2" role="list">
          <ItemCard item={SAMPLE_ITEMS[1]} onOpenDetails={noop} />
          <ItemCard item={SAMPLE_ITEMS[2]} onOpenDetails={noop} />
        </div>
      </div>
    </div>
  );
}

function PickerPreview() {
  const noop = () => {};
  const onKey = () => {};
  return (
    <div
      className="picker-shell overflow-hidden rounded-xl border border-neutral-300 bg-white shadow-2xl dark:border-neutral-600 dark:bg-neutral-900"
      style={{ background: "var(--surface)", borderColor: "var(--border)" }}
    >
      <div className="border-b border-neutral-200 px-3 py-2 text-[12.5px] text-neutral-400 dark:border-neutral-700">
        Search clipboard...
      </div>
      <ul className="space-y-1 p-1.5">
        <PickerRow item={SAMPLE_ITEMS[0]} index={0} selected={true} onHover={noop} onChoose={noop} onKey={onKey} />
        <PickerRow item={SAMPLE_ITEMS[1]} index={1} selected={false} onHover={noop} onChoose={noop} onKey={onKey} />
      </ul>
    </div>
  );
}
