import { describe, expect, it } from 'vitest';
import { countChordProMatches, replaceChordPro } from './chordProFindReplace';

const SAMPLE = `{title: Amazing Grace}
{start_of_verse: Verse 1}
[G]Amazing [C]grace, how [G]sweet the [D7]sound
[Cmaj7]That saved a [G]wretch like [D7]me
{end_of_verse}
{start_of_tab}
e|--0--2--3--|
{end_of_tab}
{comment: Chorus Repeat}
[Cmaj7]Grace and [C]peace`;

describe('chordProFindReplace', () => {
  it('replaces chords only without touching lyrics when scope is chords', () => {
    const res = replaceChordPro(SAMPLE, {
      find: 'Cmaj7',
      replace: 'C',
      scope: 'chords',
      caseSensitive: false,
      wholeWord: true,
    });
    expect(res.count).toBe(2);
    expect(res.result).toContain('[C]That saved a [G]wretch');
    expect(res.result).toContain('[C]Grace and [C]peace');
    expect(res.result).not.toContain('[Cmaj7]');
  });

  it('replaces lyrics only without touching chord brackets when scope is lyrics', () => {
    const res = replaceChordPro('[G]Good [G]morning G', {
      find: 'G',
      replace: 'A',
      scope: 'lyrics',
      caseSensitive: true,
      wholeWord: true,
    });
    expect(res.count).toBe(1);
    expect(res.result).toBe('[G]Good [G]morning A');
  });

  it('replaces in both lyrics and chords when scope is both', () => {
    const res = replaceChordPro('[C]C is for [C]cat', {
      find: 'C',
      replace: 'D',
      scope: 'both',
      caseSensitive: true,
      wholeWord: true,
    });
    expect(res.count).toBe(3);
    expect(res.result).toBe('[D]D is for [D]cat');
  });

  it('supports whole-word chord matching so C does not match Cmaj7', () => {
    const countWhole = countChordProMatches('[C]one [Cmaj7]two [C]three', {
      find: 'C',
      replace: 'G',
      scope: 'chords',
      caseSensitive: true,
      wholeWord: true,
    });
    expect(countWhole).toBe(2);

    const countPartial = countChordProMatches('[C]one [Cmaj7]two [C]three', {
      find: 'C',
      replace: 'G',
      scope: 'chords',
      caseSensitive: true,
      wholeWord: false,
    });
    expect(countPartial).toBe(3);
  });

  it('removes a chord bracket cleanly when replaced with empty string', () => {
    const res = replaceChordPro('[G]Amazing [D7]grace', {
      find: 'D7',
      replace: '',
      scope: 'chords',
      caseSensitive: true,
      wholeWord: true,
    });
    expect(res.count).toBe(1);
    expect(res.result).toBe('[G]Amazing grace');
  });

  it('updates section labels and comments under lyrics scope without corrupting directives', () => {
    const res = replaceChordPro(SAMPLE, {
      find: 'Verse',
      replace: 'Stanza',
      scope: 'lyrics',
      caseSensitive: false,
      wholeWord: true,
    });
    expect(res.count).toBe(1);
    expect(res.result).toContain('{start_of_verse: Stanza 1}');
    expect(res.result).toContain('{end_of_verse}');
  });

  it('leaves tab blocks untouched', () => {
    const res = replaceChordPro(SAMPLE, {
      find: 'e',
      replace: 'X',
      scope: 'both',
      caseSensitive: true,
      wholeWord: false,
    });
    expect(res.result).toContain('e|--0--2--3--|');
  });
});
