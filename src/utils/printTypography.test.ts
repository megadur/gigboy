import { describe, expect, it } from 'vitest';
import {
  buildPrintStyleVars,
  DEFAULT_PRINT_TYPOGRAPHY,
  resolveAutoColumns,
  resolveColumns,
} from './printTypography';

describe('printTypography', () => {
  it('picks 1 column for short songs', () => {
    const shortSong = `[G]Line one\n[C]Line two\n[D]Line three`;
    expect(resolveAutoColumns(shortSong, 14)).toBe(1);
  });

  it('picks 2 columns for longer songs with compact lines', () => {
    const longSong = Array.from({ length: 28 }, (_, i) => `[G]Short line ${i + 1} [C]here`).join('\n');
    expect(resolveAutoColumns(longSong, 14)).toBe(2);
  });

  it('stays at 1 column when lines are very wide even if the song is long', () => {
    const wideSong = Array.from(
      { length: 30 },
      () => '[G]This is an extraordinarily long lyric line that would wrap terribly if squeezed into two columns',
    ).join('\n');
    expect(resolveAutoColumns(wideSong, 16)).toBe(1);
  });

  it('respects explicit column counts', () => {
    expect(resolveColumns(3, '[G]Short', 14)).toBe(3);
    expect(resolveColumns(1, '[G]Short', 14)).toBe(1);
  });

  it('builds CSS custom properties for layout and typography', () => {
    const vars = buildPrintStyleVars(
      { ...DEFAULT_PRINT_TYPOGRAPHY, lyricSize: 16, chordSize: 12 },
      2,
    ) as Record<string, string>;
    expect(vars['--print-cols']).toBe('2');
    expect(vars['--print-lyric-size']).toBe('16px');
    expect(vars['--print-chord-size']).toBe('12px');
  });
});
