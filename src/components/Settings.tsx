import { useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { save } from "@tauri-apps/plugin-dialog";
import { open } from "@tauri-apps/plugin-dialog";
import { readTextFile, writeTextFile } from "@tauri-apps/plugin-fs";
import {
  Download,
  Lock,
  MonitorUp,
  RefreshCw,
  Trash2,
  Upload,
  Zap,
} from "lucide-react";
import type { AutoDelete, HistoryLimit, SensitiveMode } from "../types";
import { APP_VERSION } from "../version";
import { useStore } from "../lib/store";
import { isTauriEnv } from "../lib/store-api";
import { useUpdateCheck } from "../lib/updates";
import Appearance from "./Appearance";
import { Banner, ConfirmModal } from "./Modals";

export default function Settings({ onClose }: { onClose: () => void }) {
  const { strings: t, settings: s, updateSettings, doDeleteAll } = useStore();
  const [tab, setTab] = useState<
    "general" | "clipboard" | "privacy" | "shortcuts" | "about" | "appearance"
  >("general");
  const [confirmDeleteAll, setConfirmDeleteAll] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const update = useUpdateCheck(false);

  async function handleExport(kind: "json" | "csv") {
    setMsg(null);
    setErr(null);
    try {
      if (isTauriEnv()) {
        const data: string =
          kind === "json"
            ? await invoke<string>("export_json")
            : await invoke<string>("export_csv");
        const path = await save({
          defaultPath: `open-clip-backup.${kind}`,
          filters: [{ name: kind.toUpperCase(), extensions: [kind] }],
        });
        if (!path) return;
        await writeTextFile(path, data);
      } else {
        const raw = localStorage.getItem("openclip.items.v1") ?? "[]";
        if (kind === "json") {
          const blob = new Blob([raw], { type: "application/json" });
          downloadBlob(blob, "open-clip-backup.json");
        } else {
          const arr = JSON.parse(raw);
          const csv = toCsv(arr);
          downloadBlob(new Blob([csv], { type: "text/csv" }), "open-clip-backup.csv");
        }
      }
      setMsg(t.export);
    } catch (e) {
      setErr(String(e));
    }
  }

  async function handleBackup() {
    await handleExport("json");
  }

  async function handleImportFile(file: File) {
    setMsg(null);
    setErr(null);
    try {
      const text = await file.text();
      if (isTauriEnv()) {
        await invoke("import_backup", { json: text });
      } else {
        const parsed = JSON.parse(text);
        const arr = Array.isArray(parsed) ? parsed : parsed.items;
        if (!Array.isArray(arr)) throw new Error("invalid");
        // minimal validation
        for (const r of arr) {
          if (typeof r.content !== "string" || typeof r.id !== "string")
            throw new Error("invalid");
        }
        localStorage.setItem("openclip.items.v1", JSON.stringify(arr.slice(0, 1000)));
      }
      window.location.reload();
    } catch {
      setErr(t.importInvalid);
    }
  }

  async function handleRestore() {
    if (isTauriEnv()) {
      const path = await open({ multiple: false, filters: [{ name: "JSON", extensions: ["json"] }] });
      if (!path) return;
      try {
        const text = await readTextFile(path as string);
        await invoke("import_backup", { json: text });
        window.location.reload();
      } catch {
        setErr(t.importInvalid);
      }
    } else {
      fileRef.current?.click();
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4" onClick={onClose}>
      <div
        className={`modal-panel animate-fadeIn flex max-h-[88vh] w-full overflow-hidden rounded-xl border border-neutral-200 bg-white shadow-xl dark:border-neutral-700 dark:bg-neutral-800 ${
          tab === "appearance" ? "max-w-4xl" : "max-w-2xl"
        }`}
        role="dialog"
        aria-modal="true"
        aria-label={t.settings}
        onClick={(e) => e.stopPropagation()}
      >
        {/* side tabs */}
        <nav
          className="w-44 shrink-0 border-e border-neutral-200 bg-neutral-50 p-2 dark:border-neutral-700 dark:bg-neutral-900"
          aria-label={t.settings}
        >
          <Tab id="general" label={t.general} tab={tab} setTab={setTab} />
          <Tab id="appearance" label={t.appearance} tab={tab} setTab={setTab} />
          <Tab id="clipboard" label={t.clipboard} tab={tab} setTab={setTab} />
          <Tab id="privacy" label={t.privacy} tab={tab} setTab={setTab} />
          <Tab id="shortcuts" label={t.shortcuts} tab={tab} setTab={setTab} />
          <Tab id="about" label={t.about} tab={tab} setTab={setTab} />
        </nav>

        <div className="flex min-w-0 flex-1 flex-col">
          <div className="flex-1 overflow-y-auto p-5">
            {msg && <div className="mb-3 text-[13px] text-green-700 dark:text-green-300">{msg} ✓</div>}
            {err && (
              <div className="mb-3">
                <Banner kind="error" onClose={() => setErr(null)}>
                  {err}
                </Banner>
              </div>
            )}

            {tab === "general" && (
              <div className="space-y-4">
                <Toggle
                  label={t.startOnStartup}
                  checked={s.startOnStartup}
                  onChange={(v) => void updateSettings({ startOnStartup: v })}
                />
                <Toggle
                  label={t.minimizeToTray}
                  checked={s.minimizeToTray}
                  onChange={(v) => void updateSettings({ minimizeToTray: v })}
                />
                <Toggle
                  label={t.startMinimized}
                  checked={s.startMinimized}
                  onChange={(v) => void updateSettings({ startMinimized: v })}
                />
                <Row label={t.theme}>
                  <Segment
                    options={[
                      { v: "light", l: t.light },
                      { v: "dark", l: t.dark },
                      { v: "system", l: t.system },
                    ]}
                    value={s.theme}
                    onChange={(v) => void updateSettings({ theme: v as typeof s.theme })}
                  />
                </Row>
                <Row label={t.language}>
                  <Segment
                    options={[
                      { v: "en", l: "English" },
                      { v: "ar", l: "العربية" },
                    ]}
                    value={s.lang}
                    onChange={(v) => void updateSettings({ lang: v as typeof s.lang })}
                  />
                </Row>
              </div>
            )}

            {tab === "appearance" && <Appearance />}

            {tab === "clipboard" && (
              <div className="space-y-4">
                <Row label={t.historyLimit}>
                  <Segment
                    options={[
                      { v: "100", l: "100" },
                      { v: "500", l: "500" },
                      { v: "1000", l: "1000" },
                    ]}
                    value={String(s.historyLimit)}
                    onChange={(v) =>
                      void updateSettings({ historyLimit: Number(v) as HistoryLimit })
                    }
                  />
                </Row>
                <Row label={t.autoDelete}>
                  <select
                    value={s.autoDelete}
                    onChange={(e) => void updateSettings({ autoDelete: e.target.value as AutoDelete })}
                    className="rounded-lg border border-neutral-300 bg-white px-2.5 py-1.5 text-[13px] dark:border-neutral-600 dark:bg-neutral-900"
                  >
                    <option value="never">{t.never}</option>
                    <option value="1h">{t.hour1}</option>
                    <option value="1d">{t.day1}</option>
                    <option value="7d">{t.days7}</option>
                    <option value="30d">{t.days30}</option>
                  </select>
                </Row>
                <Toggle
                  label={s.monitoringPaused ? t.resume : t.pause}
                  checked={!s.monitoringPaused}
                  onChange={(v) => void updateSettings({ monitoringPaused: !v })}
                />
              </div>
            )}

            {tab === "privacy" && (
              <div className="space-y-4">
                <div className="rounded-lg border border-neutral-200 bg-neutral-50 px-3.5 py-3 dark:border-neutral-700 dark:bg-neutral-900">
                  <p className="flex items-center gap-1.5 text-[13.5px] font-semibold text-neutral-900 dark:text-neutral-50">
                    <Lock className="h-4 w-4" /> {t.privacyLocal}
                  </p>
                  <p className="mt-1 text-[13px] leading-5 text-neutral-600 dark:text-neutral-300">
                    {t.privacyBody}
                  </p>
                </div>
                <Row label={t.sensitiveTitle}>
                  <Segment
                    options={[
                      { v: "never", l: t.sensitiveNever },
                      { v: "ask", l: t.sensitiveAsk },
                      { v: "allow", l: t.sensitiveAllow },
                    ]}
                    value={s.sensitiveMode}
                    onChange={(v) =>
                      void updateSettings({ sensitiveMode: v as SensitiveMode })
                    }
                  />
                </Row>
                <div className="rounded-lg border border-neutral-200 p-3.5 dark:border-neutral-700">
                  <p className="text-[13px] font-medium text-neutral-500 dark:text-neutral-400">
                    {t.exportWarn}
                  </p>
                  <div className="mt-2.5 flex flex-wrap gap-2">
                    <Btn onClick={() => void handleExport("json")}>
                      <Download className="h-3.5 w-3.5" /> {t.export} (JSON)
                    </Btn>
                    <Btn onClick={() => void handleExport("csv")}>
                      <Download className="h-3.5 w-3.5" /> CSV
                    </Btn>
                    <Btn onClick={() => void handleRestore()}>
                      <Upload className="h-3.5 w-3.5" /> {t.restore}
                    </Btn>
                  </div>
                </div>
                <div className="rounded-lg border border-red-200 bg-red-50/50 p-3.5 dark:border-red-900 dark:bg-red-950/30">
                  <p className="text-[13px] text-red-800 dark:text-red-200">{t.deleteAllBody}</p>
                  <Btn danger onClick={() => setConfirmDeleteAll(true)}>
                    <Trash2 className="h-3.5 w-3.5" /> {t.deleteAll}
                  </Btn>
                </div>
              </div>
            )}

            {tab === "shortcuts" && (
              <div className="space-y-4">
                <Row label={t.shortcutLabel}>
                  <input
                    value={s.quickPasteShortcut}
                    onChange={(e) => void updateSettings({ quickPasteShortcut: e.target.value })}
                    spellCheck={false}
                    placeholder="Alt+V"
                    dir="ltr"
                    className="w-44 rounded-lg border border-neutral-300 bg-white px-2.5 py-1.5 font-mono text-[13px] dark:border-neutral-600 dark:bg-neutral-900"
                  />
                </Row>
                <p className="flex items-center gap-1.5 text-[12.5px] text-neutral-500 dark:text-neutral-400">
                  <Zap className="h-3.5 w-3.5" />
                  {isTauriEnv()
                    ? s.quickPasteShortcut
                    : "Global shortcut works in the Tauri desktop build."}
                </p>
                <Toggle
                  label={t.pasteAuto}
                  checked={s.pasteAutomatically}
                  onChange={(v) => void updateSettings({ pasteAutomatically: v })}
                />
              </div>
            )}

            {tab === "about" && (
              <div className="space-y-2 text-[13.5px]">
                <p className="text-[16px] font-semibold">Open Clip</p>
                <p className="text-neutral-500 dark:text-neutral-400">
                  {t.version}: {APP_VERSION} · {t.license}: MIT
                </p>
                <div className="flex flex-wrap items-center gap-2">
                  <button
                    onClick={() => void update.recheck()}
                    disabled={update.status === "checking"}
                    className="flex items-center gap-1.5 rounded-lg border border-neutral-300 px-3 py-1.5 text-[13px] font-medium text-neutral-700 hover:bg-neutral-100 disabled:opacity-50 dark:border-neutral-600 dark:text-neutral-200 dark:hover:bg-neutral-700"
                  >
                    <RefreshCw
                      className={`h-3.5 w-3.5 ${update.status === "checking" ? "animate-spin" : ""}`}
                    />
                    {t.checkUpdates}
                  </button>
                  {update.status === "available" && update.info && (
                    <span className="text-blue-700 dark:text-blue-300">
                      {t.updateAvailable} (v{update.info.version})
                    </span>
                  )}
                  {update.status === "up-to-date" && (
                    <span className="text-green-700 dark:text-green-300">{t.upToDate} ✓</span>
                  )}
                  {update.status === "error" && (
                    <span className="text-red-600 dark:text-red-300">{t.updateCheckFailed}</span>
                  )}
                </div>
                <p className="text-[12.5px] text-neutral-500 dark:text-neutral-400">
                  {t.updatePrivacyNote}
                </p>
                <p className="flex items-center gap-1.5 text-neutral-600 dark:text-neutral-300">
                  <MonitorUp className="h-4 w-4" /> {t.privacyBody}
                </p>
              </div>
            )}
          </div>

          <div className="flex justify-end border-t border-neutral-200 px-5 py-3 dark:border-neutral-700">
            <button
              onClick={onClose}
              className="btn-primary rounded-lg px-4 py-1.5 text-[13px] font-medium"
            >
              {t.close}
            </button>
          </div>
        </div>
      </div>

      {confirmDeleteAll && (
        <ConfirmModal
          title={t.deleteAllConfirm}
          body={t.deleteAllBody}
          confirmLabel={t.deleteAllBtn}
          danger
          onCancel={() => setConfirmDeleteAll(false)}
          onConfirm={() => {
            void doDeleteAll();
            setConfirmDeleteAll(false);
            onClose();
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
          if (f) void handleImportFile(f);
        }}
      />
    </div>
  );
}

function Tab({
  id,
  label,
  tab,
  setTab,
}: {
  id: "general" | "appearance" | "clipboard" | "privacy" | "shortcuts" | "about";
  label: string;
  tab: string;
  setTab: (t: "general" | "appearance" | "clipboard" | "privacy" | "shortcuts" | "about") => void;
}) {
  const active = tab === id;
  return (
    <button
      onClick={() => setTab(id)}
      aria-current={active ? "page" : undefined}
      className={`block w-full rounded-lg px-3 py-2 text-start text-[13.5px] font-medium ${
        active
          ? "bg-white text-neutral-900 shadow-sm dark:bg-neutral-800 dark:text-neutral-50"
          : "text-neutral-600 hover:bg-neutral-200/50 dark:text-neutral-300 dark:hover:bg-neutral-800"
      }`}
    >
      {label}
    </button>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-2">
      <span className="text-[13.5px] font-medium text-neutral-800 dark:text-neutral-100">
        {label}
      </span>
      {children}
    </div>
  );
}

function Toggle({
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
      <span className="text-[13.5px] font-medium text-neutral-800 dark:text-neutral-100">
        {label}
      </span>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={label}
        onClick={() => onChange(!checked)}
        className={`relative h-6 w-11 shrink-0 rounded-full transition-colors ${
          checked ? "toggle-on" : "bg-neutral-300 dark:bg-neutral-600"
        }`}
      >
        <span
          className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-all dark:bg-neutral-900 ${
            checked ? "start-5 dark:bg-neutral-900" : "start-0.5"
          } ${checked ? "" : ""}`}
          style={
            document.documentElement.dir === "rtl"
              ? { right: checked ? "22px" : "2px", left: "auto" }
              : { left: checked ? "22px" : "2px" }
          }
        />
      </button>
    </label>
  );
}

function Segment({
  options,
  value,
  onChange,
}: {
  options: { v: string; l: string }[];
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <div
      role="radiogroup"
      className="inline-flex rounded-lg border border-neutral-300 p-0.5 dark:border-neutral-600"
    >
      {options.map((o) => (
        <button
          key={o.v}
          role="radio"
          aria-checked={value === o.v}
          onClick={() => onChange(o.v)}
          className={`rounded-md px-2.5 py-1 text-[12.5px] font-medium ${
            value === o.v
              ? "seg-active"
              : "text-neutral-600 hover:bg-neutral-100 dark:text-neutral-300 dark:hover:bg-neutral-700"
          }`}
        >
          {o.l}
        </button>
      ))}
    </div>
  );
}

function Btn({
  children,
  onClick,
  danger = false,
}: {
  children: React.ReactNode;
  onClick: () => void;
  danger?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      className={`mt-2 flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-[13px] font-medium ${
        danger
          ? "border-red-300 text-red-700 hover:bg-red-100 dark:border-red-800 dark:text-red-200 dark:hover:bg-red-900"
          : "border-neutral-300 text-neutral-700 hover:bg-neutral-100 dark:border-neutral-600 dark:text-neutral-200 dark:hover:bg-neutral-700"
      }`}
    >
      {children}
    </button>
  );
}

function downloadBlob(blob: Blob, name: string) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}

function toCsv(arr: { content?: string; content_type?: string; created_at?: number }[]): string {
  const esc = (s: string) => `"${String(s ?? "").replace(/"/g, '""')}"`;
  const rows = [["content", "type", "created_at"]].concat(
    arr.map((r) => [esc(r.content ?? ""), esc(r.content_type ?? ""), String(r.created_at ?? "")]),
  );
  return rows.map((r) => r.join(",")).join("\n");
}
