import { useEffect, useMemo, useRef, useState } from 'react';
import { Replace, X } from 'lucide-react';
import toast from '../utils/anchoredToast';
import {
  countChordProMatches,
  replaceChordPro,
  type FindReplaceScope,
} from '../utils/chordProFindReplace';

interface Props {
  value: string;
  onReplace: (nextValue: string) => void;
  onClose: () => void;
  initialFind?: string;
}

const SCOPES: Array<{ value: FindReplaceScope; label: string }> = [
  { value: 'both', label: 'Both' },
  { value: 'lyrics', label: 'Lyrics' },
  { value: 'chords', label: 'Chords' },
];

export default function FindReplaceModal({ value, onReplace, onClose, initialFind = '' }: Props) {
  const [find, setFind] = useState(initialFind);
  const [replace, setReplace] = useState('');
  const [scope, setScope] = useState<FindReplaceScope>('both');
  const [caseSensitive, setCaseSensitive] = useState(false);
  const [wholeWord, setWholeWord] = useState(false);
  const findInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    findInputRef.current?.focus();
    findInputRef.current?.select();
  }, []);

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key !== 'Escape') return;
      // Capture phase + stopPropagation so this fires before AddSongForm's
      // window-level Escape handler (which navigates away from the edit page).
      e.stopPropagation();
      onClose();
    }
    window.addEventListener('keydown', onKeyDown, true);
    return () => window.removeEventListener('keydown', onKeyDown, true);
  }, [onClose]);

  const opts = useMemo(
    () => ({ find, replace, scope, caseSensitive, wholeWord }),
    [find, replace, scope, caseSensitive, wholeWord],
  );

  const matchCount = useMemo(() => countChordProMatches(value, opts), [value, opts]);

  function handleReplaceAll() {
    if (!find) {
      toast('Enter something to find');
      findInputRef.current?.focus();
      return;
    }
    const { result, count } = replaceChordPro(value, opts);
    if (count === 0) {
      toast('No matches found');
      return;
    }
    onReplace(result);
    toast.success(`Replaced ${count} match${count === 1 ? '' : 'es'}`);
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter') {
      e.preventDefault();
      handleReplaceAll();
    }
  }

  return (
    <div
      className="chord-finder-overlay"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div
        className="chord-finder-modal find-replace-modal"
        role="dialog"
        aria-modal="true"
        aria-label="Find and Replace"
      >
        <div className="chord-finder-modal-header">
          <span className="chord-finder-modal-title">
            <Replace size={15} /> Find &amp; Replace
          </span>
          <button
            type="button"
            className="chord-finder-modal-close"
            onClick={onClose}
            aria-label="Close"
          >
            <X size={16} />
          </button>
        </div>

        <div className="find-replace-body">
          <label className="find-replace-row">
            <span className="find-replace-label">Find</span>
            <input
              ref={findInputRef}
              type="text"
              value={find}
              onChange={(e) => setFind(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Text or chord (e.g. Cmaj7)"
              spellCheck={false}
            />
          </label>

          <label className="find-replace-row">
            <span className="find-replace-label">Replace</span>
            <input
              type="text"
              value={replace}
              onChange={(e) => setReplace(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Replace with…"
              spellCheck={false}
            />
          </label>

          <div className="find-replace-row">
            <span className="find-replace-label">Search in</span>
            <div className="find-replace-scope" role="group" aria-label="Search scope">
              {SCOPES.map((item) => (
                <button
                  key={item.value}
                  type="button"
                  className={scope === item.value ? 'is-active' : ''}
                  onClick={() => setScope(item.value)}
                  aria-pressed={scope === item.value}
                >
                  {item.label}
                </button>
              ))}
            </div>
          </div>

          <div className="find-replace-options">
            <label className="find-replace-check">
              <input
                type="checkbox"
                checked={caseSensitive}
                onChange={(e) => setCaseSensitive(e.target.checked)}
              />
              Match case
            </label>
            <label className="find-replace-check">
              <input
                type="checkbox"
                checked={wholeWord}
                onChange={(e) => setWholeWord(e.target.checked)}
              />
              Whole word / chord
            </label>
          </div>

          <div className="find-replace-actions">
            <span className="find-replace-count" role="status" aria-live="polite">
              {find ? (matchCount > 0 ? `${matchCount} match${matchCount === 1 ? '' : 'es'}` : 'No matches') : ''}
            </span>
            <button
              type="button"
              className="btn btn--primary"
              onClick={handleReplaceAll}
              disabled={!find || matchCount === 0}
            >
              Replace All
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
