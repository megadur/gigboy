import { useEffect, useMemo, useState } from 'react';
import { Link, Navigate, useLocation, useParams } from 'react-router-dom';
import { ArrowLeft, ChevronDown, ChevronUp, Printer, RotateCcw } from 'lucide-react';
import { useBands } from '../context/BandsContext';
import ChordDisplay from '../components/ChordDisplay';
import LanguageBadge from '../components/LanguageBadge';
import PrintStyleControls from '../components/PrintStyleControls';
import { useDocumentTitle } from '../hooks/useDocumentTitle';
import { transposeChord, type ChordNotation } from '../utils/chordParser';
import { formatDuration } from '../utils/duration';
import {
  buildPrintStyleVars,
  loadPrintTypography,
  resolveColumns,
  savePrintTypography,
  type PrintTypographySettings,
} from '../utils/printTypography';
import type { Song } from '../types';

type SongPrintLocationState = {
  backTo?: string;
  bandId?: string;
  transpose?: number;
  notation?: ChordNotation;
};

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

export default function SongPrintPage() {
  const { id } = useParams<{ id: string }>();
  const location = useLocation();
  const pageState = location.state as SongPrintLocationState | null;
  const { bandSongsByBandId } = useBands();

  const inferredBandId = id
    ? (Object.entries(bandSongsByBandId).find(([, bandSongs]) => bandSongs.some((s) => s.id === id))?.[0] ?? null)
    : null;
  const bandId = pageState?.bandId ?? inferredBandId ?? null;
  const bandSongs = bandId ? (bandSongsByBandId[bandId] ?? []) : [];
  const song = bandSongs.find((s) => s.id === id);

  const [transpose, setTranspose] = useState<number>(
    () => pageState?.transpose ?? song?.preferredTranspose ?? 0,
  );
  const notation: ChordNotation = pageState?.notation ?? 'anglo';
  const [settings, setSettings] = useState<PrintTypographySettings>(() => loadPrintTypography());

  useEffect(() => {
    savePrintTypography(settings);
  }, [settings]);

  useDocumentTitle(song ? `${song.title} — Print` : 'Print song');

  const resolvedCols = useMemo(
    () => (song ? resolveColumns(settings.columns, song.chordpro, settings.lyricSize) : 1),
    [song, settings.columns, settings.lyricSize],
  );

  const sheetStyle = useMemo(
    () => buildPrintStyleVars(settings, resolvedCols),
    [settings, resolvedCols],
  );

  if (!bandId) {
    return <Navigate to="/" replace />;
  }

  const backTo = pageState?.backTo ?? `/songs/${id}`;

  if (!song) {
    return (
      <div className="not-found">
        <p>Song not found.</p>
        <Link to={backTo} className="back-link"><ArrowLeft size={16} /> Back to song</Link>
      </div>
    );
  }

  const metaLine = songMetaLine(song, transpose);

  return (
    <section className={`setlist-print song-print song-print--${settings.pageSize}`}>
      <style>{`@media print { @page { size: ${settings.pageSize} portrait; margin: 1.2cm; } }`}</style>

      <div className="setlist-print-toolbar song-print-toolbar">
        <div className="song-print-toolbar-top">
          <Link to={backTo} className="back-link"><ArrowLeft size={15} /> Back</Link>
          <div className="setlist-print-toolbar-controls">
            <div className="song-print-transpose" role="group" aria-label="Transpose">
              <button
                type="button"
                onClick={() => setTranspose((t) => t - 1)}
                aria-label="Transpose down"
                title="Transpose down"
              >
                <ChevronDown size={15} />
              </button>
              <span className="song-print-transpose-label">
                {song.key
                  ? `Key ${transpose === 0 ? song.key : transposeChord(song.key, transpose)}`
                  : transpose === 0
                    ? 'Original'
                    : `${transpose > 0 ? '+' : ''}${transpose}`}
              </span>
              <button
                type="button"
                onClick={() => setTranspose((t) => t + 1)}
                aria-label="Transpose up"
                title="Transpose up"
              >
                <ChevronUp size={15} />
              </button>
              {transpose !== 0 && (
                <button
                  type="button"
                  onClick={() => setTranspose(0)}
                  aria-label="Reset transpose"
                  title="Reset transpose"
                >
                  <RotateCcw size={13} />
                </button>
              )}
            </div>

            <button
              type="button"
              className="btn btn--concert"
              onClick={() => window.print()}
            >
              <Printer size={14} /> Print / Save as PDF
            </button>
          </div>
        </div>

        <PrintStyleControls
          settings={settings}
          onChange={setSettings}
          resolvedColumns={settings.columns === 'auto' ? resolvedCols : undefined}
        />
      </div>

      <article
        className={`setlist-print-sheet song-print-sheet song-print-sheet--${settings.pageSize}`}
        style={sheetStyle}
      >
        <header className="setlist-print-chart-header song-print-header">
          <h1>{song.title}</h1>
          <p className="setlist-print-chart-meta">
            {song.artist && <span>{song.artist}</span>}
            {song.author && <span>Written by {song.author}</span>}
            <LanguageBadge code={song.language} />
            {metaLine && <span>{metaLine}</span>}
          </p>
        </header>

        <div className="print-chart-columns">
          <ChordDisplay
            chordpro={song.chordpro}
            transpose={transpose}
            showChords={settings.showChords}
            notation={notation}
            hideMetaDirectives
          />
        </div>
      </article>
    </section>
  );
}
