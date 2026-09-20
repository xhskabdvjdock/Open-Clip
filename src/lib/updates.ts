import { useCallback, useEffect, useState } from "react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { APP_VERSION } from "../version";
import { isTauriEnv } from "./store-api";

/**
 * Lightweight update check against GitHub Releases — no update server,
 * no background downloads, no auto-install. The app works fully offline;
 * this only fires one small request per day (plus manual checks) and
 * fails silently when offline.
 *
 * To publish an update: bump versions, build the installer, create a
 * GitHub Release tagged like v1.1.0, attach the setup exe. The banner
 * then appears automatically for older installs.
 */

export const UPDATE_OWNER = "xhskabdvjdock";
export const UPDATE_REPO = "Open-Clip";
const API_URL = `https://api.github.com/repos/${UPDATE_OWNER}/${UPDATE_REPO}/releases/latest`;
const CHECK_INTERVAL_MS = 24 * 3600_000;
const LS_KEY = "openclip.update-check.v1";

export interface UpdateInfo {
  /** tag as published, e.g. "v1.1.0" */
  tag: string;
  /** human version without leading v, e.g. "1.1.0" */
  version: string;
  /** release page url */
  url: string;
}

export type UpdateStatus = "unknown" | "checking" | "available" | "up-to-date" | "error";

interface Cache {
  lastCheck: number;
  latestTag: string;
  latestUrl: string;
  dismissedTag: string;
}

function loadCache(): Cache {
  const fallback: Cache = { lastCheck: 0, latestTag: "", latestUrl: "", dismissedTag: "" };
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return fallback;
    const p = JSON.parse(raw);
    return { ...fallback, ...p };
  } catch {
    return fallback;
  }
}

function saveCache(c: Cache) {
  try {
    localStorage.setItem(LS_KEY, JSON.stringify(c));
  } catch {
    /* ignore */
  }
}

function norm(v: string): number[] {
  return v
    .replace(/^[vV]/, "")
    .split(".")
    .map((p) => parseInt(p.replace(/[^0-9].*$/, ""), 10) || 0);
}

/** true when remote is strictly newer than local (1.1.0 > 1.0.0). */
export function isNewerVersion(local: string, remote: string): boolean {
  const a = norm(local);
  const b = norm(remote);
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const x = b[i] ?? 0;
    const y = a[i] ?? 0;
    if (x !== y) return x > y;
  }
  return false;
}

export async function fetchLatestRelease(signal?: AbortSignal): Promise<UpdateInfo | null> {
  const res = await fetch(API_URL, {
    signal,
    headers: { Accept: "application/vnd.github+json" },
  });
  if (!res.ok) return null; // e.g. 404 = no releases published yet
  const data = await res.json();
  const tag = typeof data?.tag_name === "string" ? data.tag_name : "";
  const url = typeof data?.html_url === "string" ? data.html_url : "";
  if (!tag || !url) return null;
  return { tag, version: tag.replace(/^[vV]/, ""), url };
}

export async function openReleasePage(url: string): Promise<void> {
  if (isTauriEnv()) {
    try {
      await openUrl(url);
      return;
    } catch {
      /* fall through to window.open */
    }
  }
  window.open(url, "_blank", "noopener");
}

export function useUpdateCheck(auto = true) {
  const [status, setStatus] = useState<UpdateStatus>("unknown");
  const [info, setInfo] = useState<UpdateInfo | null>(null);
  const [dismissed, setDismissed] = useState<string>(() => loadCache().dismissedTag);

  const run = useCallback(async (force: boolean) => {
    const cache = loadCache();
    // Fresh cache: no network needed.
    if (!force && cache.latestTag && Date.now() - cache.lastCheck < CHECK_INTERVAL_MS) {
      if (isNewerVersion(APP_VERSION, cache.latestTag)) {
        setInfo({
          tag: cache.latestTag,
          version: cache.latestTag.replace(/^[vV]/, ""),
          url: cache.latestUrl,
        });
        setStatus("available");
      }
      return;
    }
    setStatus("checking");
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 8000);
    try {
      const latest = await fetchLatestRelease(ctrl.signal);
      clearTimeout(timer);
      if (!latest) {
        setStatus(force ? "error" : "unknown");
        return;
      }
      const prev = loadCache();
      saveCache({ ...prev, lastCheck: Date.now(), latestTag: latest.tag, latestUrl: latest.url });
      if (isNewerVersion(APP_VERSION, latest.tag)) {
        setInfo(latest);
        setStatus("available");
      } else {
        setStatus("up-to-date");
      }
    } catch {
      clearTimeout(timer);
      // Offline or blocked: stay silent in auto mode.
      setStatus(force ? "error" : "unknown");
    }
  }, []);

  useEffect(() => {
    if (auto) void run(false);
  }, [auto, run]);

  const dismiss = useCallback(() => {
    const tag = info?.tag ?? loadCache().latestTag;
    if (!tag) return;
    const c = loadCache();
    saveCache({ ...c, dismissedTag: tag });
    setDismissed(tag);
  }, [info]);

  const visible = status === "available" && info !== null && dismissed !== info.tag;
  return { status, info, visible, recheck: () => run(true), dismiss };
}
