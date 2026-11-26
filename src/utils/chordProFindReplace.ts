import { CHORD_TOKEN_RE } from './chordGrammar';

export type FindReplaceScope = 'both' | 'lyrics' | 'chords';

export interface FindReplaceOptions {
  find: string;
  replace: string;
  scope: FindReplaceScope;
  caseSensitive: boolean;
  wholeWord: boolean;
}

export interface FindReplaceResult {
  result: string;
  count: number;
}

const DIRECTIVE_RE = /^(\s*\{)([^:}]+)(?::([^}]*))?(\}\s*)$/;
const SECTION_START_LABEL_DIRECTIVE_RE = /^start_of_\w+$/i;
const TEXT_VALUE_DIRECTIVES = new Set(['comment', 'c', 'comment_italic', 'ci', 'comment_box', 'cb']);

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function buildRegex(find: string, caseSensitive: boolean, wholeWord: boolean): RegExp {
  let pattern = escapeRegex(find);
  if (wholeWord) {
    pattern = `\\b${pattern}\\b`;
  }
  return new RegExp(pattern, caseSensitive ? 'g' : 'gi');
}

function countRegexMatches(re: RegExp, text: string): number {
  let count = 0;
  re.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = re.exec(text)) !== null) {
    count++;
    if (match.index === re.lastIndex) re.lastIndex++;
  }
  return count;
}

function replaceRegexLiteral(text: string, re: RegExp, replacement: string): { text: string; count: number } {
  const count = countRegexMatches(re, text);
  if (count === 0) return { text, count: 0 };
  re.lastIndex = 0;
  // Use a replacer function so special `$` sequences in `replacement` are inserted literally.
  const next = text.replace(re, () => replacement);
  return { text: next, count };
}

interface LineToken {
  type: 'chord' | 'lyric';
  value: string;
}

/**
 * Splits a ChordPro lyric line into chord tokens (matching `CHORD_TOKEN_RE`,
 * consistent with `parseChordPro`) and plain lyric spans. Bracketed text that
 * is not a valid chord (e.g. `[repeat 2x]`) stays part of the lyric text.
 */
function tokenizeChordProLine(line: string): LineToken[] {
  const tokens: LineToken[] = [];
  let lyricStart = 0;
  let idx = 0;

  while (idx < line.length) {
    const open = line.indexOf('[', idx);
    if (open === -1) break;
    const close = line.indexOf(']', open + 1);
    if (close === -1) break;
    const inner = line.slice(open + 1, close);
    if (CHORD_TOKEN_RE.test(inner)) {
      if (open > lyricStart) {
        tokens.push({ type: 'lyric', value: line.slice(lyricStart, open) });
      }
      tokens.push({ type: 'chord', value: inner });
      idx = close + 1;
      lyricStart = idx;
    } else {
      idx = close + 1;
    }
  }

  if (lyricStart < line.length) {
    tokens.push({ type: 'lyric', value: line.slice(lyricStart) });
  }

  return tokens;
}

function isTabOrStrumStart(trimmedLower: string): 'tab' | 'strum' | null {
  if (trimmedLower === '{start_of_tab}' || trimmedLower === '{sot}') return 'tab';
  if (/^\{start_of_strum(?::[^}]*)?\}$/.test(trimmedLower)) return 'strum';
  return null;
}

function isTabOrStrumEnd(trimmedLower: string, blockType: 'tab' | 'strum'): boolean {
  if (blockType === 'tab') return trimmedLower === '{end_of_tab}' || trimmedLower === '{eot}';
  return trimmedLower === '{end_of_strum}';
}

function processChordPro(source: string, opts: FindReplaceOptions, apply: boolean): FindReplaceResult {
  if (!opts.find) return { result: source, count: 0 };

  const doLyrics = opts.scope === 'lyrics' || opts.scope === 'both';
  const doChords = opts.scope === 'chords' || opts.scope === 'both';
  const lyricRe = buildRegex(opts.find, opts.caseSensitive, opts.wholeWord);
  const chordRe = buildRegex(opts.find, opts.caseSensitive, false);

  const rawLines = source.split('\n');
  let totalCount = 0;
  let skipBlock: 'tab' | 'strum' | null = null;

  const outLines = rawLines.map((line) => {
    const trimmedLower = line.trim().toLowerCase();

    if (skipBlock) {
      if (isTabOrStrumEnd(trimmedLower, skipBlock)) {
        skipBlock = null;
      }
      return line;
    }

    const blockStart = isTabOrStrumStart(trimmedLower);
    if (blockStart) {
      skipBlock = blockStart;
      return line;
    }

    // Directives: only search/replace section labels & comment text under `lyrics`,
    // never mutating structural directive names like `{start_of_chorus}`.
    const dirMatch = line.match(DIRECTIVE_RE);
    if (dirMatch) {
      const [, prefix, rawName, rawValue, suffix] = dirMatch;
      const nameLower = rawName.trim().toLowerCase();
      if (
        doLyrics &&
        rawValue !== undefined &&
        (TEXT_VALUE_DIRECTIVES.has(nameLower) || SECTION_START_LABEL_DIRECTIVE_RE.test(nameLower))
      ) {
        if (apply) {
          const replaced = replaceRegexLiteral(rawValue, lyricRe, opts.replace);
          totalCount += replaced.count;
          if (replaced.count > 0) {
            return `${prefix}${rawName}:${replaced.text}${suffix}`;
          }
        } else {
          totalCount += countRegexMatches(lyricRe, rawValue);
        }
      }
      return line;
    }

    const tokens = tokenizeChordProLine(line);
    if (tokens.length === 0) return line;

    let lineChanged = false;
    const rebuilt = tokens.map((token) => {
      if (token.type === 'lyric') {
        if (!doLyrics) return token.value;
        if (apply) {
          const replaced = replaceRegexLiteral(token.value, lyricRe, opts.replace);
          if (replaced.count > 0) {
            totalCount += replaced.count;
            lineChanged = true;
            return replaced.text;
          }
        } else {
          totalCount += countRegexMatches(lyricRe, token.value);
        }
        return token.value;
      }

      // Chord token
      if (!doChords) return `[${token.value}]`;

      if (opts.wholeWord) {
        const equals = opts.caseSensitive
          ? token.value === opts.find
          : token.value.toLowerCase() === opts.find.toLowerCase();
        if (!equals) return `[${token.value}]`;
        totalCount++;
        if (apply) {
          lineChanged = true;
          const nextChord = opts.replace.trim();
          return nextChord ? `[${nextChord}]` : '';
        }
        return `[${token.value}]`;
      }

      if (apply) {
        const replaced = replaceRegexLiteral(token.value, chordRe, opts.replace);
        if (replaced.count > 0) {
          totalCount += replaced.count;
          lineChanged = true;
          const nextChord = replaced.text.trim();
          return nextChord ? `[${nextChord}]` : '';
        }
      } else {
        totalCount += countRegexMatches(chordRe, token.value);
      }
      return `[${token.value}]`;
    });

    return apply && lineChanged ? rebuilt.join('') : line;
  });

  return {
    result: apply ? outLines.join('\n') : source,
    count: totalCount,
  };
}

export function countChordProMatches(source: string, opts: FindReplaceOptions): number {
  return processChordPro(source, opts, false).count;
}

export function replaceChordPro(source: string, opts: FindReplaceOptions): FindReplaceResult {
  return processChordPro(source, opts, true);
}
