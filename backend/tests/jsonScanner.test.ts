import { describe, expect, it } from 'vitest';
import {
  findArrayEnd,
  findObjectEnd,
  findObjectsByKey,
  isPlainObject,
  parseJsonSlice,
} from '../src/utils/jsonScanner';

describe('jsonScanner', () => {
  describe('findObjectEnd', () => {
    it('finds the end of a simple object', () => {
      const text = 'prefix {"a":1} suffix';
      const range = findObjectEnd(text, text.indexOf('{'));

      expect(range).toEqual({ start: 7, end: 14 });
      expect(text.slice(range!.start, range!.end)).toBe('{"a":1}');
    });

    it('ignores the braces inside a string', () => {
      const text = '{"a":"}"}';
      const range = findObjectEnd(text, 0);

      expect(text.slice(range!.start, range!.end)).toBe(text);
    });

    it('ignores the braces inside an escaped string', () => {
      const text = '{"a":"\\"}"}';
      const range = findObjectEnd(text, 0);

      expect(text.slice(range!.start, range!.end)).toBe(text);
    });

    it('handles nested objects', () => {
      const text = '{"a":{"b":{"c":1}},"d":2}';
      const range = findObjectEnd(text, 0);

      expect(text.slice(range!.start, range!.end)).toBe(text);
    });

    it('handles an escaped backslash before a quote', () => {
      const text = '{"a":"back\\\\","b":"}"}';
      const range = findObjectEnd(text, 0);

      expect(text.slice(range!.start, range!.end)).toBe(text);
    });

    it('returns null when the object is not closed', () => {
      expect(findObjectEnd('{"a":1', 0)).toBeNull();
    });

    it('returns null when the start is not an opening brace', () => {
      expect(findObjectEnd('"a"', 0)).toBeNull();
    });
  });

  describe('findArrayEnd', () => {
    it('finds the end of a nested array', () => {
      const text = '[1,[2,[3]],4]';
      const range = findArrayEnd(text, 0);

      expect(text.slice(range!.start, range!.end)).toBe(text);
    });

    it('ignores the brackets inside a string', () => {
      const text = '["a]b"]';
      const range = findArrayEnd(text, 0);

      expect(text.slice(range!.start, range!.end)).toBe(text);
    });

    it('returns null when the array is not closed', () => {
      expect(findArrayEnd('[1,2', 0)).toBeNull();
    });
  });

  describe('findObjectsByKey', () => {
    it('finds every object stored under the given key', () => {
      const text = '{"movieData":{"a":1}} trailing {"movieData":{"b":2}}';
      const ranges = findObjectsByKey(text, 'movieData');

      expect(ranges).toHaveLength(2);
      expect(text.slice(ranges[0]!.start, ranges[0]!.end)).toBe('{"a":1}');
      expect(text.slice(ranges[1]!.start, ranges[1]!.end)).toBe('{"b":2}');
    });

    it('ignores a reference that is not an object', () => {
      const text = '{"movieData":"$25:props:children"}';
      const ranges = findObjectsByKey(text, 'movieData');

      expect(ranges).toHaveLength(0);
    });

    it('ignores a key that is the suffix of another key', () => {
      const text = '{"otherMovieData":{"a":1}}';
      const ranges = findObjectsByKey(text, 'movieData');

      expect(ranges).toHaveLength(0);
    });
  });

  describe('parseJsonSlice', () => {
    it('parses a valid JSON string', () => {
      expect(parseJsonSlice('{"a":1}')).toEqual({ a: 1 });
    });

    it('returns null on an invalid JSON string', () => {
      expect(parseJsonSlice('{a:1}')).toBeNull();
    });
  });

  describe('isPlainObject', () => {
    it('accepts a plain object', () => {
      expect(isPlainObject({ a: 1 })).toBe(true);
    });

    it('rejects an array', () => {
      expect(isPlainObject([1])).toBe(false);
    });

    it('rejects null', () => {
      expect(isPlainObject(null)).toBe(false);
    });
  });
});
