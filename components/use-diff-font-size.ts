"use client";

import { useCallback, useEffect, useState } from "react";
import {
  DEFAULT_DIFF_FONT_SIZE_PT,
  DIFF_FONT_SIZE_STORAGE_KEY,
  MAX_DIFF_FONT_SIZE_PT,
  MIN_DIFF_FONT_SIZE_PT,
  parseDiffFontSizePt,
} from "@/lib/diff-font-size";

export interface UseDiffFontSizeResult {
  canDecrease: boolean;
  canIncrease: boolean;
  decreaseFontSize(): void;
  fontSizePt: number;
  increaseFontSize(): void;
  setFontSizePt(pt: number): void;
}

export function useDiffFontSize(): UseDiffFontSizeResult {
  const [fontSizePt, setFontSizePtState] = useState<number>(
    DEFAULT_DIFF_FONT_SIZE_PT,
  );

  const setFontSizePt = useCallback(
    (nextPt: number | ((current: number) => number)) => {
      setFontSizePtState((current) => {
        const resolved =
          typeof nextPt === "function" ? nextPt(current) : nextPt;
        const clamped = Math.max(
          MIN_DIFF_FONT_SIZE_PT,
          Math.min(MAX_DIFF_FONT_SIZE_PT, Math.round(resolved)),
        );
        try {
          window.localStorage.setItem(
            DIFF_FONT_SIZE_STORAGE_KEY,
            clamped.toString(),
          );
        } catch {
          // In-memory fallback if storage is restricted.
        }
        return clamped;
      });
    },
    [],
  );

  const increaseFontSize = useCallback(() => {
    setFontSizePt((current) => current + 1);
  }, [setFontSizePt]);

  const decreaseFontSize = useCallback(() => {
    setFontSizePt((current) => current - 1);
  }, [setFontSizePt]);

  useEffect(() => {
    function readStoredPreference() {
      let stored: string | null = null;
      try {
        stored = window.localStorage.getItem(DIFF_FONT_SIZE_STORAGE_KEY);
      } catch {
        // Fallback when storage is unavailable.
      }
      setFontSizePtState(parseDiffFontSizePt(stored));
    }

    function handleStorage(event: StorageEvent) {
      if (event.key === DIFF_FONT_SIZE_STORAGE_KEY || event.key === null) {
        readStoredPreference();
      }
    }

    readStoredPreference();
    window.addEventListener("storage", handleStorage);
    return () => window.removeEventListener("storage", handleStorage);
  }, []);

  return {
    canDecrease: fontSizePt > MIN_DIFF_FONT_SIZE_PT,
    canIncrease: fontSizePt < MAX_DIFF_FONT_SIZE_PT,
    decreaseFontSize,
    fontSizePt,
    increaseFontSize,
    setFontSizePt,
  };
}
