import * as fs   from "fs";
import * as path from "path";
import { SymbolTable } from "./SymbolTable";

// ─── Utilities ────────────────────────────────────────────────────────────────

/** Strip a ; comment from a line, ignoring ; inside string literals. */
function stripComment(line: string): string {
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
function splitCSV(s: string): string[] {
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
function parseNumber(s: string): number | undefined {
    const t = s.trim();
    const h = t.match(/^#([0-9A-Fa-f]+)$/) ?? t.match(/^0x([0-9A-Fa-f]+)$/i) ?? t.match(/^([0-9A-Fa-f]+)[Hh]$/);
    if (h) return parseInt(h[1], 16);
    const b = t.match(/^%([01]+)$/) ?? t.match(/^([01]+)[Bb]$/) ?? t.match(/^0b([01]+)$/i);
    if (b) return parseInt(b[1], 2);
    const d = t.match(/^(\d+)$/);
    if (d) return parseInt(d[1], 10);
    return undefined;
}

// ─── Z80 instruction size ─────────────────────────────────────────────────────

const REG8  = new Set(['B','C','D','E','H','L','A','F']);
const REG16 = new Set(['BC','DE','HL','SP','AF']);

function isReg8(s: string):  boolean { return REG8.has(s)  || s === '(HL)'; }
function isReg16(s: string): boolean { return REG16.has(s); }

/** Returns true if the operand is an immediate (not a register / memory ref). */
function isImm(s: string): boolean {
    if (!s) return false;
    const u = s.toUpperCase();
    if (REG8.has(u) || REG16.has(u)) return false;
    if (u === '(HL)' || u === '(BC)' || u === '(DE)') return false;
    if (u.startsWith('(')) return false;
    return true;
}

/**
 * Size of a LD instruction from its uppercase operand string (no spaces).
 * Covers all standard + ED-prefix + IX/IY variants.
 */
function ldSize(ops: string): number {
    const parts = splitCSV(ops);
    if (parts.length < 2) return 1;
    const [dst, src] = [parts[0].toUpperCase(), parts[1].toUpperCase()];

    const dstIXY  = /^I[XY]$/.test(dst);
    const srcIXY  = /^I[XY]$/.test(src);
    const dstIXYd = /^\(I[XY]/.test(dst);  // (IX+d)
    const srcIXYd = /^\(I[XY]/.test(src);

    // LD IX/IY, nn  → DD/FD 21 nn nn  (4 bytes)
    if (dstIXY)  return 4;

    // LD (IX+d), r  → 3 ;  LD (IX+d), n → 4
    if (dstIXYd) return isReg8(src) ? 3 : 4;

    // LD r, (IX+d)  → 3
    if (srcIXYd) return 3;

    // LD I,A / LD R,A / LD A,I / LD A,R  → ED (2 bytes)
    if (/^[IR]$/.test(dst) || /^[IR]$/.test(src)) return 2;

    // (nn) absolute address — not (HL)/(BC)/(DE)/(IX)/(IY)
    const dstAbs = /^\(/.test(dst) && !/^\((HL|BC|DE|IX|IY)\)$/.test(dst);
    const srcAbs = /^\(/.test(src) && !/^\((HL|BC|DE|IX|IY)\)$/.test(src);

    if (dstAbs) {
        // LD (nn), BC/DE/SP  → ED prefix  (4 bytes)
        if (/^(BC|DE|SP)$/.test(src)) return 4;
        if (srcIXY) return 4;   // LD (nn), IX/IY
        return 3;               // LD (nn), A / LD (nn), HL
    }
    if (srcAbs) {
        if (/^(BC|DE|SP)$/.test(dst)) return 4;
        if (dstIXY) return 4;
        return 3;               // LD A,(nn) / LD HL,(nn)
    }

    // LD rr, nn  → 3 bytes
    if (isReg16(dst)) return 3;

    // LD r, n (8-bit immediate)  → 2 bytes
    if (isReg8(dst) && isImm(src)) return 2;

    // LD r, r'  → 1 byte
    return 1;
}

/**
 * Byte size of a single Z80 mnemonic + operands.
 * Returns null for unknown mnemonics (macro calls, unknown directives, …).
 */
function z80Size(mnem: string, rawOps: string): number | null {
    const m   = mnem.toUpperCase();
    const ops = rawOps.toUpperCase().replace(/\s/g, '');

    const ixyd = /\(I[XY][+\-]/.test(ops);          // (IX+d) or (IY+d)
    const ixy  = /\bI[XY]\b/.test(ops) && !ixyd;    // bare IX / IY

    switch (m) {
        // ── 1-byte, no effective operands ───────────────────────────────────
        case 'NOP': case 'RLCA': case 'RRCA': case 'RLA': case 'RRA':
        case 'DAA': case 'CPL':  case 'SCF':  case 'CCF': case 'HALT':
        case 'EXX': case 'DI':   case 'EI':
        case 'RET':    // RET cc is still 1 byte (condition encoded in opcode)
        case 'RST':    // RST 0..38H
            return 1;

        // ── 2-byte: ED-prefix block ──────────────────────────────────────────
        case 'NEG':  case 'RETN': case 'RETI': case 'RLD':  case 'RRD':
        case 'IM':
        case 'LDI':  case 'LDD':  case 'LDIR': case 'LDDR':
        case 'CPI':  case 'CPD':  case 'CPIR': case 'CPDR':
        case 'INI':  case 'IND':  case 'INIR': case 'INDR':
        case 'OUTI': case 'OUTD': case 'OTIR': case 'OTDR':
            return 2;

        // ── Relative jumps ───────────────────────────────────────────────────
        case 'JR': case 'DJNZ': return 2;

        // ── Absolute jumps ───────────────────────────────────────────────────
        case 'JP': {
            if (/^\(HL\)$/.test(ops)) return 1;    // JP (HL)
            if (/^\(I[XY]\)$/.test(ops)) return 2; // JP (IX) / JP (IY)
            return 3;                               // JP nn / JP cc,nn
        }
        case 'CALL': return 3;

        // ── EX ───────────────────────────────────────────────────────────────
        case 'EX':
            return /\(SP\),I[XY]/.test(ops) ? 2 : 1;

        // ── PUSH / POP ───────────────────────────────────────────────────────
        case 'PUSH': case 'POP': return ixy ? 2 : 1;

        // ── INC / DEC ────────────────────────────────────────────────────────
        case 'INC': case 'DEC':
            return ixyd ? 3 : ixy ? 2 : 1;

        // ── LD ───────────────────────────────────────────────────────────────
        case 'LD': return ldSize(ops);

        // ── ADD ──────────────────────────────────────────────────────────────
        case 'ADD': {
            const dst = ops.split(',')[0] ?? '';
            if (/^I[XY]$/.test(dst))    return 2; // ADD IX/IY, rr
            if (ixyd)                   return 3; // ADD A,(IX+d)
            const src = ops.split(',')[1] ?? '';
            return isImm(src) ? 2 : 1;            // ADD A,n (2) vs ADD A,r / ADD HL,rr (1)
        }

        // ── ADC / SBC ────────────────────────────────────────────────────────
        case 'ADC': case 'SBC': {
            if (/^HL,/.test(ops)) return 2;       // ADC/SBC HL,rr → ED prefix
            if (ixyd)             return 3;
            return isImm(ops.split(',')[1] ?? '') ? 2 : 1;
        }

        // ── SUB / AND / XOR / OR / CP ────────────────────────────────────────
        case 'SUB': case 'AND': case 'XOR': case 'OR': case 'CP': {
            if (ixyd) return 3;
            // Allow both "AND B" and "AND A,B" forms
            const arg = ops.includes(',') ? (ops.split(',').pop() ?? '') : ops;
            return isImm(arg) ? 2 : 1;
        }

        // ── IN / OUT ─────────────────────────────────────────────────────────
        case 'IN': case 'OUT': return 2; // IN A,(n)=2, IN r,(C)=2; OUT (n),A=2, OUT (C),r=2

        // ── BIT ops (CB prefix) ──────────────────────────────────────────────
        case 'BIT': case 'SET': case 'RES': return ixyd ? 4 : 2;

        // ── Rotates / shifts (CB prefix) ─────────────────────────────────────
        case 'RLC': case 'RRC': case 'RL': case 'RR':
        case 'SLA': case 'SRA': case 'SRL': case 'SLL':
            return ixyd ? 4 : 2;
    }

    return null; // not a recognised Z80 mnemonic
}

// ─── RASM directive size ──────────────────────────────────────────────────────

type DirResult =
    | { kind: "bytes"; n: number }
    | { kind: "org";   n: number }
    | { kind: "zero"             }   // directive that emits nothing (EQU etc.)
    | { kind: "unknown"          };  // not a known directive

/**
 * Byte contribution of a RASM assembler directive.
 * `currentAddr` is needed for ALIGN.
 */
function rasmDirSize(dir: string, args: string, currentAddr: number | undefined): DirResult {
    switch (dir.toUpperCase()) {
        // ── Zero-emission directives ─────────────────────────────────────────
        case 'EQU': case 'DEFL': case 'SET':
        case 'BANKSET': case 'BANK': case 'BUILDCPR': case 'RUN': case 'SAVE':
        case 'ASSERT': case 'PRINT': case 'MESSAGE': case 'FAIL': case 'WARNING':
        case 'CHARSET': case 'NOLIST': case 'LIST':
        case 'MACRO': case 'MEND': case 'ENDM':
        case 'IF': case 'IFDEF': case 'IFNDEF': case 'ELSE': case 'ELSEIF': case 'ENDIF':
        case 'WHILE': case 'WEND': case 'REPEAT': case 'REND':
        case 'STRUCT': case 'ENDS':
        case 'INCLUDE':     // don't follow includes for now
        case 'MODULE': case 'ENDMODULE': case 'LORGSET':
            return { kind: "zero" };

        // ── ORG → reset address ──────────────────────────────────────────────
        case 'ORG': {
            const n = parseNumber(splitCSV(args)[0]);
            return n !== undefined ? { kind: "org", n } : { kind: "unknown" };
        }

        // ── ALIGN ────────────────────────────────────────────────────────────
        case 'ALIGN': {
            if (currentAddr === undefined) return { kind: "unknown" };
            const n = parseNumber(splitCSV(args)[0]);
            if (n === undefined || n <= 0) return { kind: "unknown" };
            return { kind: "bytes", n: (n - (currentAddr % n)) % n };
        }

        // ── Byte data ────────────────────────────────────────────────────────
        case 'DB': case 'DEFB': case 'FCB': case 'DEFM': case 'DM': case 'DC': {
            // Count each element: string → char count, anything else → 1 byte
            const elems = splitCSV(args);
            let total = 0;
            for (const el of elems) {
                const t = el.trim();
                if ((t.startsWith('"') && t.endsWith('"')) ||
                    (t.startsWith("'") && t.endsWith("'"))) {
                    // String: character count (ignoring escape sequences for now)
                    total += t.length - 2;
                } else {
                    total += 1;
                }
            }
            return { kind: "bytes", n: total };
        }

        // ── Word data (2 bytes per element) ─────────────────────────────────
        case 'DW': case 'DEFW': case 'FDB':
            return { kind: "bytes", n: splitCSV(args).length * 2 };

        // ── Long data (4 bytes per element) ─────────────────────────────────
        case 'DL':
            return { kind: "bytes", n: splitCSV(args).length * 4 };

        // ── Fill / space ─────────────────────────────────────────────────────
        case 'DS': case 'DEFS': case 'RMB': case 'RMEM': case 'BLOCK': {
            const n = parseNumber(splitCSV(args)[0]);
            return n !== undefined ? { kind: "bytes", n } : { kind: "unknown" };
        }

        // ── INCBIN — would need file size; skip ──────────────────────────────
        case 'INCBIN': return { kind: "unknown" };
    }

    return { kind: "unknown" };
}

// ─── SourceMap ────────────────────────────────────────────────────────────────

/**
 * Maps source lines ↔ Z80 addresses for a single .asm file, built by:
 *  1. Using labels from the symbol table (.rasm) as address anchors.
 *  2. Accumulating Z80 instruction / data byte counts between anchors.
 */
export class SourceMap {
    readonly sourceFile: string;

    /** line (1-based) → Z80 address */
    private readonly lineToAddr = new Map<number, number>();

    /** Sorted by address for fast reverse lookup */
    private readonly byAddr: Array<{ address: number; line: number }> = [];

    /** Sorted list of all mapped line numbers — for breakpoint location queries */
    private readonly byLine: number[] = [];

    private constructor(file: string) { this.sourceFile = file; }

    // ── Builder ──────────────────────────────────────────────────────────────

    static build(asmFile: string, symbolTable: SymbolTable | null): SourceMap {
        const map = new SourceMap(asmFile);
        let raw: string;
        try { raw = fs.readFileSync(asmFile, "utf-8"); }
        catch { return map; }

        const lines = raw.split(/\r?\n/);
        let addr: number | undefined = undefined;

        for (let i = 0; i < lines.length; i++) {
            const lineNo = i + 1;
            let text = stripComment(lines[i]).trim();
            if (!text) continue;

            // ── Label definitions (may precede an instruction on the same line)
            let anchoredThisLine = false;
            while (true) {
                // Match: optional "@" or "." prefix, then word, then ":"
                const lm = text.match(/^(@?\.?\w+)\s*:\s*/);
                if (!lm) break;

                const labelName = lm[1];
                const known = symbolTable?.resolveLabel(labelName);
                if (known !== undefined) {
                    addr = known;
                }
                if (addr !== undefined && !anchoredThisLine) {
                    map.lineToAddr.set(lineNo, addr);
                    anchoredThisLine = true;
                }
                text = text.slice(lm[0].length);
                if (!text) break;
            }
            if (!text) continue;
            if (addr === undefined) continue;

            // ── Parse mnemonic + operands ────────────────────────────────────
            const pm = text.match(/^(\w+)(?:\s+(.*))?$/);
            if (!pm) continue;
            const [, mnem, rawArgs] = pm;
            const args = (rawArgs ?? '').trim();

            // ── Try RASM directive first ─────────────────────────────────────
            const dr = rasmDirSize(mnem, args, addr);
            if (dr.kind === "org") {
                addr = dr.n;       // ORG resets address, no mapping entry
                continue;
            }
            if (dr.kind === "bytes") {
                if (dr.n > 0) {
                    if (!anchoredThisLine) map.lineToAddr.set(lineNo, addr);
                    addr += dr.n;
                }
                continue;
            }
            if (dr.kind === "zero") continue; // EQU, BANKSET, …

            // ── Try Z80 instruction ──────────────────────────────────────────
            const sz = z80Size(mnem, args);
            if (sz !== null && sz > 0) {
                if (!anchoredThisLine) map.lineToAddr.set(lineNo, addr);
                addr += sz;
            }
            // sz === null  →  unknown (macro call?); skip, don't advance addr
        }

        // Build sorted reverse indices
        for (const [line, address] of map.lineToAddr) {
            map.byAddr.push({ address, line });
            map.byLine.push(line);
        }
        map.byAddr.sort((a, b) => a.address - b.address);
        map.byLine.sort((a, b) => a - b);

        return map;
    }

    // ── Queries ──────────────────────────────────────────────────────────────

    /** Z80 address for a source line, or undefined. */
    getAddress(line: number): number | undefined {
        return this.lineToAddr.get(line);
    }

    /**
     * Source line whose address is ≤ `address` and closest to it.
     * Suitable for pointing the stack frame cursor.
     */
    getNearestLine(address: number): number | undefined {
        const a = this.byAddr;
        if (!a.length) return undefined;
        let lo = 0, hi = a.length - 1, result: number | undefined;
        while (lo <= hi) {
            const mid = (lo + hi) >> 1;
            if (a[mid].address <= address) { result = a[mid].line; lo = mid + 1; }
            else                           { hi = mid - 1; }
        }
        return result;
    }

    /** Exact address → line (only when the address is the start of a mapped line). */
    getLine(address: number): number | undefined {
        const a = this.byAddr;
        let lo = 0, hi = a.length - 1;
        while (lo <= hi) {
            const mid = (lo + hi) >> 1;
            if      (a[mid].address === address) return a[mid].line;
            else if (a[mid].address < address)   lo = mid + 1;
            else                                 hi = mid - 1;
        }
        return undefined;
    }

    /**
     * All mapped line numbers in [startLine, endLine] (both inclusive, 1-based).
     * Used by `breakpointLocations` to tell VS Code which lines accept a breakpoint.
     */
    getValidLinesInRange(startLine: number, endLine: number): number[] {
        const arr = this.byLine;
        // Binary search for the first line >= startLine
        let lo = 0, hi = arr.length - 1, first = arr.length;
        while (lo <= hi) {
            const mid = (lo + hi) >> 1;
            if (arr[mid] >= startLine) { first = mid; hi = mid - 1; }
            else                       { lo = mid + 1; }
        }
        const result: number[] = [];
        for (let i = first; i < arr.length && arr[i] <= endLine; i++) {
            result.push(arr[i]);
        }
        return result;
    }

    /**
     * Nearest line in the map to `targetLine`.
     * Prefers the line immediately at or after `target` (next instruction),
     * falls back to the line before.  Returns undefined if the map is empty.
     */
    getNearestValidLine(targetLine: number): number | undefined {
        if (this.lineToAddr.has(targetLine)) return targetLine;

        const arr = this.byLine;
        if (!arr.length) return undefined;

        // Binary search: first line >= targetLine
        let lo = 0, hi = arr.length - 1, afterIdx = arr.length;
        while (lo <= hi) {
            const mid = (lo + hi) >> 1;
            if (arr[mid] >= targetLine) { afterIdx = mid; hi = mid - 1; }
            else                        { lo = mid + 1; }
        }

        const after  = afterIdx < arr.length   ? arr[afterIdx]     : undefined;
        const before = afterIdx > 0            ? arr[afterIdx - 1] : undefined;

        if (after  === undefined) return before;
        if (before === undefined) return after;

        const dAfter  = after  - targetLine;
        const dBefore = targetLine - before;
        // Prefer "after" on equal distance (next instruction is more intuitive)
        return dAfter <= dBefore ? after : before;
    }

    get size(): number { return this.lineToAddr.size; }
}
