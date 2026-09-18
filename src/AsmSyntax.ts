// Low-level lexing helpers shared by the assembler-source parsers
// (SourceMap for line↔address mapping, DataSymbols for variable typing).

/** Strip a ; comment from a line, ignoring ; inside string literals. */
export function stripComment(line: string): string {
    let inStr = false, ch = '';
    for (let i = 0; i < line.length; i++) {
        const c = line[i];
        if (inStr)  { if (c === ch) inStr = false; }
        else if (c === '"' || c === "'") { inStr = true; ch = c; }
        else if (c === ';') return line.slice(0, i);
    }
    return line;
}

/**
 * Split a comma-separated operand list, respecting quoted strings and
 * nested parentheses.  "DB 1,'hello',0" → ["1", "'hello'", "0"]
 */
export function splitCSV(s: string): string[] {
    const out: string[] = [];
    let cur = '', depth = 0, inStr = false, ch = '';
    for (const c of s) {
        if (inStr) {
            cur += c;
            if (c === ch) inStr = false;
        } else if (c === '"' || c === "'") {
            inStr = true; ch = c; cur += c;
        } else if (c === '(' || c === '[') { depth++; cur += c; }
        else if (c === ')' || c === ']') { depth--; cur += c; }
        else if (c === ',' && depth === 0) { out.push(cur.trim()); cur = ''; }
        else { cur += c; }
    }
    if (cur.trim()) out.push(cur.trim());
    return out;
}

/** Parse a RASM numeric literal (#FF, 0FFH, 0b1010, %1010, 255). */
export function parseNumber(s: string): number | undefined {
    const t = s.trim();
    const h = t.match(/^#([0-9A-Fa-f]+)$/) ?? t.match(/^0x([0-9A-Fa-f]+)$/i) ?? t.match(/^([0-9A-Fa-f]+)[Hh]$/);
    if (h) return parseInt(h[1], 16);
    const b = t.match(/^%([01]+)$/) ?? t.match(/^([01]+)[Bb]$/) ?? t.match(/^0b([01]+)$/i);
    if (b) return parseInt(b[1], 2);
    const d = t.match(/^(\d+)$/);
    if (d) return parseInt(d[1], 10);
    return undefined;
}

/** True if the operand is a quoted string literal. */
export function isStringLiteral(s: string): boolean {
    const t = s.trim();
    return t.length >= 2 &&
        ((t.startsWith('"') && t.endsWith('"')) || (t.startsWith("'") && t.endsWith("'")));
}

/** Content of a quoted string literal, quotes removed. */
export function stringLiteralBody(s: string): string {
    return s.trim().slice(1, -1);
}

/**
 * Split a physical source line into its ':'-separated statements, respecting
 * quoted strings (RASM, like most Z80 assemblers, allows several instructions
 * on one line: "LD A,B : INC A"). Segments are NOT trimmed and may be empty
 * (an empty trailing segment means the line ended right after a ':').
 *
 * Must only be called on text that already had any leading "label:" prefixes
 * stripped, since a label definition also uses ':' — see SourceMap.parseFile.
 */
export function splitStatements(s: string): string[] {
    const out: string[] = [];
    let cur = '', inStr = false, ch = '';
    for (const c of s) {
        if (inStr) {
            cur += c;
            if (c === ch) inStr = false;
        } else if (c === '"' || c === "'") {
            inStr = true; ch = c; cur += c;
        } else if (c === ':') {
            out.push(cur);
            cur = '';
        } else {
            cur += c;
        }
    }
    out.push(cur);
    return out;
}
