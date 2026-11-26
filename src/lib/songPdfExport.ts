import JSZip from 'jszip';
import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from 'pdf-lib';
import type { ChordSegment, ParsedLine, Song } from '../types';
import { convertChordNotation, lineHasChords, parseChordPro, transposeChord, type ChordNotation } from '../utils/chordParser';
import { formatDuration } from '../utils/duration';
import { resolveColumns, type PrintTypographySettings } from '../utils/printTypography';

export interface SongPdfOptions {
  settings: PrintTypographySettings;
  transpose?: number;
  notation?: ChordNotation;
  /** Optional 1-based track number shown before the title (e.g. from a setlist). */
  setlistIndex?: number;
  /** Optional setlist note shown under the header. */
  setlistNote?: string;
}

interface PageDimensions {
  width: number;
  height: number;
}

const PAGE_DIMS: Record<'a4' | 'letter', PageDimensions> = {
  a4: { width: 595.28, height: 841.89 },
  letter: { width: 612, height: 792 },
};

const SECTION_LABELS: Record<string, string> = {
  verse: 'Verse',
  chorus: 'Chorus',
  intro: 'Intro',
  bridge: 'Bridge',
  pre_chorus: 'Pre-Chorus',
  interlude: 'Interlude',
  solo: 'Solo',
  outro: 'Outro',
};

/**
 * Standard PDF fonts (Helvetica/Times/Courier) use WinAnsi encoding (Latin-1).
 * Replace common musical/typographic characters so `drawText` never throws.
 */
export function sanitizeWinAnsi(input: string): string {
  const mapped = input
    .replace(/\u266F/g, '#') // ♯
    .replace(/\u266D/g, 'b') // ♭
    .replace(/\u266E/g, '')  // ♮
    .replace(/[\u2013\u2014\u2212]/g, '-') // en-dash, em-dash, minus
    .replace(/\u2026/g, '...')
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201C\u201D]/g, '"')
    .replace(/\u00A0/g, ' ');

  let out = '';
  for (let i = 0; i < mapped.length; i++) {
    const code = mapped.charCodeAt(i);
    if ((code >= 0x20 && code <= 0x7e) || (code >= 0xa0 && code <= 0xff)) {
      out += mapped[i];
    } else if (code === 0x09) {
      out += '  ';
    }
  }
  return out;
}

function pickPdfFontPair(fontFamily: string): { regular: StandardFonts; bold: StandardFonts } {
  const lower = fontFamily.toLowerCase();
  if (lower.includes('mono') || lower.includes('courier')) {
    return { regular: StandardFonts.Courier, bold: StandardFonts.CourierBold };
  }
  if (lower.includes('georgia') || lower.includes('palatino') || (lower.includes('serif') && !lower.includes('sans-serif'))) {
    return { regular: StandardFonts.TimesRoman, bold: StandardFonts.TimesRomanBold };
  }
  return { regular: StandardFonts.Helvetica, bold: StandardFonts.HelveticaBold };
}

function songMetaLine(song: Song, transpose: number): string {
  const parts: string[] = [];
  if (song.key) {
    const effectiveKey = transpose === 0 ? song.key : transposeChord(song.key, transpose);
    parts.push(`Key ${effectiveKey}`);
  } else if (transpose !== 0) {
    parts.push(`${transpose > 0 ? '+' : ''}${transpose} semitones`);
  }
  if (song.capo && song.capo > 0) parts.push(`Capo ${song.capo}`);
  if (song.tempo) parts.push(`${song.tempo} BPM`);
  if (song.timeSignature) parts.push(song.timeSignature);
  if (song.durationSeconds) parts.push(formatDuration(song.durationSeconds));
  return parts.join(' · ');
}

type RenderItem =
  | { kind: 'section'; label: string }
  | { kind: 'chord-lyric'; segments: ChordSegment[]; hasChords: boolean }
  | { kind: 'empty' }
  | { kind: 'mono-block'; label?: string; lines: string[] };

function flattenLines(lines: ParsedLine[]): RenderItem[] {
  const items: RenderItem[] = [];

  const walk = (list: ParsedLine[]) => {
    for (const line of list) {
      if (line.type === 'section') {
        const label = line.sectionLabel || SECTION_LABELS[line.sectionType ?? ''] || line.sectionType || '';
        if (label) items.push({ kind: 'section', label });
        if (line.sectionLines) walk(line.sectionLines);
        items.push({ kind: 'empty' });
      } else if (line.type === 'chord-lyric') {
        items.push({
          kind: 'chord-lyric',
          segments: line.segments ?? [],
          hasChords: lineHasChords(line),
        });
      } else if (line.type === 'empty') {
        items.push({ kind: 'empty' });
      } else if (line.type === 'tab') {
        items.push({ kind: 'mono-block', label: 'Tab', lines: line.tabLines ?? [] });
      } else if (line.type === 'strum') {
        items.push({ kind: 'mono-block', label: line.strumLabel || 'Strum', lines: line.strumLines ?? [] });
      } else if (line.type === 'directive' && line.directive) {
        const dir = line.directive;
        if (dir === 'comment' || dir === 'c' || dir === 'comment_italic' || dir === 'ci' || dir === 'comment_box' || dir === 'cb') {
          if (line.directiveValue) items.push({ kind: 'section', label: line.directiveValue });
        } else if (dir in SECTION_LABELS) {
          items.push({ kind: 'section', label: SECTION_LABELS[dir] });
        }
      }
    }
  };

  walk(lines);
  while (items.length > 0 && items[items.length - 1].kind === 'empty') {
    items.pop();
  }
  return items;
}

interface MeasuredSeg {
  chord: string;
  lyric: string;
  width: number;
}

function measureSegments(
  segments: ChordSegment[],
  transpose: number,
  notation: ChordNotation,
  showChords: boolean,
  lyricFont: PDFFont,
  lyricPt: number,
  chordFont: PDFFont,
  chordPt: number,
): MeasuredSeg[] {
  const chordPad = chordPt * 0.45;
  return segments.map((seg) => {
    const rawChord = showChords && seg.chord
      ? convertChordNotation(transpose ? transposeChord(seg.chord, transpose) : seg.chord, notation)
      : '';
    const chord = sanitizeWinAnsi(rawChord);
    const lyric = sanitizeWinAnsi(seg.lyric);
    const chordW = chord ? chordFont.widthOfTextAtSize(chord, chordPt) + chordPad : 0;
    const lyricW = lyric ? lyricFont.widthOfTextAtSize(lyric, lyricPt) : 0;
    return { chord, lyric, width: Math.max(chordW, lyricW) };
  });
}

function wrapMeasuredSegments(
  segs: MeasuredSeg[],
  maxWidth: number,
  lyricFont: PDFFont,
  lyricPt: number,
): MeasuredSeg[][] {
  if (segs.length === 0) return [[]];

  // Break overly wide plain-lyric segments at word boundaries so long lines
  // without chords never bleed into the neighbouring column.
  const expanded: MeasuredSeg[] = [];
  for (const seg of segs) {
    if (!seg.chord && seg.width > maxWidth && seg.lyric.includes(' ')) {
      const words = seg.lyric.split(/(\s+)/);
      let chunk = '';
      for (const word of words) {
        const candidate = chunk + word;
        if (chunk && lyricFont.widthOfTextAtSize(candidate, lyricPt) > maxWidth) {
          expanded.push({
            chord: '',
            lyric: chunk.trimEnd(),
            width: lyricFont.widthOfTextAtSize(chunk.trimEnd(), lyricPt),
          });
          chunk = word.trimStart();
        } else {
          chunk = candidate;
        }
      }
      if (chunk) {
        expanded.push({
          chord: '',
          lyric: chunk,
          width: lyricFont.widthOfTextAtSize(chunk, lyricPt),
        });
      }
    } else {
      expanded.push(seg);
    }
  }

  const rows: MeasuredSeg[][] = [];
  let current: MeasuredSeg[] = [];
  let rowW = 0;

  for (const seg of expanded) {
    if (current.length > 0 && rowW + seg.width > maxWidth) {
      rows.push(current);
      current = [seg];
      rowW = seg.width;
    } else {
      current.push(seg);
      rowW += seg.width;
    }
  }
  if (current.length > 0) rows.push(current);
  return rows;
}

interface PdfLayoutMetrics {
  cols: 1 | 2 | 3;
  lyricPt: number;
  chordPt: number;
}

function simulatePageCount(
  items: RenderItem[],
  cols: 1 | 2 | 3,
  lyricPt: number,
  chordPt: number,
  dims: PageDimensions,
  margin: number,
  firstPageTopY: number,
  transpose: number,
  notation: ChordNotation,
  showChords: boolean,
  lyricFont: PDFFont,
  chordFont: PDFFont,
): number {
  const colGap = cols > 1 ? 20 : 0;
  const colWidth = (dims.width - margin * 2 - colGap * (cols - 1)) / cols;
  const sectionPt = Math.max(7, lyricPt * 0.85);
  const lyricLineH = lyricPt * 1.3;
  const chordLineH = chordPt * 1.16;
  const emptyH = lyricPt * 0.65;

  let pages = 1;
  let colIndex = 0;
  let colTopY = firstPageTopY;
  let y = colTopY;

  const advance = () => {
    colIndex++;
    if (colIndex >= cols) {
      pages++;
      colIndex = 0;
      colTopY = dims.height - margin;
    }
    y = colTopY;
  };

  const ensure = (needed: number) => {
    if (y - needed < margin && y < colTopY - 1) {
      advance();
    }
  };

  const estimateHeight = (item: RenderItem): number => {
    if (item.kind === 'empty') return emptyH;
    if (item.kind === 'section') return sectionPt * 1.55 + 4;
    if (item.kind === 'mono-block') {
      const monoPt = Math.max(6.5, lyricPt * 0.78);
      return (item.label ? sectionPt * 1.4 : 0) + item.lines.length * (monoPt * 1.2) + 6;
    }
    const measured = measureSegments(item.segments, transpose, notation, showChords, lyricFont, lyricPt, chordFont, chordPt);
    const rows = wrapMeasuredSegments(measured, colWidth, lyricFont, lyricPt);
    const drawChords = showChords && item.hasChords;
    const isChordOnly = drawChords && item.segments.every((s) => !s.lyric.trim());
    const rowH = (drawChords ? chordLineH : 0) + (isChordOnly ? 2 : lyricLineH) + 2;
    return rows.length * rowH;
  };

  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    if (item.kind === 'empty') {
      if (y < colTopY - 1) y -= emptyH;
      continue;
    }
    if (item.kind === 'section') {
      const next = items[i + 1];
      const nextH = next && next.kind !== 'empty' ? Math.min(estimateHeight(next), lyricLineH * 2 + chordLineH) : 0;
      ensure(sectionPt * 1.55 + 4 + nextH);
      if (y < colTopY - 1) y -= 4;
      y -= sectionPt + sectionPt * 0.55;
      continue;
    }
    if (item.kind === 'mono-block') {
      const monoPt = Math.max(6.5, lyricPt * 0.78);
      const blockH = (item.label ? sectionPt * 1.4 : 0) + item.lines.length * (monoPt * 1.2) + 6;
      ensure(blockH);
      if (item.label) y -= sectionPt + 4;
      for (let j = 0; j < item.lines.length; j++) {
        ensure(monoPt * 1.2);
        y -= monoPt * 1.15;
      }
      y -= 4;
      continue;
    }
    const measured = measureSegments(item.segments, transpose, notation, showChords, lyricFont, lyricPt, chordFont, chordPt);
    const rows = wrapMeasuredSegments(measured, colWidth, lyricFont, lyricPt);
    const drawChords = showChords && item.hasChords;
    const isChordOnly = drawChords && item.segments.every((s) => !s.lyric.trim());
    const rowH = (drawChords ? chordLineH : 0) + (isChordOnly ? 2 : lyricLineH) + 2;
    for (let r = 0; r < rows.length; r++) {
      ensure(rowH);
      y -= rowH;
    }
  }

  return pages;
}

/**
 * In Auto mode, picks the (columns, font-size) combination that fits the entire
 * song onto a single page at the largest readable font size (preferring fewer
 * columns on ties).
 */
function chooseAutoPdfLayout(
  items: RenderItem[],
  baseLyricPt: number,
  baseChordPt: number,
  dims: PageDimensions,
  margin: number,
  firstPageTopY: number,
  transpose: number,
  notation: ChordNotation,
  showChords: boolean,
  lyricFont: PDFFont,
  chordFont: PDFFont,
): PdfLayoutMetrics {
  const minLyricPt = 7.0;
  const minScale = Math.min(1, minLyricPt / baseLyricPt);

  let best: PdfLayoutMetrics | null = null;

  for (const cols of [1, 2, 3] as const) {
    // Fast check: fits at full base size?
    const fullPages = simulatePageCount(
      items, cols, baseLyricPt, baseChordPt, dims, margin, firstPageTopY,
      transpose, notation, showChords, lyricFont, chordFont,
    );
    if (fullPages === 1) {
      // Full size already fits — fewer columns always wins over more columns at same size.
      return { cols, lyricPt: baseLyricPt, chordPt: baseChordPt };
    }

    // Check if it fits at the minimum readable size for this column count.
    const minPages = simulatePageCount(
      items, cols, baseLyricPt * minScale, baseChordPt * minScale, dims, margin, firstPageTopY,
      transpose, notation, showChords, lyricFont, chordFont,
    );
    if (minPages > 1) continue;

    // Binary search for the largest scale in [minScale, 1] that fits on 1 page.
    let lo = minScale;
    let hi = 1;
    for (let iter = 0; iter < 10; iter++) {
      const mid = (lo + hi) / 2;
      const p = simulatePageCount(
        items, cols, baseLyricPt * mid, baseChordPt * mid, dims, margin, firstPageTopY,
        transpose, notation, showChords, lyricFont, chordFont,
      );
      if (p === 1) lo = mid;
      else hi = mid;
    }

    const candidate: PdfLayoutMetrics = {
      cols,
      lyricPt: Math.floor(baseLyricPt * lo * 20) / 20,
      chordPt: Math.floor(baseChordPt * lo * 20) / 20,
    };

    if (!best || candidate.lyricPt > best.lyricPt + 0.15) {
      best = candidate;
    }
  }

  return best ?? { cols: 2, lyricPt: baseLyricPt * minScale, chordPt: baseChordPt * minScale };
}

/**
 * Generates a standalone vector PDF document for a single song, applying the
 * chosen column layout, fonts, sizes, page size, and transpose.
 */
export async function generateSongPdfBytes(song: Song, options: SongPdfOptions): Promise<Uint8Array> {
  const { settings, transpose = 0, notation = 'anglo', setlistIndex, setlistNote } = options;
  const dims = PAGE_DIMS[settings.pageSize];

  const pdfDoc = await PDFDocument.create();
  pdfDoc.setTitle(sanitizeWinAnsi(song.title));
  if (song.artist) pdfDoc.setAuthor(sanitizeWinAnsi(song.artist));
  pdfDoc.setCreator('Gigboy');

  const lyricPair = pickPdfFontPair(settings.lyricFont);
  const chordPair = pickPdfFontPair(settings.chordFont);
  const lyricFont = await pdfDoc.embedFont(lyricPair.regular);
  const lyricBold = await pdfDoc.embedFont(lyricPair.bold);
  const chordFont = await pdfDoc.embedFont(chordPair.bold);
  const monoFont = await pdfDoc.embedFont(StandardFonts.Courier);

  // Convert CSS px sliders into clean typographic PDF points.
  const baseLyricPt = Math.max(7.5, settings.lyricSize * 0.78);
  const baseChordPt = Math.max(7, settings.chordSize * 0.78);
  const titlePt = Math.max(15, baseLyricPt * 1.45);
  const metaPt = Math.max(8.5, baseLyricPt * 0.82);

  const margin = 36;

  const ink = rgb(0.08, 0.08, 0.08);
  const muted = rgb(0.35, 0.35, 0.35);
  const chordColor = rgb(0.1, 0.32, 0.78);
  const ruleColor = rgb(0.82, 0.82, 0.82);

  let page: PDFPage = pdfDoc.addPage([dims.width, dims.height]);
  let headerY = dims.height - margin;

  // Song header
  const titleText = sanitizeWinAnsi(
    setlistIndex !== undefined ? `${setlistIndex}. ${song.title}` : song.title,
  );
  headerY -= titlePt;
  page.drawText(titleText, {
    x: margin,
    y: headerY,
    size: titlePt,
    font: lyricBold,
    color: ink,
  });

  const metaParts: string[] = [];
  if (song.artist) metaParts.push(song.artist);
  if (song.author) metaParts.push(`Written by ${song.author}`);
  const musicalMeta = songMetaLine(song, transpose);
  if (musicalMeta) metaParts.push(musicalMeta);

  if (metaParts.length > 0) {
    headerY -= metaPt + 5;
    page.drawText(sanitizeWinAnsi(metaParts.join(' · ')), {
      x: margin,
      y: headerY,
      size: metaPt,
      font: lyricFont,
      color: muted,
    });
  }

  if (setlistNote?.trim()) {
    headerY -= metaPt + 4;
    page.drawText(sanitizeWinAnsi(setlistNote.trim()), {
      x: margin,
      y: headerY,
      size: metaPt,
      font: lyricFont,
      color: muted,
    });
  }

  headerY -= 8;
  page.drawLine({
    start: { x: margin, y: headerY },
    end: { x: dims.width - margin, y: headerY },
    thickness: 0.75,
    color: ruleColor,
  });

  const items = flattenLines(parseChordPro(song.chordpro));
  let colTopY = headerY - 14;

  const layout: PdfLayoutMetrics = settings.columns === 'auto'
    ? chooseAutoPdfLayout(
      items, baseLyricPt, baseChordPt, dims, margin, colTopY,
      transpose, notation, settings.showChords, lyricFont, chordFont,
    )
    : {
      cols: resolveColumns(settings.columns, song.chordpro, settings.lyricSize),
      lyricPt: baseLyricPt,
      chordPt: baseChordPt,
    };

  const { cols, lyricPt, chordPt } = layout;
  const sectionPt = Math.max(7, lyricPt * 0.85);
  const colGap = cols > 1 ? 20 : 0;
  const contentWidth = dims.width - margin * 2;
  const colWidth = (contentWidth - colGap * (cols - 1)) / cols;

  let colIndex = 0;
  let y = colTopY;

  const colX = () => margin + colIndex * (colWidth + colGap);

  const advanceColumn = () => {
    colIndex++;
    if (colIndex >= cols) {
      page = pdfDoc.addPage([dims.width, dims.height]);
      colIndex = 0;
      colTopY = dims.height - margin;
    }
    y = colTopY;
  };

  const ensureSpace = (needed: number) => {
    if (y - needed < margin && y < colTopY - 1) {
      advanceColumn();
    }
  };

  const lyricLineH = lyricPt * 1.3;
  const chordLineH = chordPt * 1.16;
  const emptyH = lyricPt * 0.65;

  const estimateItemHeight = (item: RenderItem): number => {
    if (item.kind === 'empty') return emptyH;
    if (item.kind === 'section') return sectionPt * 1.55 + 4;
    if (item.kind === 'mono-block') {
      const monoPt = Math.max(6.5, lyricPt * 0.78);
      return (item.label ? sectionPt * 1.4 : 0) + item.lines.length * (monoPt * 1.2) + 6;
    }
    const measured = measureSegments(item.segments, transpose, notation, settings.showChords, lyricFont, lyricPt, chordFont, chordPt);
    const rows = wrapMeasuredSegments(measured, colWidth, lyricFont, lyricPt);
    const drawChords = settings.showChords && item.hasChords;
    const isChordOnly = drawChords && item.segments.every((s) => !s.lyric.trim());
    const rowH = (drawChords ? chordLineH : 0) + (isChordOnly ? 2 : lyricLineH) + 2;
    return rows.length * rowH;
  };

  for (let i = 0; i < items.length; i++) {
    const item = items[i];

    if (item.kind === 'empty') {
      if (y < colTopY - 1) {
        y -= emptyH;
      }
      continue;
    }

    if (item.kind === 'section') {
      const nextItem = items[i + 1];
      const nextH = nextItem && nextItem.kind !== 'empty' ? Math.min(estimateItemHeight(nextItem), lyricLineH * 2 + chordLineH) : 0;
      ensureSpace(sectionPt * 1.55 + 4 + nextH);
      if (y < colTopY - 1) y -= 4;
      y -= sectionPt;
      page.drawText(sanitizeWinAnsi(item.label.toUpperCase()), {
        x: colX(),
        y,
        size: sectionPt,
        font: lyricBold,
        color: muted,
      });
      y -= sectionPt * 0.55;
      continue;
    }

    if (item.kind === 'mono-block') {
      const monoPt = Math.max(6.5, lyricPt * 0.78);
      const blockH = (item.label ? sectionPt * 1.4 : 0) + item.lines.length * (monoPt * 1.2) + 6;
      ensureSpace(blockH);
      if (item.label) {
        y -= sectionPt;
        page.drawText(sanitizeWinAnsi(item.label.toUpperCase()), {
          x: colX(),
          y,
          size: sectionPt,
          font: lyricBold,
          color: muted,
        });
        y -= 4;
      }
      for (const rawLine of item.lines) {
        ensureSpace(monoPt * 1.2);
        y -= monoPt * 1.15;
        page.drawText(sanitizeWinAnsi(rawLine), {
          x: colX(),
          y,
          size: monoPt,
          font: monoFont,
          color: ink,
        });
      }
      y -= 4;
      continue;
    }

    // Chord-lyric line
    const measured = measureSegments(
      item.segments,
      transpose,
      notation,
      settings.showChords,
      lyricFont,
      lyricPt,
      chordFont,
      chordPt,
    );
    const rows = wrapMeasuredSegments(measured, colWidth, lyricFont, lyricPt);
    const drawChords = settings.showChords && item.hasChords;
    const isChordOnly = drawChords && item.segments.every((s) => !s.lyric.trim());

    for (const row of rows) {
      const rowH = (drawChords ? chordLineH : 0) + (isChordOnly ? 2 : lyricLineH) + 2;
      ensureSpace(rowH);

      const chordBaseline = drawChords ? y - chordPt : y;
      const lyricBaseline = drawChords ? chordBaseline - lyricPt * 1.12 : y - lyricPt;

      let cursorX = colX();
      for (const seg of row) {
        if (drawChords && seg.chord) {
          page.drawText(seg.chord, {
            x: cursorX,
            y: chordBaseline,
            size: chordPt,
            font: chordFont,
            color: chordColor,
          });
        }
        if (!isChordOnly && seg.lyric) {
          page.drawText(seg.lyric, {
            x: cursorX,
            y: lyricBaseline,
            size: lyricPt,
            font: lyricFont,
            color: ink,
          });
        }
        cursorX += seg.width;
      }

      y -= rowH;
    }
  }

  return pdfDoc.save();
}

export function buildSongPdfFilename(title: string, index?: number): string {
  const cleaned = title
    .replace(/[<>:"/\\|?*]+/g, '')
    .replace(/\s+/g, ' ')
    .trim() || 'Untitled';
  const prefix = index !== undefined ? `${String(index).padStart(2, '0')} - ` : '';
  return `${prefix}${cleaned}.pdf`;
}

/**
 * Generates a ZIP archive containing one standalone PDF file per song in the
 * setlist, numbered in setlist order (e.g. `01 - Song Title.pdf`).
 */
export async function exportSetlistPdfsZip(
  songs: Song[],
  options: {
    settings: PrintTypographySettings;
    songNotes?: Record<string, string>;
    notation?: ChordNotation;
  },
): Promise<Blob> {
  const zip = new JSZip();
  const usedNames = new Set<string>();

  for (let i = 0; i < songs.length; i++) {
    const song = songs[i];
    const bytes = await generateSongPdfBytes(song, {
      settings: options.settings,
      transpose: song.preferredTranspose ?? 0,
      notation: options.notation,
      setlistIndex: i + 1,
      setlistNote: options.songNotes?.[song.id],
    });

    let filename = buildSongPdfFilename(song.title, i + 1);
    let suffix = 2;
    while (usedNames.has(filename.toLowerCase())) {
      const base = filename.replace(/\.pdf$/i, '');
      filename = `${base} (${suffix++}).pdf`;
    }
    usedNames.add(filename.toLowerCase());
    zip.file(filename, bytes);
  }

  return zip.generateAsync({ type: 'blob' });
}
