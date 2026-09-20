import { useEffect, useMemo, useState } from "react";
import {
  ArrowDownToLine,
  BellOff,
  ClipboardList,
  Pause,
  Pin,
  Play,
  Search,
  Settings as SettingsIcon,
  ShieldAlert,
  Trash2,
  X,
} from "lucide-react";
import type { ClipboardItem, DateFilter, TypeFilter } from "./types";
import { useStore } from "./lib/store";
import { openReleasePage, useUpdateCheck } from "./lib/updates";
import ItemCard from "./components/ItemCard";
import Settings from "./components/Settings";
import Onboarding from "./components/Onboarding";
import CommandMenu from "./components/CommandMenu";
import { Banner, ConfirmModal, DetailsModal } from "./components/Modals";
import { openPickerWindow } from "./lib/store-api";

export default function App() {
  const {
    strings: t,
    settings,
    search,
    setSearch,
    typeFilter,
    setTypeFilter,
    dateFilter,
    setDateFilter,
    pinned,
    unpinnedFiltered,
    monitoringPaused,
    setPaused,
    monitorError,
    blockedNotice,
    setBlockedNotice,
    pendingSensitive,
    savePendingOnce,
    dismissPending,
    doClear,
  } = useStore();

  const [showSettings, setShowSettings] = useState(false);
  const update = useUpdateCheck(true);
  const [showCommand, setShowCommand] = useState(false);
  const [showClear, setShowClear] = useState(false);
  const [details, setDetails] = useState<ClipboardItem | null>(null);

  // Ctrl/Cmd+K command menu
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setShowCommand((v) => !v);
      }
    };
    const onSettings = () => setShowSettings(true);
    window.addEventListener("keydown", onKey);
    window.addEventListener("openclip:settings", onSettings);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("openclip:settings", onSettings);
    };
  }, []);

  const typeTabs: { id: TypeFilter; label: string }[] = useMemo(
    () => [
      { id: "all", label: t.typeAll },
      { id: "text", label: t.typeText },
      { id: "links", label: t.typeLinks },
      { id: "code", label: t.typeCode },
      { id: "images", label: t.typeImages },
      { id: "other", label: t.typeOther },
    ],
    [t],
  );
  const dateTabs: { id: DateFilter; label: string }[] = useMemo(
    () => [
      { id: "today", label: t.today },
      { id: "yesterday", label: t.yesterday },
      { id: "7d", label: t.last7 },
      { id: "30d", label: t.last30 },
      { id: "all", label: t.allTime },
    ],
    [t],
  );

  const isEmpty = pinned.length === 0 && unpinnedFiltered.length === 0;

  return (
    <div className="mx-auto flex h-full max-w-3xl flex-col px-4 pb-4 pt-3">
      {/* Header */}
      <header className="flex items-center justify-between">
        <h1 className="flex items-center gap-2 text-[15px] font-semibold text-neutral-900 dark:text-neutral-50">
          <ClipboardList className="h-5 w-5" aria-hidden />
          {t.appName}
        </h1>
        <div className="flex items-center gap-1.5">
          <span
            className={`flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[12px] font-medium ${
              monitoringPaused
                ? "border-amber-300 bg-amber-50 text-amber-700 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-200"
                : "border-neutral-200 bg-white text-neutral-600 dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-300"
            }`}
            title={t.monitoring}
          >
            <span
              aria-hidden
              className={`h-1.5 w-1.5 rounded-full ${monitoringPaused ? "bg-amber-500" : "bg-green-500"}`}
            />
            {t.monitoring}: {monitoringPaused ? t.paused : t.active}
          </span>
          <button
            onClick={() => void setPaused(!monitoringPaused)}
            title={monitoringPaused ? t.resume : t.pause}
            aria-label={monitoringPaused ? t.resume : t.pause}
            className="rounded-lg p-2 text-neutral-500 hover:bg-neutral-200/60 dark:text-neutral-300 dark:hover:bg-neutral-800"
          >
            {monitoringPaused ? <Play className="h-4 w-4" /> : <Pause className="h-4 w-4" />}
          </button>
          <button
            onClick={() => setShowSettings(true)}
            title={t.settings}
            aria-label={t.settings}
            className="rounded-lg p-2 text-neutral-500 hover:bg-neutral-200/60 dark:text-neutral-300 dark:hover:bg-neutral-800"
          >
            <SettingsIcon className="h-4 w-4" />
          </button>
        </div>
      </header>

      {/* Search */}
      <div className="relative mt-3">
        <Search className="pointer-events-none absolute start-3 top-1/2 h-4 w-4 -translate-y-1/2 text-neutral-400" />
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder={t.searchPlaceholder}
          aria-label={t.searchPlaceholder}
          className="w-full rounded-lg border border-neutral-300 bg-white py-2 pe-3 ps-9 text-[14px] outline-none placeholder:text-neutral-400 focus:border-neutral-400 dark:border-neutral-600 dark:bg-neutral-800 dark:focus:border-neutral-500"
        />
      </div>

      {/* Filters */}
      <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
        <div className="flex flex-wrap gap-1" role="tablist" aria-label={t.type}>
          {typeTabs.map((tab) => (
            <FilterChip
              key={tab.id}
              active={typeFilter === tab.id}
              onClick={() => setTypeFilter(tab.id)}
              label={tab.label}
            />
          ))}
        </div>
        <span className="mx-1 h-4 w-px bg-neutral-300 dark:bg-neutral-600" aria-hidden />
        <div className="flex flex-wrap gap-1" role="tablist" aria-label="date">
          {dateTabs.map((tab) => (
            <FilterChip
              key={tab.id}
              active={dateFilter === tab.id}
              onClick={() => setDateFilter(tab.id)}
              label={tab.label}
            />
          ))}
        </div>
      </div>

      {/* Notices */}
      <div className="mt-2.5 space-y-2">
        {update.visible && update.info && (
          <div
            role="status"
            className="flex items-center gap-2 rounded-lg border border-blue-300 bg-blue-50 px-3 py-2 text-[13px] text-blue-900 dark:border-blue-800 dark:bg-blue-950 dark:text-blue-100"
          >
            <ArrowDownToLine className="h-4 w-4 shrink-0" aria-hidden />
            <span className="flex-1">
              {t.updateAvailable} (v{update.info.version})
            </span>
            <button
              onClick={() => void openReleasePage(update.info!.url)}
              className="shrink-0 rounded-md bg-blue-700 px-2.5 py-1 text-[12px] font-medium text-white hover:bg-blue-800"
            >
              {t.downloadUpdate}
            </button>
            <button
              onClick={update.dismiss}
              aria-label={t.cancel}
              className="shrink-0 rounded p-0.5 hover:bg-black/5 dark:hover:bg-white/10"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        )}
        {monitorError && (
          <Banner kind="error">
            {t.errorMonitor}
          </Banner>
        )}
        {blockedNotice && (
          <Banner kind="warn" onClose={() => setBlockedNotice(false)}>
            <span className="flex items-center gap-1.5">
              <ShieldAlert className="h-4 w-4" /> {t.sensitiveBlocked}
            </span>
          </Banner>
        )}
        {pendingSensitive && (
          <div
            role="alert"
            className="flex items-start gap-2 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-[13px] text-amber-800 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-200"
          >
            <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0" />
            <span className="flex-1">{t.sensitiveBlocked}</span>
            <button
              onClick={() => void savePendingOnce()}
              className="shrink-0 rounded-md bg-amber-700 px-2 py-1 text-[12px] font-medium text-white hover:bg-amber-800"
            >
              {t.allowOnce}
            </button>
            <button
              onClick={dismissPending}
              className="shrink-0 rounded-md px-2 py-1 text-[12px] font-medium underline"
            >
              {t.cancel}
            </button>
          </div>
        )}
      </div>

      {/* Content */}
      <main className="mt-3 flex-1 overflow-y-auto pb-2" role="main">
        {isEmpty ? (
          <EmptyState />
        ) : (
          <div className="space-y-4">
            {pinned.length > 0 && (
              <section aria-label={t.pinned}>
                <SectionTitle icon={<Pin className="h-3.5 w-3.5" />} label={t.pinned} />
                <div className="space-y-2" role="list">
                  {pinned.map((i) => (
                    <ItemCard key={i.id} item={i} onOpenDetails={setDetails} />
                  ))}
                </div>
              </section>
            )}
            {unpinnedFiltered.length > 0 && (
              <section aria-label={t.history}>
                <div className="mb-1.5 flex items-center justify-between">
                  <SectionTitle label={t.history} />
                  <button
                    onClick={() => setShowClear(true)}
                    className="flex items-center gap-1 rounded-md px-2 py-1 text-[12.5px] font-medium text-neutral-500 hover:bg-neutral-200/60 hover:text-red-600 dark:text-neutral-400 dark:hover:bg-neutral-800"
                  >
                    <Trash2 className="h-3.5 w-3.5" /> {t.clearHistory}
                  </button>
                </div>
                <div className="space-y-2" role="list">
                  {unpinnedFiltered.map((i) => (
                    <ItemCard key={i.id} item={i} onOpenDetails={setDetails} />
                  ))}
                </div>
              </section>
            )}
            {pinned.length > 0 && unpinnedFiltered.length === 0 && (
              <p className="py-6 text-center text-[13px] text-neutral-500 dark:text-neutral-400">
                {t.noResults}
              </p>
            )}
          </div>
        )}
      </main>

      {/* Footer hint */}
      <footer className="flex items-center justify-between border-t border-neutral-200 pt-2 text-[12px] text-neutral-400 dark:border-neutral-700 dark:text-neutral-500">
        <span className="flex items-center gap-1">
          <BellOff className="h-3.5 w-3.5" />
          <kbd dir="ltr" className="rounded border border-neutral-300 px-1 font-mono text-[11px] dark:border-neutral-600">
            {settings.quickPasteShortcut}
          </kbd>
          <button
            onClick={() => void openPickerWindow()}
            className="underline hover:text-neutral-600 dark:hover:text-neutral-300"
          >
            {t.quickPaste}
          </button>
        </span>
        <span>Ctrl/⌘ K</span>
      </footer>

      {showSettings && <Settings onClose={() => setShowSettings(false)} />}
      {showCommand && <CommandMenu onClose={() => setShowCommand(false)} />}
      {showClear && (
        <ConfirmModal
          title={t.clearConfirmTitle}
          body={t.clearConfirmBody}
          confirmLabel={t.clear}
          onCancel={() => setShowClear(false)}
          onConfirm={() => {
            void doClear();
            setShowClear(false);
          }}
        />
      )}
      {details && <DetailsModal item={details} onClose={() => setDetails(null)} />}
      {!settings.onboardingDone && <Onboarding />}
    </div>
  );
}

function FilterChip({
  active,
  onClick,
  label,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
}) {
  return (
    <button
      role="tab"
      aria-selected={active}
      onClick={onClick}
      className={`rounded-full border px-2.5 py-1 text-[12.5px] font-medium transition-colors ${
        active
          ? "border-neutral-900 bg-neutral-900 text-white dark:border-neutral-100 dark:bg-neutral-100 dark:text-neutral-900"
          : "border-neutral-300 bg-white text-neutral-600 hover:bg-neutral-100 dark:border-neutral-600 dark:bg-neutral-800 dark:text-neutral-300 dark:hover:bg-neutral-700"
      }`}
    >
      {label}
    </button>
  );
}

function SectionTitle({ label, icon }: { label: string; icon?: React.ReactNode }) {
  return (
    <h2 className="mb-1.5 flex items-center gap-1.5 text-[12.5px] font-semibold uppercase tracking-wide text-neutral-500 dark:text-neutral-400">
      {icon}
      {label}
    </h2>
  );
}

function EmptyState() {
  const { strings: t } = useStore();
  return (
    <div className="flex h-full flex-col items-center justify-center py-16 text-center">
      <span className="flex h-12 w-12 items-center justify-center rounded-xl border border-neutral-200 bg-white text-neutral-400 dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-500">
        <ClipboardList className="h-6 w-6" />
      </span>
      <p className="mt-3 text-[14.5px] font-medium text-neutral-700 dark:text-neutral-200">
        {t.emptyTitle}
      </p>
      <p className="mt-1 text-[13px] text-neutral-500 dark:text-neutral-400">{t.emptySub}</p>
    </div>
  );
}
