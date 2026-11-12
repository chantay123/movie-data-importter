import { describe, expect, it } from 'vitest';
import {
  countMojibakeMarkers,
  decodeUtf8Lossless,
  looksLikeMojibake,
  recoverDeep,
  recoverMojibake,
  recoverOnce,
} from '../src/utils/encodingRecovery';

/**
 * Builds the mojibake of a UTF-8 text, exactly like a Windows-1252 decoding
 * of its bytes would.
 *
 * @param value - Correct UTF-8 text.
 * @returns The mangled text.
 */
function mangle(value: string): string {
  return Buffer.from(value, 'utf8').toString('latin1');
}

describe('encodingRecovery', () => {
  describe('looksLikeMojibake', () => {
    it('detects a mangled Vietnamese title', () => {
      expect(looksLikeMojibake(mangle('Bác Sĩ X'))).toBe(true);
    });

    it('detects a mangled Korean name', () => {
      expect(looksLikeMojibake(mangle('김지원'))).toBe(true);
    });

    it('does not flag a correct Vietnamese title', () => {
      expect(looksLikeMojibake('Bác Sĩ X')).toBe(false);
    });

    it('does not flag a correct Korean name', () => {
      expect(looksLikeMojibake('김지원')).toBe(false);
    });

    it('does not flag an ASCII text', () => {
      expect(looksLikeMojibake('Doctor X: Mafia in White')).toBe(false);
    });

    it('does not flag a correct Japanese text', () => {
      expect(looksLikeMojibake('理性的')).toBe(false);
    });
  });

  describe('recoverMojibake', () => {
    it('recovers a mangled Vietnamese title', () => {
      expect(recoverMojibake(mangle('Bác Sĩ X'))).toBe('Bác Sĩ X');
    });

    it('recovers a mangled Vietnamese sentence', () => {
      expect(recoverMojibake(mangle('66 phút/tập'))).toBe('66 phút/tập');
    });

    it('recovers a mangled placeholder', () => {
      expect(recoverMojibake(mangle('Đang cập nhật'))).toBe('Đang cập nhật');
    });

    it('recovers a mangled Korean name', () => {
      expect(recoverMojibake(mangle('김지원'))).toBe('김지원');
    });

    it('recovers a mangled Korean name with a CP1252 punctuation', () => {
      expect(recoverMojibake(mangle('손현주'))).toBe('손현주');
    });

    it('recovers a mangled text that lost its non-breaking spaces', () => {
      const mangled = mangle('Hà Nội').replace('\u00a0', ' ');

      expect(recoverMojibake(mangled)).toBe('Hà Nội');
    });

    it('recovers a mangled text that lost its non-breaking spaces', () => {
      const mangled = mangle('Việt Nam').replace('\u00a0', ' ');

      expect(recoverMojibake(mangled)).toBe('Việt Nam');
    });

    it('leaves a correct Vietnamese text untouched', () => {
      expect(recoverMojibake('Bác Sĩ X')).toBe('Bác Sĩ X');
    });

    it('leaves a correct Korean text untouched', () => {
      expect(recoverMojibake('김지원')).toBe('김지원');
    });

    it('leaves a correct Japanese text untouched', () => {
      expect(recoverMojibake('Doctor X')).toBe('Doctor X');
    });

    it('leaves a correct Chinese text untouched', () => {
      expect(recoverMojibake('电视剧')).toBe('电视剧');
    });

    it('leaves an ASCII text untouched', () => {
      expect(recoverMojibake('Doctor X')).toBe('Doctor X');
    });

    it('recovers a string that was mangled twice', () => {
      const once = recoverMojibake(mangle('Bác Sĩ X'));
      const twice = recoverMojibake(once);

      expect(twice).toBe('Bác Sĩ X');
    });

    it('never introduces a replacement character', () => {
      const recovered = recoverMojibake(mangle('Bác Sĩ X'));

      expect(recovered).not.toContain('\uFFFD');
    });

    it('returns an empty string unchanged', () => {
      expect(recoverMojibake('')).toBe('');
    });
  });

  describe('recoverOnce', () => {
    it('rebuilds the original UTF-8 bytes', () => {
      expect(recoverOnce(mangle('Bác Sĩ X'))).toBe('Bác Sĩ X');
    });

    it('returns null when a character cannot be represented', () => {
      expect(recoverOnce('한국어')).toBeNull();
    });
  });

  describe('countMojibakeMarkers', () => {
    it('counts the fingerprints of a mangled text', () => {
      expect(countMojibakeMarkers(mangle('Bác Sĩ X'))).toBeGreaterThan(0);
    });

    it('counts nothing in a correct text', () => {
      expect(countMojibakeMarkers('Bác Sĩ X')).toBe(0);
    });
  });

  describe('decodeUtf8Lossless', () => {
    it('decodes a valid UTF-8 buffer', () => {
      expect(decodeUtf8Lossless(Buffer.from('Bác Sĩ X', 'utf8'))).toBe('Bác Sĩ X');
    });

    it('keeps the invalid bytes instead of dropping them', () => {
      const decoded = decodeUtf8Lossless(Buffer.from([0xc3, 0x20, 0x61]));

      expect(decoded).toContain('a');
      expect(decoded).not.toContain('\uFFFD');
    });
  });

  describe('recoverDeep', () => {
    it('recovers every string of a nested structure', () => {
      const result = recoverDeep({
        title: mangle('Bác Sĩ X'),
        items: [mangle('Việt Nam'), { city: mangle('Hà Nội') }],
        count: 3,
      });

      expect(result).toEqual({
        title: 'Bác Sĩ X',
        items: ['Việt Nam', { city: 'Hà Nội' }],
        count: 3,
      });
    });

    it('does not mutate the original value', () => {
      const source = { title: mangle('Bác Sĩ X') };
      recoverDeep(source);

      expect(source.title).toBe(mangle('Bác Sĩ X'));
    });
  });
});
