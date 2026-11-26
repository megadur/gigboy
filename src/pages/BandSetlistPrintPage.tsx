import { useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ArrowLeft, FileArchive, FileDown, Printer } from 'lucide-react';
import toast from '../utils/anchoredToast';
import { useBands } from '../context/BandsContext';
import type { Song } from '../types';
import ChordDisplay from '../components/ChordDisplay';
import LanguageBadge from '../components/LanguageBadge';
import PrintStyleControls from '../components/PrintStyleControls';
import { useDocumentTitle } from '../hooks/useDocumentTitle';
import { formatDuration } from '../utils/duration';
import { saveBlob } from '../lib/download';
import { buildSongPdfFilename, exportSetlistPdfsZip, generateSongPdfBytes } from '../lib/songPdfExport';
import {
  buildPrintStyleVars,
  loadPrintTypography,
  resolveColumns,
  savePrintTypography,
  type PrintTypographySettings,
} from '../utils/printTypography';

type PrintLayout = 'sheet' | 'charts';

function songMetaLine(song: Song): string {
  const parts: string[] = [];
  if (song.key) parts.push(`Key ${song.key}`);
  if (song.capo && song.capo > 0) parts.push(`Capo ${song.capo}`);
  if (song.tempo) parts.push(`${song.tempo} BPM`);
  if (song.timeSignature) parts.push(song.timeSignature);
  if (song.durationSeconds) parts.push(formatDuration(song.durationSeconds));
  return parts.join(' · ');
}

export default function BandSetlistPrintPage() {
  const { bandId, setlistId } = useParams<{ bandId: string; setlistId: string }>();
  const {
    bands,
    bandSetlistsByBandId,
    bandSongsByBandId,
    refreshBandSetlists,
    refreshBandSongs,
  } = useBands();

  const [layout, setLayout] = useState<PrintLayout>('sheet');
  const [printSettings, setPrintSettings] = useState<PrintTypographySettings>(() => loadPrintTypography());
  const [exportingZip, setExportingZip] = useState(false);
  const [exportingSongId, setExportingSongId] = useState<string | null>(null);

  useEffect(() => {
    savePrintTypography(printSettings);
  }, [printSettings]);

  async function handleDownloadPdfsZip() {
    if (!setlist || setlistSongs.length === 0 || exportingZip) return;
    setExportingZip(true);
    try {
      const zipBlob = await exportSetlistPdfsZip(setlistSongs, {
        settings: printSettings,
        songNotes: setlist.songNotes,
      });
      const slug = setlist.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'setlist';
      await saveBlob(zipBlob, `${slug}-songs-pdf.zip`);
      toast.success(`Exported ${setlistSongs.length} PDF${setlistSongs.length === 1 ? '' : 's'} as ZIP.`);
    } catch (err) {
      toast.error(`Could not export PDFs: ${err instanceof Error ? err.message : err}`);
    } finally {
      setExportingZip(false);
    }
  }

  async function handleDownloadSinglePdf(song: Song, index: number) {
    if (!setlist || exportingSongId) return;
    setExportingSongId(song.id);
    try {
      const bytes = await generateSongPdfBytes(song, {
        settings: printSettings,
        transpose: song.preferredTranspose ?? 0,
        setlistIndex: index + 1,
        setlistNote: setlist.songNotes?.[song.id],
      });
      const blob = new Blob([bytes as BlobPart], { type: 'application/pdf' });
      await saveBlob(blob, buildSongPdfFilename(song.title, index + 1));
    } catch (err) {
      toast.error(`Could not export PDF: ${err instanceof Error ? err.message : err}`);
    } finally {
      setExportingSongId(null);
    }
  }

  const bandSetlists = useMemo(
    () => (bandId ? (bandSetlistsByBandId[bandId] ?? []) : []),
    [bandId, bandSetlistsByBandId],
  );
  const bandSongs = useMemo(
    () => (bandId ? (bandSongsByBandId[bandId] ?? []) : []),
    [bandId, bandSongsByBandId],
  );

  const band = useMemo(() => bands.find((entry) => entry.id === bandId) ?? null, [bands, bandId]);
  const setlist = useMemo(
    () => bandSetlists.find((entry) => entry.id === setlistId) ?? null,
    [bandSetlists, setlistId],
  );
  const songsById = useMemo(() => new Map(bandSongs.map((song) => [song.id, song])), [bandSongs]);
  const setlistSongs = useMemo(
    () => (setlist?.songIds ?? [])
      .map((songId) => songsById.get(songId))
      .filter((song): song is Song => Boolean(song)),
    [setlist?.songIds, songsById],
  );
  const totalDurationSeconds = useMemo(
    () => setlistSongs.reduce((sum, song) => sum + (song.durationSeconds ?? 0), 0),
    [setlistSongs],
  );

  useEffect(() => {
    if (!bandId) return;
    if (bandSetlists.length === 0) void refreshBandSetlists(bandId).catch(() => {});
    if (bandSongs.length === 0) void refreshBandSongs(bandId).catch(() => {});
  }, [bandId, bandSetlists.length, bandSongs.length, refreshBandSetlists, refreshBandSongs]);

  const backRoute = bandId && setlistId
    ? `/bands/${bandId}/setlists/${setlistId}`
    : '/bands';

  useDocumentTitle(setlist ? `${setlist.name} — Print` : 'Print setlist');

  if (!setlist) {
    return (
      <div className="not-found">
        <p>Setlist not found.</p>
        <Link to={backRoute} className="back-link"><ArrowLeft size={16} /> Back to setlist</Link>
      </div>
    );
  }

  return (
    <section className={`setlist-print song-print--${printSettings.pageSize}`}>
      {layout === 'charts' && (
        <style>{`@media print { @page { size: ${printSettings.pageSize} portrait; margin: 1.2cm; } }`}</style>
      )}
      <div className="setlist-print-toolbar song-print-toolbar">
        <div className="song-print-toolbar-top">
          <Link to={backRoute} className="back-link"><ArrowLeft size={15} /> Back</Link>
          <div className="setlist-print-toolbar-controls">
            <div className="setlist-print-layout-toggle" role="group" aria-label="Print layout">
              <button
                type="button"
                className={layout === 'sheet' ? 'is-active' : ''}
                onClick={() => setLayout('sheet')}
              >
                Setlist sheet
              </button>
              <button
                type="button"
                className={layout === 'charts' ? 'is-active' : ''}
                onClick={() => setLayout('charts')}
              >
                Full charts
              </button>
            </div>
            {layout === 'charts' && setlistSongs.length > 0 && (
              <button
                type="button"
                className="btn"
                onClick={() => { void handleDownloadPdfsZip(); }}
                disabled={exportingZip}
                title="Download one individual PDF file per song in a ZIP archive"
              >
                <FileArchive size={14} /> {exportingZip ? 'Creating ZIP…' : 'PDFs per song (.zip)'}
              </button>
            )}
            <button
              type="button"
              className="btn btn--concert"
              onClick={() => window.print()}
            >
              <Printer size={14} /> Print / Save as PDF
            </button>
          </div>
        </div>
        {layout === 'charts' && (
          <PrintStyleControls settings={printSettings} onChange={setPrintSettings} />
        )}
      </div>

      <div className={`setlist-print-sheet${layout === 'charts' ? ` song-print-sheet song-print-sheet--${printSettings.pageSize}` : ''}`}>
        <header className="setlist-print-header">
          {band?.name && <p className="setlist-print-band">{band.name}</p>}
          <h1>{setlist.name}</h1>
          <p className="setlist-print-count">
            {setlistSongs.length} song{setlistSongs.length === 1 ? '' : 's'}
            {totalDurationSeconds > 0 && ` · ${formatDuration(totalDurationSeconds)}`}
          </p>
        </header>

        {setlistSongs.length === 0 ? (
          <p>This setlist has no songs yet.</p>
        ) : layout === 'sheet' ? (
          <ol className="setlist-print-list">
            {setlistSongs.map((song) => {
              const meta = songMetaLine(song);
              const note = setlist.songNotes?.[song.id]?.trim();
              return (
                <li key={song.id}>
                  <span className="setlist-print-song-title">{song.title}</span>
                  {song.artist && <span className="setlist-print-song-artist"> — {song.artist}</span>}
                  {meta && <span className="setlist-print-song-meta"> ({meta})</span>}
                  {note && <span className="setlist-print-song-note">{note}</span>}
                </li>
              );
            })}
          </ol>
        ) : (
          <div className="setlist-print-charts">
            {setlistSongs.map((song, index) => {
              const resolvedCols = resolveColumns(printSettings.columns, song.chordpro, printSettings.lyricSize);
              const chartStyle = buildPrintStyleVars(printSettings, resolvedCols);
              return (
                <article key={song.id} className="setlist-print-chart" style={chartStyle}>
                  <header className="setlist-print-chart-header">
                    <div className="setlist-print-chart-title-row">
                      <h2>
                        <span className="setlist-print-chart-number">{index + 1}.</span> {song.title}
                      </h2>
                      <div className="setlist-print-chart-actions">
                        <button
                          type="button"
                          className="setlist-print-chart-action-btn"
                          onClick={() => { void handleDownloadSinglePdf(song, index); }}
                          disabled={exportingSongId === song.id}
                          title={`Download ${song.title} as PDF`}
                        >
                          <FileDown size={13} /> {exportingSongId === song.id ? 'Saving…' : 'PDF'}
                        </button>
                        <Link
                          to={`/songs/${song.id}/print`}
                          state={{ backTo: `/bands/${bandId}/setlists/${setlistId}/print`, bandId, transpose: song.preferredTranspose ?? 0 }}
                          className="setlist-print-chart-action-btn"
                          title={`Open ${song.title} in single-song print view`}
                        >
                          <Printer size={13} /> Print
                        </Link>
                      </div>
                    </div>
                    <p className="setlist-print-chart-meta">
                      {song.artist && <span>{song.artist}</span>}
                      <LanguageBadge code={song.language} />
                      {songMetaLine(song) && <span>{songMetaLine(song)}</span>}
                    </p>
                    {setlist.songNotes?.[song.id]?.trim() && (
                      <p className="setlist-print-chart-note">{setlist.songNotes[song.id]}</p>
                    )}
                  </header>
                  <div className="print-chart-columns">
                    <ChordDisplay
                      chordpro={song.chordpro}
                      transpose={song.preferredTranspose ?? 0}
                      showChords={printSettings.showChords}
                      hideMetaDirectives
                    />
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </div>
    </section>
  );
}
