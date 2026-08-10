"use client";

import { Monitor, Moon, Sun, type LucideIcon } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import {
  explicitTheme,
  parseThemePreference,
  THEME_STORAGE_KEY,
  type ThemePreference,
} from "@/lib/theme";

const themeOptions: Array<{
  icon: LucideIcon;
  label: string;
  title: string;
  value: ThemePreference;
}> = [
  { icon: Sun, label: "Light", title: "Use light appearance", value: "light" },
  {
    icon: Monitor,
    label: "System",
    title: "Use system appearance",
    value: "system",
  },
  { icon: Moon, label: "Dark", title: "Use dark appearance", value: "dark" },
];

export function useThemePreference(): readonly [
  ThemePreference | null,
  (preference: ThemePreference) => void,
] {
  const [preference, setPreferenceState] =
    useState<ThemePreference | null>(null);

  const setPreference = useCallback((nextPreference: ThemePreference) => {
    setPreferenceState(nextPreference);
    applyThemePreference(nextPreference);
    try {
      window.localStorage.setItem(THEME_STORAGE_KEY, nextPreference);
    } catch {
      // The selected theme still applies when storage is unavailable.
    }
  }, []);

  useEffect(() => {
    function readStoredPreference() {
      let storedPreference: string | null = null;
      try {
        storedPreference = window.localStorage.getItem(THEME_STORAGE_KEY);
      } catch {
        // Use the system preference when storage is unavailable.
      }
      const nextPreference = parseThemePreference(storedPreference);
      setPreferenceState(nextPreference);
      applyThemePreference(nextPreference);
    }

    function handleStorage(event: StorageEvent) {
      if (event.key === THEME_STORAGE_KEY || event.key === null) {
        readStoredPreference();
      }
    }

    readStoredPreference();
    window.addEventListener("storage", handleStorage);
    return () => window.removeEventListener("storage", handleStorage);
  }, []);

  return [preference, setPreference] as const;
}

export function ThemeToggle({
  onChange,
  preference,
}: {
  onChange(preference: ThemePreference): void;
  preference: ThemePreference | null;
}) {
  return (
    <fieldset className="theme-toggle">
      <legend className="sr-only">Appearance</legend>
      {themeOptions.map(({ icon: Icon, label, title, value }) => (
        <label className="theme-option" key={value} title={title}>
          <input
            aria-label={label}
            checked={preference === value}
            name="appearance-theme"
            onChange={() => onChange(value)}
            type="radio"
            value={value}
          />
          <span aria-hidden="true">
            <Icon size={14} strokeWidth={2} />
          </span>
        </label>
      ))}
    </fieldset>
  );
}

function applyThemePreference(preference: ThemePreference) {
  const theme = explicitTheme(preference);
  if (theme) document.documentElement.dataset.theme = theme;
  else delete document.documentElement.dataset.theme;
}
