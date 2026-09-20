import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { isTauriEnv } from "./store-api";

/** Cache data URLs per item+size so scrolling doesn't re-decode. */
const cache = new Map<string, string>();

/**
 * Local image preview as a data URL (backend reads only files inside
 * our own images dir). Returns null while loading or when unavailable.
 */
export function useImagePreview(
  item: { id: string; content_type: string; image_path?: string | null },
  maxSide = 160,
): string | null {
  const key = `${item.id}:${maxSide}`;
  const [url, setUrl] = useState<string | null>(() => cache.get(key) ?? null);

  useEffect(() => {
    if (item.content_type !== "image" || !item.image_path) return;
    const hit = cache.get(key);
    if (hit) {
      setUrl(hit);
      return;
    }
    if (!isTauriEnv()) return;
    let alive = true;
    invoke<string>("get_image_preview", { id: item.id, maxSide })
      .then((dataUrl) => {
        cache.set(key, dataUrl);
        if (alive) setUrl(dataUrl);
      })
      .catch(() => {
        /* keep placeholder */
      });
    return () => {
      alive = false;
    };
  }, [key, item.id, item.content_type, item.image_path, maxSide]);

  return url;
}
