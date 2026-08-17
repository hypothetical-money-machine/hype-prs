"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  parseRefreshIntervalId,
  REFRESH_INTERVAL_STORAGE_KEY,
  refreshIntervalMilliseconds,
  writeRefreshIntervalId,
  type RefreshIntervalId,
} from "@/lib/inbox-cache";

function readStoredInterval(storage: Storage | null): RefreshIntervalId {
  if (!storage) return "off";
  let raw: string | null = null;
  try {
    raw = storage.getItem(REFRESH_INTERVAL_STORAGE_KEY);
  } catch {
    return "off";
  }
  return parseRefreshIntervalId(raw);
}

export interface UseRefreshIntervalResult {
  intervalId: RefreshIntervalId;
  milliseconds: number | null;
  setIntervalId(id: RefreshIntervalId): void;
}

export function useRefreshInterval(): UseRefreshIntervalResult {
  const [intervalId, setIntervalIdState] = useState<RefreshIntervalId>("off");

  useEffect(() => {
    function readAndApply() {
      setIntervalIdState(readStoredInterval(window.localStorage));
    }
    function handleStorage(event: StorageEvent) {
      if (
        event.key === REFRESH_INTERVAL_STORAGE_KEY ||
        event.key === null
      ) {
        readAndApply();
      }
    }
    readAndApply();
    window.addEventListener("storage", handleStorage);
    return () => window.removeEventListener("storage", handleStorage);
  }, []);

  const setIntervalId = useCallback((id: RefreshIntervalId) => {
    setIntervalIdState(id);
    writeRefreshIntervalId(window.localStorage, id);
  }, []);

  return {
    intervalId,
    milliseconds: refreshIntervalMilliseconds(intervalId),
    setIntervalId,
  };
}

export interface UseAutoRefreshOptions {
  enabled: boolean;
  intervalMs: number | null;
  refresh(): void | Promise<void>;
}

export interface UseAutoRefreshResult {
  nextRefreshAt: number | null;
}

// Run `refresh` on a fixed cadence while the tab is visible, only when
// `intervalMs` is a positive number. A backgrounded tab never fires the
// callback; the next refresh is scheduled for the next time the tab comes
// forward and the interval has elapsed.
export function useAutoRefresh({
  enabled,
  intervalMs,
  refresh,
}: UseAutoRefreshOptions): UseAutoRefreshResult {
  const refreshRef = useRef(refresh);
  useEffect(() => {
    refreshRef.current = refresh;
  }, [refresh]);

  const [nextRefreshAt, setNextRefreshAt] = useState<number | null>(null);

  useEffect(() => {
    if (!enabled || !intervalMs || intervalMs <= 0) {
      const disable = () => setNextRefreshAt(null);
      disable();
      return;
    }
    // Capture into a non-null local so the timer closures type-check.
    const cadenceMs: number = intervalMs;

    let timer: number | null = null;
    let nextAt = Date.now() + cadenceMs;
    const publishNext = () => setNextRefreshAt(nextAt);
    publishNext();

    function schedule() {
      if (document.hidden) {
        // Reschedule when the tab becomes visible again.
        return;
      }
      const remaining = Math.max(0, nextAt - Date.now());
      timer = window.setTimeout(() => {
        if (document.hidden) {
          // Try again once the tab comes back; until then, keep `nextAt` so
          // the user can still see when the next refresh will land.
          return;
        }
        void refreshRef.current();
        nextAt = Date.now() + cadenceMs;
        publishNext();
        schedule();
      }, remaining);
    }

    function handleVisibility() {
      if (timer !== null) {
        window.clearTimeout(timer);
        timer = null;
      }
      if (!document.hidden) {
        // Re-evaluate: if the deadline passed while hidden, refresh now.
        if (Date.now() >= nextAt) {
          void refreshRef.current();
          nextAt = Date.now() + cadenceMs;
          publishNext();
        }
        schedule();
      }
    }

    schedule();
    document.addEventListener("visibilitychange", handleVisibility);
    return () => {
      document.removeEventListener("visibilitychange", handleVisibility);
      if (timer !== null) window.clearTimeout(timer);
    };
  }, [enabled, intervalMs]);

  return { nextRefreshAt };
}
