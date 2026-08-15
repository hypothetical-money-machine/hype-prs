export const MIN_DIFF_FONT_SIZE_PT = 7;
export const MAX_DIFF_FONT_SIZE_PT = 18;
export const DEFAULT_DIFF_FONT_SIZE_PT = 13;

export const DIFF_FONT_SIZE_STORAGE_KEY = "hype-prs-diff-font-size-pt";

export function getDiffLineHeightPt(fontSizePt: number): number {
  return Math.round(fontSizePt * 1.55);
}

export function parseDiffFontSizePt(raw: unknown): number {
  if (typeof raw === "number" && Number.isFinite(raw)) {
    return Math.max(
      MIN_DIFF_FONT_SIZE_PT,
      Math.min(MAX_DIFF_FONT_SIZE_PT, Math.round(raw)),
    );
  }
  if (typeof raw === "string") {
    const parsed = parseInt(raw, 10);
    if (!Number.isNaN(parsed)) {
      return Math.max(
        MIN_DIFF_FONT_SIZE_PT,
        Math.min(MAX_DIFF_FONT_SIZE_PT, parsed),
      );
    }
  }
  return DEFAULT_DIFF_FONT_SIZE_PT;
}
