import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import { useStore } from "./store";

/* ============================================================
   Open Clip appearance system.
   - Pure frontend, local-only (localStorage). The clipboard engine
     (monitoring, storage, tray, shortcuts) is never touched.
   - The "default" preset applies ZERO overrides: current look stays
     pixel-identical. Custom themes opt in via html[data-theme-active].
   ============================================================ */

export type Scheme = "light" | "dark";

export interface ColorTokens {
  background: string;
  surface: string;
  surfaceElevated: string;
  foreground: string;
  muted: string;
  border: string;
  accent: string;
  accentFg: string;
  accentStrong: string;
  accentStrongFg: string;
  accentSoft: string;
  danger: string;
  success: string;
  warning: string;
}

export type RadiusId = "sharp" | "small" | "medium" | "large" | "round";
export type DensityId = "compact" | "comfortable" | "spacious";
export type CardStyleId = "minimal" | "cards" | "list";
export type TimestampStyle = "relative" | "absolute" | "full";
export type PreviewLength = "short" | "medium" | "long";
export type PickerSize = "small" | "medium" | "large";
export type PickerPosition = "center" | "top" | "cursor";
export type PickerStyle = "minimal" | "compact" | "detailed";
export type TextSize = "small" | "medium" | "large";
export type FontId = "system" | "plex";
export type HeaderStyle = "minimal" | "standard" | "prominent";
export type ShadowId = "none" | "soft" | "medium" | "strong";
export type BordersId = "none" | "subtle" | "visible";

export interface RadiusTokens {
  base: number;
  sm: number;
  md: number;
  lg: number;
  xl: number;
  xxl: number;
  pill: number;
}

/** Visual snapshot: everything a theme file / My Theme stores. */
export interface AppearanceSnapshot {
  colors: ColorTokens;
  radius: RadiusId;
  density: DensityId;
  cardStyle: CardStyleId;
  showType: boolean;
  showTime: boolean;
  showWords: boolean;
  timestampStyle: TimestampStyle;
  previewLength: PreviewLength;
  pickerSize: PickerSize;
  pickerPosition: PickerPosition;
  pickerStyle: PickerStyle;
  textSize: TextSize;
  font: FontId;
  headerStyle: HeaderStyle;
  shadow: ShadowId;
  borders: BordersId;
}

export interface CustomThemeRecord {
  id: string;
  name: string;
  updatedAt: number;
  snapshot: AppearanceSnapshot;
}

export interface AppearanceSettings extends AppearanceSnapshot {
  /** 'default' | preset id | 'custom' | `my:${id}` */
  presetId: string;
  /** quick accent override (hex) applied on top of the active preset; null = preset default */
  accent: string | null;
  /** working copy edited when presetId === 'custom' */
  customTokens: ColorTokens;
  myThemes: CustomThemeRecord[];
  recentColors: string[];
}

/* ---------------- Defaults (== current look) ---------------- */

export const RADIUS_MAP: Record<RadiusId, RadiusTokens> = {
  sharp: { base: 0, sm: 0, md: 2, lg: 4, xl: 4, xxl: 4, pill: 4 },
  small: { base: 4, sm: 4, md: 6, lg: 8, xl: 10, xxl: 12, pill: 9999 },
  medium: { base: 4, sm: 2, md: 6, lg: 8, xl: 12, xxl: 16, pill: 9999 },
  large: { base: 8, sm: 8, md: 12, lg: 16, xl: 20, xxl: 24, pill: 9999 },
  round: { base: 12, sm: 10, md: 16, lg: 22, xl: 28, xxl: 32, pill: 9999 },
};

export const PREVIEW_LENGTH_MAP: Record<PreviewLength, number> = {
  short: 80,
  medium: 220,
  long: 320,
};

export const PICKER_SIZE_MAP: Record<PickerSize, { w: number; h: number }> = {
  small: { w: 380, h: 460 },
  medium: { w: 460, h: 540 },
  large: { w: 540, h: 660 },
};

export const ACCENT_PRESETS: { name: string; hex: string }[] = [
  { name: "Blue", hex: "#2563EB" },
  { name: "Indigo", hex: "#4F46E5" },
  { name: "Purple", hex: "#7C3AED" },
  { name: "Violet", hex: "#8B5CF6" },
  { name: "Green", hex: "#16A34A" },
  { name: "Teal", hex: "#0D9488" },
  { name: "Orange", hex: "#EA580C" },
  { name: "Red", hex: "#DC2626" },
  { name: "Pink", hex: "#DB2777" },
];

/** Default preset tokens == today's look, light scheme. */
export const DEFAULT_LIGHT_TOKENS: ColorTokens = {
  background: "#F5F5F5",
  surface: "#FFFFFF",
  surfaceElevated: "#F5F5F5",
  foreground: "#171717",
  muted: "#737373",
  border: "#E5E5E5",
  accent: "#2563EB",
  accentFg: "#FFFFFF",
  accentStrong: "#171717",
  accentStrongFg: "#FFFFFF",
  accentSoft: "#F5F5F5",
  danger: "#DC2626",
  success: "#16A34A",
  warning: "#B45309",
};

/** Default preset tokens == today's look, dark scheme. */
export const DEFAULT_DARK_TOKENS: ColorTokens = {
  background: "#171717",
  surface: "#262626",
  surfaceElevated: "#404040",
  foreground: "#F5F5F5",
  muted: "#A3A3A3",
  border: "#404040",
  accent: "#2563EB",
  accentFg: "#FFFFFF",
  accentStrong: "#F5F5F5",
  accentStrongFg: "#171717",
  accentSoft: "#404040",
  danger: "#F87171",
  success: "#34D399",
  warning: "#FBBF24",
};

export interface ThemePreset {
  id: string;
  name: string;
  builtin: true;
  schemes: Record<Scheme, ColorTokens>;
}

const t = (
  background: string,
  surface: string,
  surfaceElevated: string,
  foreground: string,
  muted: string,
  border: string,
  accent: string,
  accentFg: string,
  accentStrong: string,
  accentStrongFg: string,
  accentSoft: string,
  danger: string,
  success: string,
  warning: string,
): ColorTokens => ({
  background,
  surface,
  surfaceElevated,
  foreground,
  muted,
  border,
  accent,
  accentFg,
  accentStrong,
  accentStrongFg,
  accentSoft,
  danger,
  success,
  warning,
});

export const THEME_PRESETS: ThemePreset[] = [
  {
    id: "default",
    name: "Default",
    builtin: true,
    schemes: { light: DEFAULT_LIGHT_TOKENS, dark: DEFAULT_DARK_TOKENS },
  },
  {
    id: "midnight",
    name: "Midnight",
    builtin: true,
    schemes: {
      light: t("#EDF1F8", "#FFFFFF", "#F5F8FC", "#16233A", "#5B6B87", "#D7E0EE", "#2563EB", "#FFFFFF", "#1D4ED8", "#FFFFFF", "#DBEAFE", "#DC2626", "#16A34A", "#B45309"),
      dark: t("#0B1220", "#111A2E", "#182641", "#E6EBF5", "#8B98B3", "#24334F", "#6EA8FE", "#06101F", "#3B82F6", "#FFFFFF", "#1B2C4E", "#F87171", "#34D399", "#FBBF24"),
    },
  },
  {
    id: "slate",
    name: "Slate",
    builtin: true,
    schemes: {
      light: t("#F1F4F6", "#FFFFFF", "#F7FAFB", "#1C2127", "#5F6B76", "#DDE3E8", "#0284C7", "#FFFFFF", "#0369A1", "#FFFFFF", "#E0F2FE", "#DC2626", "#16A34A", "#B45309"),
      dark: t("#101418", "#171C22", "#20262E", "#E8EAED", "#9AA3AD", "#2B323B", "#7DD3FC", "#0B1A22", "#38BDF8", "#0B1A22", "#1D323D", "#F87171", "#34D399", "#FBBF24"),
    },
  },
  {
    id: "forest",
    name: "Forest",
    builtin: true,
    schemes: {
      light: t("#F0F7F2", "#FFFFFF", "#F4FAF6", "#14231A", "#5C7163", "#D9E7DD", "#15803D", "#FFFFFF", "#166534", "#FFFFFF", "#DCFCE7", "#DC2626", "#15803D", "#B45309"),
      dark: t("#0D1512", "#131E19", "#1A2921", "#E7F0EA", "#93A89A", "#24382D", "#4ADE80", "#052E16", "#22C55E", "#052E16", "#173325", "#F87171", "#4ADE80", "#FBBF24"),
    },
  },
  {
    id: "ocean",
    name: "Ocean",
    builtin: true,
    schemes: {
      light: t("#EEF9FB", "#FFFFFF", "#F4FBFC", "#0F2A33", "#54717B", "#D3E7EC", "#0E7490", "#FFFFFF", "#155E75", "#FFFFFF", "#CFFAFE", "#DC2626", "#16A34A", "#B45309"),
      dark: t("#081318", "#0E1F27", "#14303B", "#E3F2F6", "#8BA7B3", "#1F3D49", "#22D3EE", "#083344", "#06B6D4", "#083344", "#123A44", "#F87171", "#34D399", "#FBBF24"),
    },
  },
  {
    id: "purple",
    name: "Purple",
    builtin: true,
    schemes: {
      light: t("#F5F2FC", "#FFFFFF", "#F8F5FE", "#241D3D", "#6A6285", "#E2D9F5", "#7C3AED", "#FFFFFF", "#6D28D9", "#FFFFFF", "#EDE9FE", "#DC2626", "#16A34A", "#B45309"),
      dark: t("#120F1D", "#1A1529", "#241D38", "#ECE8F7", "#A49CC0", "#322A4D", "#A78BFA", "#2E1065", "#8B5CF6", "#FFFFFF", "#2A2342", "#F87171", "#34D399", "#FBBF24"),
    },
  },
  {
    id: "warm",
    name: "Warm",
    builtin: true,
    schemes: {
      light: t("#FAF6EF", "#FFFDF8", "#F5EFE2", "#292019", "#7A6C5C", "#E7DCC8", "#B45309", "#FFFFFF", "#92400E", "#FFFFFF", "#FEF3C7", "#DC2626", "#15803D", "#B45309"),
      dark: t("#171310", "#211A15", "#2C231B", "#F5EDE3", "#B3A48F", "#3D3226", "#FBBF24", "#451A03", "#F59E0B", "#451A03", "#3A2E1C", "#F87171", "#4ADE80", "#FBBF24"),
    },
  },
  {
    id: "contrast",
    name: "High Contrast",
    builtin: true,
    schemes: {
      light: t("#FFFFFF", "#FFFFFF", "#F5F5F5", "#000000", "#404040", "#525252", "#1E40AF", "#FFFFFF", "#000000", "#FFFFFF", "#DBEAFE", "#B91C1C", "#15803D", "#92400E"),
      dark: t("#000000", "#0A0A0A", "#161616", "#FFFFFF", "#D4D4D4", "#737373", "#FACC15", "#000000", "#FACC15", "#000000", "#292524", "#FF6B6B", "#4ADE80", "#FACC15"),
    },
  },
];

export const DEFAULT_APPEARANCE: AppearanceSettings = {
  presetId: "default",
  accent: null,
  colors: { ...DEFAULT_LIGHT_TOKENS },
  customTokens: { ...DEFAULT_LIGHT_TOKENS },
  radius: "medium",
  density: "comfortable",
  cardStyle: "cards",
  showType: true,
  showTime: true,
  showWords: false,
  timestampStyle: "relative",
  previewLength: "medium",
  pickerSize: "medium",
  pickerPosition: "center",
  pickerStyle: "compact",
  textSize: "medium",
  font: "plex",
  headerStyle: "standard",
  shadow: "soft",
  borders: "subtle",
  myThemes: [],
  recentColors: [],
};

const LS_KEY = "openclip.appearance.v1";

/* ---------------- Color utils ---------------- */

export function isValidHex(v: string): boolean {
  return /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/.test(v.trim());
}

export function normalizeHex(v: string): string {
  let s = v.trim();
  if (!s.startsWith("#")) s = "#" + s;
  if (/^#[0-9a-fA-F]{3}$/.test(s)) {
    s = "#" + s[1] + s[1] + s[2] + s[2] + s[3] + s[3];
  }
  return s.toUpperCase();
}

function hexToRgb(hex: string): [number, number, number] {
  const h = normalizeHex(hex).slice(1);
  return [
    parseInt(h.slice(0, 2), 16),
    parseInt(h.slice(2, 4), 16),
    parseInt(h.slice(4, 6), 16),
  ];
}

function luminance(hex: string): number {
  const [r, g, b] = hexToRgb(hex).map((c) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** WCAG contrast ratio between two colors (1..21). */
export function contrastRatio(a: string, b: string): number {
  try {
    const l1 = luminance(a);
    const l2 = luminance(b);
    const [hi, lo] = l1 >= l2 ? [l1, l2] : [l2, l1];
    return (hi + 0.05) / (lo + 0.05);
  } catch {
    return 1;
  }
}

/** Pick readable text (#FFFFFF or #111111) for a background. */
export function autoForeground(bg: string): string {
  try {
    return contrastRatio(bg, "#FFFFFF") >= contrastRatio(bg, "#111111")
      ? "#FFFFFF"
      : "#111111";
  } catch {
    return "#FFFFFF";
  }
}

/* ---------------- Persistence ---------------- */

function sanitizeColors(raw: unknown, fallback: ColorTokens): ColorTokens {
  const out = { ...fallback };
  if (typeof raw !== "object" || raw === null) return out;
  const r = raw as Record<string, unknown>;
  (Object.keys(out) as (keyof ColorTokens)[]).forEach((k) => {
    if (typeof r[k] === "string" && isValidHex(r[k] as string)) {
      out[k] = normalizeHex(r[k] as string);
    }
  });
  return out;
}

const ENUMS: Record<string, readonly string[]> = {
  radius: ["sharp", "small", "medium", "large", "round"],
  density: ["compact", "comfortable", "spacious"],
  cardStyle: ["minimal", "cards", "list"],
  timestampStyle: ["relative", "absolute", "full"],
  previewLength: ["short", "medium", "long"],
  pickerSize: ["small", "medium", "large"],
  pickerPosition: ["center", "top", "cursor"],
  pickerStyle: ["minimal", "compact", "detailed"],
  textSize: ["small", "medium", "large"],
  font: ["system", "plex"],
  headerStyle: ["minimal", "standard", "prominent"],
  shadow: ["none", "soft", "medium", "strong"],
  borders: ["none", "subtle", "visible"],
};

function sanitizeEnum<T extends string>(v: unknown, allowed: readonly string[], fallback: T): T {
  return typeof v === "string" && (allowed as readonly string[]).includes(v) ? (v as T) : fallback;
}

function sanitizeMyThemes(raw: unknown): CustomThemeRecord[] {
  if (!Array.isArray(raw)) return [];
  const out: CustomThemeRecord[] = [];
  for (const e of raw.slice(0, 50)) {
    if (typeof e !== "object" || e === null) continue;
    const r = e as Record<string, unknown>;
    if (typeof r.id !== "string" || typeof r.name !== "string") continue;
    const s = (r.snapshot ?? {}) as Record<string, unknown>;
    out.push({
      id: r.id.slice(0, 64),
      name: r.name.slice(0, 60) || "Theme",
      updatedAt: typeof r.updatedAt === "number" ? r.updatedAt : Date.now(),
      snapshot: sanitizeSnapshot(s, DEFAULT_APPEARANCE),
    });
  }
  return out;
}

function sanitizeSnapshot(raw: Record<string, unknown>, fallback: AppearanceSnapshot): AppearanceSnapshot {
  const d = DEFAULT_APPEARANCE;
  return {
    colors: sanitizeColors(raw.colors, (fallback.colors as ColorTokens) ?? d.customTokens),
    radius: sanitizeEnum(raw.radius, ENUMS.radius, d.radius),
    density: sanitizeEnum(raw.density, ENUMS.density, d.density),
    cardStyle: sanitizeEnum(raw.cardStyle, ENUMS.cardStyle, d.cardStyle),
    showType: typeof raw.showType === "boolean" ? raw.showType : d.showType,
    showTime: typeof raw.showTime === "boolean" ? raw.showTime : d.showTime,
    showWords: typeof raw.showWords === "boolean" ? raw.showWords : d.showWords,
    timestampStyle: sanitizeEnum(raw.timestampStyle, ENUMS.timestampStyle, d.timestampStyle),
    previewLength: sanitizeEnum(raw.previewLength, ENUMS.previewLength, d.previewLength),
    pickerSize: sanitizeEnum(raw.pickerSize, ENUMS.pickerSize, d.pickerSize),
    pickerPosition: sanitizeEnum(raw.pickerPosition, ENUMS.pickerPosition, d.pickerPosition),
    pickerStyle: sanitizeEnum(raw.pickerStyle, ENUMS.pickerStyle, d.pickerStyle),
    textSize: sanitizeEnum(raw.textSize, ENUMS.textSize, d.textSize),
    font: sanitizeEnum(raw.font, ENUMS.font, d.font),
    headerStyle: sanitizeEnum(raw.headerStyle, ENUMS.headerStyle, d.headerStyle),
    shadow: sanitizeEnum(raw.shadow, ENUMS.shadow, d.shadow),
    borders: sanitizeEnum(raw.borders, ENUMS.borders, d.borders),
  };
}

export function sanitizeAppearance(raw: unknown): AppearanceSettings {
  const d = DEFAULT_APPEARANCE;
  if (typeof raw !== "object" || raw === null) return { ...d };
  const r = raw as Record<string, unknown>;
  const presetId = typeof r.presetId === "string" ? r.presetId.slice(0, 80) : d.presetId;
  const accent =
    typeof r.accent === "string" && isValidHex(r.accent) ? normalizeHex(r.accent) : null;
  const recent = Array.isArray(r.recentColors)
    ? (r.recentColors as unknown[]).filter((c) => typeof c === "string" && isValidHex(c)).slice(0, 5).map((c) => normalizeHex(c as string))
    : [];
  return {
    ...sanitizeSnapshot(r, d),
    presetId,
    accent,
    customTokens: sanitizeColors(r.customTokens, d.customTokens),
    myThemes: sanitizeMyThemes(r.myThemes),
    recentColors: recent,
  };
}

function loadStored(): AppearanceSettings {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return { ...DEFAULT_APPEARANCE };
    return sanitizeAppearance(JSON.parse(raw));
  } catch {
    return { ...DEFAULT_APPEARANCE };
  }
}

function persist(s: AppearanceSettings) {
  try {
    localStorage.setItem(LS_KEY, JSON.stringify(s));
  } catch {
    /* ignore */
  }
}

/* ---------------- Resolve + apply ---------------- */

export function findPreset(id: string): ThemePreset | undefined {
  return THEME_PRESETS.find((p) => p.id === id);
}

export function findMyTheme(s: AppearanceSettings, id: string): CustomThemeRecord | undefined {
  return s.myThemes.find((m) => m.id === id);
}

/** Effective color tokens for the current scheme, or null for the Default preset (no overrides). */
export function resolveTokens(s: AppearanceSettings, scheme: Scheme): ColorTokens | null {
  let base: ColorTokens | null = null;
  if (s.presetId === "default") {
    base = null;
  } else if (s.presetId === "custom") {
    base = s.customTokens;
  } else if (s.presetId.startsWith("my:")) {
    base = findMyTheme(s, s.presetId.slice(3))?.snapshot.colors ?? null;
  } else {
    base = findPreset(s.presetId)?.schemes[scheme] ?? null;
  }
  if (!base) return null;
  if (s.accent) {
    const fg = autoForeground(s.accent);
    return { ...base, accent: s.accent, accentFg: fg, accentStrong: s.accent, accentStrongFg: fg };
  }
  return base;
}

const TOKEN_KEYS: (keyof ColorTokens)[] = [
  "background",
  "surface",
  "surfaceElevated",
  "foreground",
  "muted",
  "border",
  "accent",
  "accentFg",
  "accentStrong",
  "accentStrongFg",
  "accentSoft",
  "danger",
  "success",
  "warning",
];

const TOKEN_CSS: Record<keyof ColorTokens, string> = {
  background: "--background",
  surface: "--surface",
  surfaceElevated: "--surface-elevated",
  foreground: "--foreground",
  muted: "--muted",
  border: "--border",
  accent: "--accent",
  accentFg: "--accent-fg",
  accentStrong: "--accent-strong",
  accentStrongFg: "--accent-strong-fg",
  accentSoft: "--accent-soft",
  danger: "--danger",
  success: "--success",
  warning: "--warning",
};

function applyToDOM(s: AppearanceSettings, isDark: boolean) {
  const root = document.documentElement;
  const tokens = resolveTokens(s, isDark ? "dark" : "light");
  const style = root.style;
  if (tokens) {
    root.setAttribute("data-theme-active", "custom");
    TOKEN_KEYS.forEach((k) => style.setProperty(TOKEN_CSS[k], tokens[k]));
  } else {
    root.removeAttribute("data-theme-active");
    TOKEN_KEYS.forEach((k) => style.removeProperty(TOKEN_CSS[k]));
  }
  const r = RADIUS_MAP[s.radius];
  style.setProperty("--radius-base", `${r.base}px`);
  style.setProperty("--radius-sm", `${r.sm}px`);
  style.setProperty("--radius-md", `${r.md}px`);
  style.setProperty("--radius-lg", `${r.lg}px`);
  style.setProperty("--radius-xl", `${r.xl}px`);
  style.setProperty("--radius-xxl", `${r.xxl}px`);
  style.setProperty("--radius-pill", `${r.pill}px`);
  root.setAttribute("data-radius", s.radius);
  root.setAttribute("data-density", s.density);
  root.setAttribute("data-cardstyle", s.cardStyle);
  root.setAttribute("data-shadow", s.shadow);
  root.setAttribute("data-borders", s.borders);
  root.setAttribute("data-font", s.font);
  root.setAttribute("data-textsize", s.textSize);
  root.setAttribute("data-header", s.headerStyle);
}

/* ---------------- Context ---------------- */

interface AppearanceCtx {
  appearance: AppearanceSettings;
  update: (patch: Partial<AppearanceSettings>) => void;
  resetAll: () => void;
  resetColors: () => void;
  saveAsTheme: (name: string) => void;
  renameTheme: (id: string, name: string) => void;
  deleteTheme: (id: string) => void;
  duplicateTheme: (id: string) => void;
  applySnapshot: (snap: AppearanceSnapshot, presetId: string) => void;
  importTheme: (name: string, snap: AppearanceSnapshot) => void;
}

const Ctx = createContext<AppearanceCtx | null>(null);

export function snapshotOf(s: AppearanceSettings): AppearanceSnapshot {
  const {
    presetId: _p,
    accent: _a,
    customTokens: _c,
    myThemes: _m,
    recentColors: _r,
    ...snap
  } = s;
  void _p;
  void _a;
  void _c;
  void _m;
  void _r;
  return snap;
}

export function AppearanceProvider({ children }: { children: React.ReactNode }) {
  const { settings } = useStore();
  const [appearance, setAppearance] = useState<AppearanceSettings>(() => loadStored());

  const isDark = useMemo(() => {
    if (settings.theme === "dark") return true;
    if (settings.theme === "light") return false;
    return window.matchMedia("(prefers-color-scheme: dark)").matches;
  }, [settings.theme]);

  // Re-resolve when the OS theme flips while mode === system.
  const [, force] = useState(0);
  useEffect(() => {
    if (settings.theme !== "system") return;
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = () => force((n) => n + 1);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, [settings.theme]);

  // Apply on every change (both windows run this provider).
  useEffect(() => {
    applyToDOM(appearance, isDark);
  }, [appearance, isDark]);

  // Cross-window sync: picker follows main-window changes live.
  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key === LS_KEY) setAppearance(loadStored());
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  const update = useCallback((patch: Partial<AppearanceSettings>) => {
    setAppearance((prev) => {
      let next = { ...prev, ...patch };
      // track recent colors when the accent changes to a valid new hex
      if (patch.accent && isValidHex(patch.accent)) {
        const hex = normalizeHex(patch.accent);
        next = {
          ...next,
          accent: hex,
          recentColors: [hex, ...prev.recentColors.filter((c) => c !== hex)].slice(0, 5),
        };
      }
      persist(next);
      return next;
    });
  }, []);

  const resetAll = useCallback(() => {
    const next = { ...DEFAULT_APPEARANCE };
    persist(next);
    setAppearance(next);
  }, []);

  const resetColors = useCallback(() => {
    const mode = settings.theme;
    setAppearance((prev) => {
      const darkMq = window.matchMedia("(prefers-color-scheme: dark)").matches;
      const base = mode === "dark" || (mode === "system" && darkMq) ? DEFAULT_DARK_TOKENS : DEFAULT_LIGHT_TOKENS;
      const next = { ...prev, accent: null, customTokens: { ...base }, presetId: "default" };
      persist(next);
      return next;
    });
  }, [settings.theme]);

  const saveAsTheme = useCallback((name: string) => {
    setAppearance((prev) => {
      const rec: CustomThemeRecord = {
        id: `${Date.now().toString(36)}-${Math.floor(Math.random() * 1e6).toString(36)}`,
        name: name.trim().slice(0, 60) || "My Theme",
        updatedAt: Date.now(),
        snapshot: snapshotOf({ ...prev, accent: null }),
      };
      const next = { ...prev, myThemes: [rec, ...prev.myThemes].slice(0, 50), presetId: `my:${rec.id}` };
      persist(next);
      return next;
    });
  }, []);

  const renameTheme = useCallback((id: string, name: string) => {
    setAppearance((prev) => {
      const next = {
        ...prev,
        myThemes: prev.myThemes.map((m) =>
          m.id === id ? { ...m, name: name.trim().slice(0, 60) || m.name, updatedAt: Date.now() } : m,
        ),
      };
      persist(next);
      return next;
    });
  }, []);

  const deleteTheme = useCallback((id: string) => {
    setAppearance((prev) => {
      const next = {
        ...prev,
        myThemes: prev.myThemes.filter((m) => m.id !== id),
        presetId: prev.presetId === `my:${id}` ? "default" : prev.presetId,
      };
      persist(next);
      return next;
    });
  }, []);

  const duplicateTheme = useCallback((id: string) => {
    setAppearance((prev) => {
      const src = prev.myThemes.find((m) => m.id === id);
      if (!src) return prev;
      const rec: CustomThemeRecord = {
        ...src,
        id: `${Date.now().toString(36)}-${Math.floor(Math.random() * 1e6).toString(36)}`,
        name: `${src.name} (copy)`.slice(0, 60),
        updatedAt: Date.now(),
        snapshot: JSON.parse(JSON.stringify(src.snapshot)) as AppearanceSnapshot,
      };
      const next = { ...prev, myThemes: [rec, ...prev.myThemes].slice(0, 50) };
      persist(next);
      return next;
    });
  }, []);

  const applySnapshot = useCallback((snap: AppearanceSnapshot, presetId: string) => {
    setAppearance((prev) => {
      const next = { ...prev, ...snap, presetId };
      persist(next);
      return next;
    });
  }, []);

  const importTheme = useCallback((name: string, snap: AppearanceSnapshot) => {
    setAppearance((prev) => {
      const rec: CustomThemeRecord = {
        id: `${Date.now().toString(36)}-${Math.floor(Math.random() * 1e6).toString(36)}`,
        name: name.trim().slice(0, 60) || "Imported Theme",
        updatedAt: Date.now(),
        snapshot: JSON.parse(JSON.stringify(snap)) as AppearanceSnapshot,
      };
      const next = {
        ...prev,
        ...JSON.parse(JSON.stringify(snap)) as AppearanceSnapshot,
        myThemes: [rec, ...prev.myThemes].slice(0, 50),
        presetId: `my:${rec.id}`,
      };
      persist(next);
      return next;
    });
  }, []);

  const value: AppearanceCtx = {
    appearance,
    update,
    resetAll,
    resetColors,
    saveAsTheme,
    renameTheme,
    deleteTheme,
    duplicateTheme,
    applySnapshot,
    importTheme,
  };
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useAppearance(): AppearanceCtx {
  const c = useContext(Ctx);
  if (!c) throw new Error("Appearance not ready");
  return c;
}

/* ---------------- Theme file (.openclip-theme.json) ---------------- */

export interface ThemeFile {
  format: "openclip-theme";
  version: 1;
  name: string;
  appearance: AppearanceSnapshot;
}

export function buildThemeFile(name: string, s: AppearanceSettings): ThemeFile {
  return { format: "openclip-theme", version: 1, name, appearance: snapshotOf(s) };
}

export function validateThemeFile(data: unknown): { ok: true; file: ThemeFile } | { ok: false } {
  if (typeof data !== "object" || data === null) return { ok: false };
  const r = data as Record<string, unknown>;
  if (r.format !== "openclip-theme" || r.version !== 1) return { ok: false };
  if (typeof r.name !== "string" || !r.name.trim()) return { ok: false };
  if (typeof r.appearance !== "object" || r.appearance === null) return { ok: false };
  try {
    const appearance = sanitizeSnapshot(r.appearance as Record<string, unknown>, DEFAULT_APPEARANCE);
    // colors must be fully present and valid (sanitizer falls back silently —
    // re-check that every token key was genuinely provided as valid hex).
    const rawColors = (r.appearance as Record<string, unknown>).colors as Record<string, unknown>;
    if (typeof rawColors !== "object" || rawColors === null) return { ok: false };
    for (const k of TOKEN_KEYS) {
      if (typeof rawColors[k] !== "string" || !isValidHex(rawColors[k] as string)) {
        return { ok: false };
      }
    }
    return {
      ok: true,
      file: { format: "openclip-theme", version: 1, name: r.name.trim().slice(0, 60), appearance },
    };
  } catch {
    return { ok: false };
  }
}
