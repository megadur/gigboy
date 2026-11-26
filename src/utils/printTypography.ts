import type { CSSProperties } from 'react';
import { readStoredString, writeStoredString } from '../lib/safeStorage';
import { parseChordPro } from './chordParser';
import type { ParsedLine } from '../types';

export type PrintColumnOption = 'auto' | 1 | 2 | 3;
export type PrintPageSize = 'a4' | 'letter';

export interface PrintTypographySettings {
  columns: PrintColumnOption;
  lyricFont: string;
  chordFont: string;
  lyricSize: number;
  chordSize: number;
  showChords: boolean;
  pageSize: PrintPageSize;
}

export interface FontOption {
  label: string;
  value: string;
}

export const LYRIC_FONT_OPTIONS: FontOption[] = [
  { label: 'System Sans', value: "system-ui, -apple-system, 'Segoe UI', sans-serif" },
  { label: 'Georgia (Serif)', value: "Georgia, 'Times New Roman', serif" },
  { label: 'Classic Serif', value: "'Palatino Linotype', Palatino, Georgia, serif" },
  { label: 'Helvetica / Arial', value: "'Helvetica Neue', Helvetica, Arial, sans-serif" },
  { label: 'Verdana', value: 'Verdana, Geneva, sans-serif' },
  { label: 'Monospace', value: "ui-monospace, 'SFMono-Regular', Menlo, Consolas, monospace" },
];

export const CHORD_FONT_OPTIONS: FontOption[] = [
  { label: 'Monospace', value: "ui-monospace, 'SFMono-Regular', Menlo, Consolas, monospace" },
  { label: 'Courier', value: "'Courier New', Courier, monospace" },
  { label: 'System Sans', value: "system-ui, -apple-system, 'Segoe UI', sans-serif" },
  { label: 'Helvetica / Arial', value: "'Helvetica Neue', Helvetica, Arial, sans-serif" },
  { label: 'Georgia (Serif)', value: "Georgia, 'Times New Roman', serif" },
];

export const DEFAULT_PRINT_TYPOGRAPHY: PrintTypographySettings = {
  columns: 'auto',
  lyricFont: LYRIC_FONT_OPTIONS[0].value,
  chordFont: CHORD_FONT_OPTIONS[0].value,
  lyricSize: 14,
  chordSize: 13,
  showChords: true,
  pageSize: 'a4',
};

const STORAGE_KEY = 'gigboy-print-typography-v1';

export function loadPrintTypography(): PrintTypographySettings {
  const raw = readStoredString(STORAGE_KEY);
  if (!raw) return { ...DEFAULT_PRINT_TYPOGRAPHY };
  try {
    const parsed = JSON.parse(raw) as Partial<PrintTypographySettings>;
    const columns: PrintColumnOption =
      parsed.columns === 'auto' || parsed.columns === 1 || parsed.columns === 2 || parsed.columns === 3
        ? parsed.columns
        : DEFAULT_PRINT_TYPOGRAPHY.columns;
    const lyricSize =
      typeof parsed.lyricSize === 'number' && parsed.lyricSize >= 10 && parsed.lyricSize <= 24
        ? parsed.lyricSize
        : DEFAULT_PRINT_TYPOGRAPHY.lyricSize;
    const chordSize =
      typeof parsed.chordSize === 'number' && parsed.chordSize >= 9 && parsed.chordSize <= 22
        ? parsed.chordSize
        : DEFAULT_PRINT_TYPOGRAPHY.chordSize;
    const pageSize: PrintPageSize =
      parsed.pageSize === 'a4' || parsed.pageSize === 'letter'
        ? parsed.pageSize
        : DEFAULT_PRINT_TYPOGRAPHY.pageSize;

    return {
      columns,
      lyricFont: typeof parsed.lyricFont === 'string' && parsed.lyricFont ? parsed.lyricFont : DEFAULT_PRINT_TYPOGRAPHY.lyricFont,
      chordFont: typeof parsed.chordFont === 'string' && parsed.chordFont ? parsed.chordFont : DEFAULT_PRINT_TYPOGRAPHY.chordFont,
      lyricSize,
      chordSize,
      showChords: typeof parsed.showChords === 'boolean' ? parsed.showChords : DEFAULT_PRINT_TYPOGRAPHY.showChords,
      pageSize,
    };
  } catch {
    return { ...DEFAULT_PRINT_TYPOGRAPHY };
  }
}

export function savePrintTypography(settings: PrintTypographySettings): void {
  writeStoredString(STORAGE_KEY, JSON.stringify(settings));
}

function collectLineMetrics(lines: ParsedLine[]): { visualLines: number; maxChars: number } {
  let visualLines = 0;
  let maxChars = 0;

  const walk = (list: ParsedLine[]) => {
    for (const line of list) {
      if (line.type === 'section') {
        visualLines += 1.5;
        if (line.sectionLines) walk(line.sectionLines);
      } else if (line.type === 'chord-lyric') {
        const hasChords = Boolean(line.segments?.some((s) => s.chord));
        visualLines += hasChords ? 1.85 : 1.1;
        const textLen = (line.segments ?? []).reduce((sum, s) => sum + Math.max(s.lyric.length, s.chord.length), 0);
        if (textLen > maxChars) maxChars = textLen;
      } else if (line.type === 'empty') {
        visualLines += 0.6;
      } else if (line.type === 'tab') {
        visualLines += (line.tabLines?.length ?? 0) + 1;
        maxChars = Math.max(maxChars, 55);
      } else if (line.type === 'strum') {
        visualLines += (line.strumLines?.length ?? 0) + 1.5;
      } else if (line.type === 'directive' && line.directive && !['title', 't', 'subtitle', 'st', 'artist'].includes(line.directive)) {
        visualLines += 1.2;
      }
    }
  };

  walk(lines);
  return { visualLines, maxChars };
}

/**
 * Picks 1, 2, or 3 columns for a song so it fits cleanly on a single page
 * without squeezing long lines into overly narrow columns.
 */
export function resolveAutoColumns(chordpro: string, lyricSize: number): 1 | 2 | 3 {
  const { visualLines, maxChars } = collectLineMetrics(parseChordPro(chordpro));
  // Rough capacity of a single A4/Letter portrait page at the chosen lyric size.
  const singleColLineBudget = Math.max(18, Math.round(520 / Math.max(10, lyricSize)));

  if (visualLines <= singleColLineBudget) return 1;

  // Approximate max characters that comfortably fit in a 2-col or 3-col strip.
  const twoColCharBudget = Math.round(620 / Math.max(10, lyricSize));
  const threeColCharBudget = Math.round(390 / Math.max(10, lyricSize));

  if (visualLines > singleColLineBudget * 1.9 && maxChars <= threeColCharBudget) {
    return 3;
  }
  if (maxChars <= twoColCharBudget) {
    return 2;
  }
  return 1;
}

export function resolveColumns(
  columns: PrintColumnOption,
  chordpro: string,
  lyricSize: number,
): 1 | 2 | 3 {
  if (columns === 'auto') {
    return resolveAutoColumns(chordpro, lyricSize);
  }
  return columns;
}

export function buildPrintStyleVars(
  settings: PrintTypographySettings,
  resolvedColumns: 1 | 2 | 3,
): CSSProperties {
  return {
    '--print-cols': String(resolvedColumns),
    '--print-lyric-font': settings.lyricFont,
    '--print-chord-font': settings.chordFont,
    '--print-lyric-size': `${settings.lyricSize}px`,
    '--print-chord-size': `${settings.chordSize}px`,
  } as CSSProperties;
}
