/**
 * Detection and recovery of mojibake (mis-decoded UTF-8) in text payloads.
 *
 * A UTF-8 payload read as Windows-1252 turns every multi-byte sequence into
 * one or two Latin-1 characters. For instance the Vietnamese title `Bác Sĩ X`
 * becomes `BÃ¡c SÄ© X` and the Korean name `김지원` becomes `ê¹€ì§€ì›Ð`.
 *
 * The recovery relies on a structural property rather than on a list of
 * "suspicious" characters: the mangled text is always the UTF-8 bytes of the
 * original text, decoded as Windows-1252. The original bytes can therefore be
 * rebuilt by encoding the mangled text back to Windows-1252, and the original
 * text is obtained by decoding those bytes as UTF-8.
 *
 * The recovery is deliberately conservative:
 *   - it only runs on strings that carry a mojibake fingerprint,
 *   - a string that already contains Hangul, Kana or CJK ideographs is never
 *     touched, so correct Korean, Japanese or Chinese text is preserved,
 *   - a round is only accepted when it strictly reduces the number of
 *     fingerprints, so a partially broken string is never made worse,
 *   - a byte sequence that cannot be decoded is kept as a Latin-1 character
 *     instead of being dropped, so no data is ever lost,
 *   - no replacement character (`U+FFFD`) ever reaches the database.
 */

/**
 * Windows-1252 code points of the `0x80`–`0x9F` range.
 *
 * The five undefined slots (`0x81`, `0x8D`, `0x8F`, `0x90`, `0x9D`) are
 * mapped to the matching C1 control characters, exactly like the browsers do
 * when they fall back to Latin-1.
 */
const CP1252_HIGH: ReadonlyMap<number, number> = new Map([
  [0x80, 0x20ac],
  [0x81, 0x0081],
  [0x82, 0x201a],
  [0x83, 0x0192],
  [0x84, 0x201e],
  [0x85, 0x2026],
  [0x86, 0x2020],
  [0x87, 0x2021],
  [0x88, 0x02c6],
  [0x89, 0x2030],
  [0x8a, 0x0160],
  [0x8b, 0x2039],
  [0x8c, 0x0152],
  [0x8d, 0x008d],
  [0x8e, 0x017d],
  [0x8f, 0x008f],
  [0x90, 0x0090],
  [0x91, 0x2018],
  [0x92, 0x2019],
  [0x93, 0x201c],
  [0x94, 0x201d],
  [0x95, 0x2022],
  [0x96, 0x2013],
  [0x97, 0x2014],
  [0x98, 0x02dc],
  [0x99, 0x2122],
  [0x9a, 0x0161],
  [0x9b, 0x203a],
  [0x9c, 0x0153],
  [0x9d, 0x009d],
  [0x9e, 0x017e],
  [0x9f, 0x0178],
]);

/**
 * Reverse table: code point produced by Windows-1252 -> original byte.
 */
const CP1252_REVERSE: ReadonlyMap<number, number> = ((): ReadonlyMap<number, number> => {
  const table = new Map<number, number>();

  for (let byte = 0; byte <= 0xff; byte += 1) {
    table.set(byte, byte);
  }

  for (const [byte, codePoint] of CP1252_HIGH) {
    table.set(codePoint, byte);
  }

  return table;
})();

/**
 * Latin-1 letters that never appear in a Vietnamese, English or Korean
 * movie-title text.
 *
 * They are the letters a mangled UTF-8 lead byte produces: `Ã` for `0xC3`,
 * `Æ` for `0xC6`, `Â` for `0xC2`, ...
 */
const NON_VIETNAMESE_LEADS: string = '\\u00c2\\u00c3\\u00c4\\u00c5\\u00c6\\u00c7\\u00d0\\u00d8\\u00de\\u00df\\u00f8\\u00fc\\u00fe\\u00ff';

/**
 * Fingerprint of a Latin letter followed by a character of the Latin-1 range.
 *
 * `Ã¡` (the mangled `á`), `Ãª` (the mangled `ê`) and `á»` (the mangled `ạ`)
 * all match this pattern, while a legitimate Vietnamese text never does: the
 * second character is always a symbol or a control character.
 */
const FINGERPRINT_LETTER: RegExp = new RegExp(
  `[\\u00c2-\\u00f7][\\u0080-\\u00bf\\u00d7]`,
  'g',
);

/**
 * Fingerprint of a Latin letter followed by a Windows-1252 punctuation, e.g.
 * `â€™` (the mangled `’`) or `â€¦` (the mangled `…`).
 */
const FINGERPRINT_PUNCTUATION: RegExp = new RegExp(
  '[\\u00c2-\\u00f7][\\u20ac\\u201a\\u0192\\u201e\\u2026\\u2020\\u2021\\u02c6\\u2030\\u2039\\u203a\\u2018\\u2019\\u201c\\u201d\\u2022\\u2013\\u2014\\u02dc\\u2122\\u0160\\u0161\\u0152\\u0153\\u017d\\u017e\\u0178]',
  'g',
);

/**
 * Fingerprint of a letter that does not exist in Vietnamese followed by a
 * space.
 *
 * Some pipelines replace the non-breaking space `U+00A0` of the original text
 * by a plain space while the payload is mangled. The mangled lead byte is
 * then followed by a space instead of by the expected continuation byte,
 * which is a strong signal that the string was mis-decoded.
 */
const FINGERPRINT_LEAD_SPACE: RegExp = new RegExp(
  `[${NON_VIETNAMESE_LEADS}]\\u0020`,
  'g',
);

/**
 * Fingerprint made of the characters that never appear in a correctly decoded
 * Vietnamese, English or movie-title text: C1 control characters and the
 * Latin-1 symbols produced by the mis-decoding.
 */
const FINGERPRINT_SYMBOL: RegExp =
  /[\u0081\u008d\u008f\u0090\u009d\u00a2\u00a3\u00a5\u00a7\u00a9\u00aa\u00ab\u00ac\u00ad\u00ae\u00af\u00b0\u00b1\u00b2\u00b3\u00b4\u00b5\u00b6\u00b7\u00b8\u00b9\u00ba\u00bb\u00bc\u00bd\u00be\u00bf\u00d0\u0192\u02c6\u02dc\u0152\u0153\u0160\u0161\u0178\u017d\u017e\u201a\u201e\u2020\u2021\u2039\u203a\u2122\u20ac]/g;

/**
 * Characters that identify a genuinely non-Latin script.
 *
 * A string that carries one of them was decoded correctly and must never be
 * rewritten.
 */
const PROTECTED_SCRIPT_PATTERN =
  /[\u1100-\u11ff\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff\uac00-\ud7af\uff00-\uffef]/;

/**
 * Maximum number of recovery rounds applied to a single string.
 *
 * A payload can be mangled more than once, therefore the recovery is applied
 * iteratively. Every round has to improve the string, which bounds the number
 * of rounds naturally.
 */
const MAX_RECOVERY_ROUNDS = 3;

/**
 * Counts the mojibake fingerprints of a string.
 *
 * @param value - Text to inspect.
 * @returns The number of fingerprints.
 */
export function countMojibakeMarkers(value: string): number {
  if (typeof value !== 'string' || value.length === 0) {
    return 0;
  }

  const count = (pattern: RegExp): number => {
    pattern.lastIndex = 0;
    return value.match(pattern)?.length ?? 0;
  };

  return (
    count(FINGERPRINT_LETTER) +
    count(FINGERPRINT_PUNCTUATION) +
    count(FINGERPRINT_SYMBOL) +
    count(FINGERPRINT_LEAD_SPACE)
  );
}

/**
 * Checks whether a string looks like a mis-decoded UTF-8 payload.
 *
 * @param value - Text to inspect.
 * @returns `true` when the text carries the typical mojibake signatures.
 */
export function looksLikeMojibake(value: string): boolean {
  return countMojibakeMarkers(value) > 0;
}

/**
 * Checks whether a byte is the lead byte of a multi-byte UTF-8 sequence.
 *
 * @param byte - Byte to test.
 * @returns `true` when the byte starts a multi-byte sequence.
 */
function isUtf8Lead(byte: number): boolean {
  return byte >= 0xc2 && byte <= 0xf7;
}

/**
 * Converts a string back into the bytes it was decoded from.
 *
 * The `0xA0` byte (the non-breaking space) is special: some pipelines replace
 * it by a plain space while the payload is mangled. When a mangled lead byte
 * is followed by a space, the space is therefore restored as `0xA0`.
 *
 * @param value - Text to convert.
 * @returns The bytes, or `null` when a character cannot be represented.
 */
function toWindows1252Bytes(value: string): Buffer | null {
  const bytes: number[] = [];
  let pendingLead = false;

  for (const character of value) {
    const codePoint = character.codePointAt(0) ?? 0;

    if (codePoint < 0x80) {
      if (codePoint === 0x20 && pendingLead) {
        // The non-breaking space was replaced by a plain space.
        bytes.push(0xa0);
        pendingLead = false;
        continue;
      }

      bytes.push(codePoint);
      pendingLead = isUtf8Lead(codePoint);
      continue;
    }

    const byte = CP1252_REVERSE.get(codePoint);

    if (byte === undefined) {
      return null;
    }

    bytes.push(byte);
    pendingLead = isUtf8Lead(byte);
  }

  return Buffer.from(bytes);
}

/**
 * Decodes a buffer as UTF-8 without ever losing a byte.
 *
 * A strict decoder would replace every invalid sequence by `U+FFFD`, which
 * would silently corrupt the text. An invalid sequence is therefore emitted as
 * its Latin-1 characters instead, which keeps the round trip stable for the
 * strings that were already correct.
 *
 * @param bytes - Buffer to decode.
 * @returns The decoded text.
 */
export function decodeUtf8Lossless(bytes: Buffer): string {
  let result = '';
  let index = 0;

  while (index < bytes.length) {
    const lead = bytes[index] as number;

    if (lead < 0x80) {
      result += String.fromCharCode(lead);
      index += 1;
      continue;
    }

    let length = 0;
    let codePoint = 0;

    if ((lead & 0xe0) === 0xc0) {
      length = 2;
      codePoint = lead & 0x1f;
    } else if ((lead & 0xf0) === 0xe0) {
      length = 3;
      codePoint = lead & 0x0f;
    } else if ((lead & 0xf8) === 0xf0) {
      length = 4;
      codePoint = lead & 0x07;
    }

    let valid = length > 0;

    if (valid) {
      for (let offset = 1; offset < length; offset += 1) {
        const byte = bytes[index + offset];

        if (byte === undefined || (byte & 0xc0) !== 0x80) {
          valid = false;
          break;
        }

        codePoint = (codePoint << 6) | (byte & 0x3f);
      }
    }

    if (!valid) {
      // The sequence is invalid: the lead byte is kept as a Latin-1 character
      // so that no information is lost.
      result += String.fromCharCode(lead);
      index += 1;
      continue;
    }

    result += String.fromCodePoint(codePoint);
    index += length;
  }

  return result;
}

/**
 * Applies a single recovery round to a string.
 *
 * @param value - Text to recover.
 * @returns The recovered text, or `null` when the round cannot be applied.
 */
export function recoverOnce(value: string): string | null {
  const bytes = toWindows1252Bytes(value);

  if (!bytes) {
    return null;
  }

  return decodeUtf8Lossless(bytes);
}

/**
 * Recovers a UTF-8 payload that was decoded as Windows-1252 or Latin-1.
 *
 * The recovery is applied iteratively and every round is only accepted when it
 * strictly reduces the number of mojibake fingerprints, so a string that is
 * already correct is returned unchanged.
 *
 * @param value - Text to recover.
 * @returns The recovered text, or the original value when no recovery applies.
 */
export function recoverMojibake(value: string): string {
  if (typeof value !== 'string' || value.length === 0) {
    return value;
  }

  // A string that carries a genuine Korean, Japanese or Chinese character was
  // decoded correctly: it must not be rewritten.
  if (PROTECTED_SCRIPT_PATTERN.test(value)) {
    return value;
  }

  let current = value;
  let bestScore = countMojibakeMarkers(current);

  if (bestScore === 0) {
    return value;
  }

  for (let round = 0; round < MAX_RECOVERY_ROUNDS; round += 1) {
    const candidate = recoverOnce(current);

    if (!candidate || candidate === current) {
      break;
    }

    const score = countMojibakeMarkers(candidate);

    if (score >= bestScore) {
      break;
    }

    current = candidate;
    bestScore = score;

    if (bestScore === 0) {
      break;
    }
  }

  return current;
}

/**
 * Recursively applies the mojibake recovery to every string of a value.
 *
 * The original value is never mutated: a new structure is returned.
 *
 * @param value - Value to normalize.
 * @returns The normalized value.
 */
export function recoverDeep<T>(value: T): T {
  if (typeof value === 'string') {
    return recoverMojibake(value) as unknown as T;
  }

  if (Array.isArray(value)) {
    return value.map((entry) => recoverDeep(entry)) as unknown as T;
  }

  if (value && typeof value === 'object') {
    const result: Record<string, unknown> = {};

    for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
      result[key] = recoverDeep(entry);
    }

    return result as unknown as T;
  }

  return value;
}
