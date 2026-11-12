"use strict";
/**
 * Low level helpers used to locate and extract the JSON objects embedded in a
 * raw text payload.
 *
 * The scanner never relies on a greedy regular expression: it walks the text
 * character by character, keeps track of the string literals and of the escape
 * sequences, and therefore returns the exact boundaries of an object.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.findObjectEnd = findObjectEnd;
exports.findArrayEnd = findArrayEnd;
exports.findObjectsByKey = findObjectsByKey;
exports.parseJsonSlice = parseJsonSlice;
exports.isPlainObject = isPlainObject;
/**
 * Finds the end of the JSON object that starts at `start`.
 *
 * The scanner ignores every brace that belongs to a string literal and honours
 * the escape sequences `\"`, `\\`, `\/`, `\b`, `\f`, `\n`, `\r` and `\t`.
 *
 * @param text - Text to scan.
 * @param start - Index of the opening brace.
 * @returns The range of the object, or `null` when the object is not closed.
 */
function findObjectEnd(text, start) {
    if (text[start] !== '{') {
        return null;
    }
    let depth = 0;
    let inString = false;
    let escaped = false;
    for (let index = start; index < text.length; index += 1) {
        const character = text[index];
        if (escaped) {
            escaped = false;
            continue;
        }
        if (character === '\\') {
            escaped = true;
            continue;
        }
        if (character === '"') {
            inString = !inString;
            continue;
        }
        if (inString) {
            continue;
        }
        if (character === '{') {
            depth += 1;
            continue;
        }
        if (character === '}') {
            depth -= 1;
            if (depth === 0) {
                return { start, end: index + 1 };
            }
        }
    }
    return null;
}
/**
 * Finds the end of the JSON array that starts at `start`.
 *
 * @param text - Text to scan.
 * @param start - Index of the opening bracket.
 * @returns The range of the array, or `null` when the array is not closed.
 */
function findArrayEnd(text, start) {
    if (text[start] !== '[') {
        return null;
    }
    let depth = 0;
    let inString = false;
    let escaped = false;
    for (let index = start; index < text.length; index += 1) {
        const character = text[index];
        if (escaped) {
            escaped = false;
            continue;
        }
        if (character === '\\') {
            escaped = true;
            continue;
        }
        if (character === '"') {
            inString = !inString;
            continue;
        }
        if (inString) {
            continue;
        }
        if (character === '[') {
            depth += 1;
            continue;
        }
        if (character === ']') {
            depth -= 1;
            if (depth === 0) {
                return { start, end: index + 1 };
            }
        }
    }
    return null;
}
/**
 * Finds every occurrence of a `"key":` followed by an object.
 *
 * @param text - Text to scan.
 * @param key - Name of the key to look for.
 * @returns The list of ranges of the matching objects.
 */
function findObjectsByKey(text, key) {
    const needle = `"${key}":`;
    const ranges = [];
    let index = -1;
    while ((index = text.indexOf(needle, index + 1)) !== -1) {
        // The key must not be part of a longer name.
        const previous = index > 0 ? (text[index - 1] ?? '') : '';
        if (previous === '_' || previous === '.' || /[A-Za-z0-9]/.test(previous)) {
            continue;
        }
        const braceIndex = index + needle.length;
        // Only a direct object value is a candidate: a reference such as
        // `"movieData":"$25:props:..."` points to another row and is not a payload.
        if (text[braceIndex] !== '{') {
            continue;
        }
        const range = findObjectEnd(text, braceIndex);
        if (range) {
            ranges.push(range);
        }
    }
    return ranges;
}
/**
 * Parses a JSON substring.
 *
 * @param text - Text to parse.
 * @returns The parsed value, or `null` when the text is not valid JSON.
 */
function parseJsonSlice(text) {
    try {
        return JSON.parse(text);
    }
    catch {
        return null;
    }
}
/**
 * Checks whether a value is a plain object (and not an array or `null`).
 *
 * @param value - Value to test.
 * @returns `true` when the value is a plain object.
 */
function isPlainObject(value) {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}
//# sourceMappingURL=jsonScanner.js.map