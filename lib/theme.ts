export const THEME_STORAGE_KEY = "hype-prs-theme";

export const THEME_PREFERENCES = ["light", "system", "dark"] as const;

export type ThemePreference = (typeof THEME_PREFERENCES)[number];
export type ExplicitTheme = Exclude<ThemePreference, "system">;

export function parseThemePreference(value: unknown): ThemePreference {
  return THEME_PREFERENCES.includes(value as ThemePreference)
    ? (value as ThemePreference)
    : "system";
}

export function explicitTheme(
  preference: ThemePreference,
): ExplicitTheme | null {
  return preference === "system" ? null : preference;
}
