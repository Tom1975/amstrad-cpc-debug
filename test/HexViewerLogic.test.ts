import {
    isHexDigit, stripWS, hexCompact, parseSearchInput, getHexError,
} from '../src/HexViewerLogic';

const AUTO = 0, HEX = 1, TXT = 2;

// ── isHexDigit ───────────────────────────────────────────────────────────────

describe('isHexDigit', () => {
    test.each(['0','9','a','f','A','F','b','E'])('accepts %s', ch => {
        expect(isHexDigit(ch)).toBe(true);
    });
    test.each(['g','G','x',' ','-',''])('rejects %s', ch => {
        expect(isHexDigit(ch)).toBe(false);
    });
});

// ── stripWS ──────────────────────────────────────────────────────────────────

describe('stripWS', () => {
    test('removes spaces', ()      => expect(stripWS('CD 3E')).toBe('CD3E'));
    test('removes tabs',  ()       => expect(stripWS('CD\t3E')).toBe('CD3E'));
    test('removes CR/LF', ()       => expect(stripWS('CD\r\n3E')).toBe('CD3E'));
    test('no change on clean str', () => expect(stripWS('ABCD')).toBe('ABCD'));
    test('empty input',  ()        => expect(stripWS('')).toBe(''));
});

// ── hexCompact ───────────────────────────────────────────────────────────────

describe('hexCompact', () => {
    test('valid 1-byte',        () => expect(hexCompact('CD')).toBe('CD'));
    test('valid 2-byte spaced', () => expect(hexCompact('CD 3E')).toBe('CD3E'));
    test('valid 4-byte mixed',  () => expect(hexCompact('FF ED 3E 00')).toBe('FFED3E00'));
    test('odd digit count',     () => expect(hexCompact('C3 3')).toBeNull());
    test('non-hex character',   () => expect(hexCompact('GH')).toBeNull());
    test('single digit',        () => expect(hexCompact('C')).toBeNull());
    test('empty string',        () => expect(hexCompact('')).toBeNull());
    test('lowercase ok',        () => expect(hexCompact('cd 3e')).toBe('cd3e'));
});

// ── parseSearchInput — AUTO mode ──────────────────────────────────────────────

describe('parseSearchInput AUTO', () => {
    test('valid hex 2 bytes',     () =>
        expect(parseSearchInput('CD 3E', AUTO)).toEqual({ pattern: [0xCD, 0x3E] }));

    test('valid hex 1 byte',      () =>
        expect(parseSearchInput('FF', AUTO)).toEqual({ pattern: [0xFF] }));

    test('valid hex no spaces',   () =>
        expect(parseSearchInput('FFED', AUTO)).toEqual({ pattern: [0xFF, 0xED] }));

    test('text fallback',         () =>
        expect(parseSearchInput('hello', AUTO)).toEqual({
            pattern: [0x68, 0x65, 0x6C, 0x6C, 0x6F],
        }));

    test('empty input returns null', () =>
        expect(parseSearchInput('', AUTO)).toBeNull());

    test('whitespace-only returns null', () =>
        expect(parseSearchInput('   ', AUTO)).toBeNull());

    test('odd hex digits → text fallback', () =>
        expect(parseSearchInput('C3 3', AUTO)).toEqual({
            pattern: [0x43, 0x33, 0x20, 0x33],  // ASCII "C3 3"
        }));
});

// ── parseSearchInput — HEX mode ───────────────────────────────────────────────

describe('parseSearchInput HEX', () => {
    test('valid hex with space',  () =>
        expect(parseSearchInput('CD 3E', HEX)).toEqual({ pattern: [0xCD, 0x3E] }));

    test('odd digits → null',     () =>
        expect(parseSearchInput('CD 3', HEX)).toBeNull());

    test('non-hex char → null',   () =>
        expect(parseSearchInput('hello', HEX)).toBeNull());

    test('empty → null',          () =>
        expect(parseSearchInput('', HEX)).toBeNull());
});

// ── parseSearchInput — TXT mode ───────────────────────────────────────────────

describe('parseSearchInput TXT', () => {
    test('"hello" → ASCII codes', () =>
        expect(parseSearchInput('hello', TXT)).toEqual({
            pattern: [0x68, 0x65, 0x6C, 0x6C, 0x6F],
        }));

    test('"CD 3E" → ASCII codes including space', () =>
        expect(parseSearchInput('CD 3E', TXT)).toEqual({
            pattern: [0x43, 0x44, 0x20, 0x33, 0x45],
        }));

    test('empty → null',          () =>
        expect(parseSearchInput('', TXT)).toBeNull());
});

// ── getHexError ───────────────────────────────────────────────────────────────

describe('getHexError', () => {
    test('no error for valid 2-byte', () =>
        expect(getHexError('CD 3E')).toBeNull());

    test('no error for empty',        () =>
        expect(getHexError('')).toBeNull());

    test('odd digits → incomplete',   () =>
        expect(getHexError('CD 3')).toMatch(/manquant/));

    test('non-hex char → error msg',  () => {
        const err = getHexError('GH');
        expect(err).not.toBeNull();
        expect(err).toMatch(/G/);
    });

    test('space only → no error',     () =>
        expect(getHexError('   ')).toBeNull());
});
