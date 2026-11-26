import { describe, expect, it } from 'vitest';
import JSZip from 'jszip';
import { PDFDocument } from 'pdf-lib';
import {
  buildSongPdfFilename,
  exportSetlistPdfsZip,
  generateSongPdfBytes,
  sanitizeWinAnsi,
} from './songPdfExport';
import { DEFAULT_PRINT_TYPOGRAPHY } from '../utils/printTypography';
import type { Song } from '../types';

const makeSong = (overrides: Partial<Song> = {}): Song => ({
  id: 'song-1',
  title: 'Amazing Grace',
  artist: 'John Newton',
  language: 'en',
  tags: [],
  key: 'G',
  tempo: 92,
  timeSignature: '3/4',
  chordpro: `{start_of_verse: Verse 1}
[G]Amazing [C]grace, how [G]sweet the [D]sound
[G]That saved a [Em]wretch like [D]me
{end_of_verse}`,
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-01T00:00:00Z',
  ...overrides,
});

describe('songPdfExport', () => {
  it('sanitizes musical symbols and preserves German/Nordic Latin-1 characters', () => {
    expect(sanitizeWinAnsi('F♯m7 – B♭ · Über Öl Åre')).toBe('F#m7 - Bb · Über Öl Åre');
  });

  it('generates a valid single-song PDF document', async () => {
    const bytes = await generateSongPdfBytes(makeSong(), {
      settings: { ...DEFAULT_PRINT_TYPOGRAPHY, columns: 2, pageSize: 'a4' },
      transpose: 2,
      setlistIndex: 1,
      setlistNote: 'Acoustic intro',
    });

    const header = new TextDecoder().decode(bytes.slice(0, 5));
    expect(header).toBe('%PDF-');
    expect(bytes.length).toBeGreaterThan(500);
  });

  it('formats numbered filenames safely', () => {
    expect(buildSongPdfFilename('Song: A / B?', 3)).toBe('03 - Song A B.pdf');
    expect(buildSongPdfFilename('   ', 1)).toBe('01 - Untitled.pdf');
  });

  it('exports a setlist as a ZIP containing one PDF per song', async () => {
    const songs = [
      makeSong({ id: '1', title: 'Opening Song' }),
      makeSong({ id: '2', title: 'Über den Wolken' }),
    ];

    const blob = await exportSetlistPdfsZip(songs, {
      settings: DEFAULT_PRINT_TYPOGRAPHY,
      songNotes: { '1': 'Start quiet' },
    });

    const buf = await new Promise<ArrayBuffer>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as ArrayBuffer);
      reader.onerror = () => reject(reader.error);
      reader.readAsArrayBuffer(blob);
    });
    const zip = await JSZip.loadAsync(buf);
    const files = Object.keys(zip.files).sort();
    expect(files).toEqual([
      '01 - Opening Song.pdf',
      '02 - Über den Wolken.pdf',
    ]);

    const firstPdf = await zip.files[files[0]].async('uint8array');
    expect(new TextDecoder().decode(firstPdf.slice(0, 5))).toBe('%PDF-');
  });

  it('auto-fits a long 11-stanza ballad onto a single page', async () => {
    const stanza = `[A]Der Amtmann von Tondern, Henning Pogwisch,
Schlägt mit der Faust auf den Eichentisch:
Heut fahr ich selbst hinüber nach Sylt
Und hol mir mit eigner Hand Zins und Gült.
Gen Hörnum hat die Prunkbarke den Schnabel gewetzt,
Ihr folgen die Ewer, kriegsvolkbesetzt.
[E]Und ich höhn ihrem Wort:
Lewwer [D]duad [C]üs [A]Slaav!`;

    const longBallad = makeSong({
      title: 'Pidder Lüng',
      artist: 'Detlev von Liliencron',
      chordpro: Array.from({ length: 11 }, () => stanza).join('\n\n'),
    });

    const bytes = await generateSongPdfBytes(longBallad, {
      settings: { ...DEFAULT_PRINT_TYPOGRAPHY, columns: 'auto', pageSize: 'a4' },
      setlistIndex: 5,
    });

    const doc = await PDFDocument.load(bytes);
    expect(doc.getPageCount()).toBe(1);
  });
});
