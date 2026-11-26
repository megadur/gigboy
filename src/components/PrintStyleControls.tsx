import { RotateCcw } from 'lucide-react';
import {
  CHORD_FONT_OPTIONS,
  DEFAULT_PRINT_TYPOGRAPHY,
  LYRIC_FONT_OPTIONS,
  type PrintColumnOption,
  type PrintPageSize,
  type PrintTypographySettings,
} from '../utils/printTypography';

interface Props {
  settings: PrintTypographySettings;
  onChange: (next: PrintTypographySettings) => void;
  /** When `settings.columns === 'auto'`, optionally display the resolved column count (e.g. "Auto (2)"). */
  resolvedColumns?: 1 | 2 | 3;
}

const COLUMN_OPTIONS: PrintColumnOption[] = ['auto', 1, 2, 3];
const PAGE_SIZES: Array<{ value: PrintPageSize; label: string }> = [
  { value: 'a4', label: 'A4' },
  { value: 'letter', label: 'Letter' },
];

export default function PrintStyleControls({ settings, onChange, resolvedColumns }: Props) {
  function update<K extends keyof PrintTypographySettings>(key: K, value: PrintTypographySettings[K]) {
    onChange({ ...settings, [key]: value });
  }

  const isDefault =
    settings.columns === DEFAULT_PRINT_TYPOGRAPHY.columns
    && settings.lyricFont === DEFAULT_PRINT_TYPOGRAPHY.lyricFont
    && settings.chordFont === DEFAULT_PRINT_TYPOGRAPHY.chordFont
    && settings.lyricSize === DEFAULT_PRINT_TYPOGRAPHY.lyricSize
    && settings.chordSize === DEFAULT_PRINT_TYPOGRAPHY.chordSize
    && settings.showChords === DEFAULT_PRINT_TYPOGRAPHY.showChords
    && settings.pageSize === DEFAULT_PRINT_TYPOGRAPHY.pageSize;

  return (
    <div className="print-style-controls" aria-label="Print typography and layout">
      <div className="print-style-group">
        <span className="print-style-label">Columns</span>
        <div className="setlist-print-layout-toggle" role="group" aria-label="Columns">
          {COLUMN_OPTIONS.map((col) => (
            <button
              key={String(col)}
              type="button"
              className={settings.columns === col ? 'is-active' : ''}
              onClick={() => update('columns', col)}
              aria-pressed={settings.columns === col}
            >
              {col === 'auto'
                ? resolvedColumns
                  ? `Auto (${resolvedColumns})`
                  : 'Auto'
                : String(col)}
            </button>
          ))}
        </div>
      </div>

      <div className="print-style-group">
        <label className="print-style-label" htmlFor="print-lyric-font">Lyric font</label>
        <select
          id="print-lyric-font"
          className="print-style-select"
          value={settings.lyricFont}
          onChange={(e) => update('lyricFont', e.target.value)}
        >
          {LYRIC_FONT_OPTIONS.map((opt) => (
            <option key={opt.label} value={opt.value}>{opt.label}</option>
          ))}
        </select>
        <input
          type="range"
          min={10}
          max={24}
          step={1}
          value={settings.lyricSize}
          onChange={(e) => update('lyricSize', Number(e.target.value))}
          aria-label="Lyric font size"
          className="print-style-range"
        />
        <span className="print-style-value">{settings.lyricSize}px</span>
      </div>

      <div className="print-style-group">
        <label className="print-style-label" htmlFor="print-chord-font">Chord font</label>
        <select
          id="print-chord-font"
          className="print-style-select"
          value={settings.chordFont}
          onChange={(e) => update('chordFont', e.target.value)}
          disabled={!settings.showChords}
        >
          {CHORD_FONT_OPTIONS.map((opt) => (
            <option key={opt.label} value={opt.value}>{opt.label}</option>
          ))}
        </select>
        <input
          type="range"
          min={9}
          max={22}
          step={1}
          value={settings.chordSize}
          onChange={(e) => update('chordSize', Number(e.target.value))}
          aria-label="Chord font size"
          className="print-style-range"
          disabled={!settings.showChords}
        />
        <span className="print-style-value">{settings.chordSize}px</span>
      </div>

      <div className="print-style-group">
        <span className="print-style-label">Page</span>
        <div className="setlist-print-layout-toggle" role="group" aria-label="Page size">
          {PAGE_SIZES.map((p) => (
            <button
              key={p.value}
              type="button"
              className={settings.pageSize === p.value ? 'is-active' : ''}
              onClick={() => update('pageSize', p.value)}
              aria-pressed={settings.pageSize === p.value}
            >
              {p.label}
            </button>
          ))}
        </div>
      </div>

      <label className="print-style-check">
        <input
          type="checkbox"
          checked={settings.showChords}
          onChange={(e) => update('showChords', e.target.checked)}
        />
        Chords
      </label>

      {!isDefault && (
        <button
          type="button"
          className="print-style-reset"
          onClick={() => onChange({ ...DEFAULT_PRINT_TYPOGRAPHY })}
          title="Reset print layout defaults"
        >
          <RotateCcw size={13} /> Reset
        </button>
      )}
    </div>
  );
}
