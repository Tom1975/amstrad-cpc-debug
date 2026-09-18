import * as fs   from "fs";
import * as path from "path";
import { SymbolTable } from "./SymbolTable";
import { DataSymbolTable, FieldDef, classifyDataDirective, typeSize } from "./DataSymbols";
import { stripComment, splitCSV, parseNumber, splitStatements } from "./AsmSyntax";

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
/**
 * Every directive name rasmDirSize() handles. Needed on its own because a
 * directive must be recognised from its name alone, before its arguments are
 * known (to tell "counter DB 0" — a labelled variable — from a macro call).
 */
const DIRECTIVES = new Set([
    'EQU', 'DEFL', 'SET', 'BANKSET', 'BANK', 'BUILDCPR', 'RUN', 'SAVE',
    'ASSERT', 'PRINT', 'MESSAGE', 'FAIL', 'WARNING', 'CHARSET', 'NOLIST', 'LIST',
    'MACRO', 'MEND', 'ENDM',
    'IF', 'IFDEF', 'IFNDEF', 'ELSE', 'ELSEIF', 'ENDIF',
    'WHILE', 'WEND', 'REPEAT', 'REND',
    'MODULE', 'ENDMODULE', 'LORGSET',
    'ORG', 'ALIGN',
    'DB', 'DEFB', 'FCB', 'DEFM', 'DM', 'DC',
    'DW', 'DEFW', 'FDB', 'DL',
    'DS', 'DEFS', 'RMB', 'RMEM', 'BLOCK',
    'INCBIN',
]);

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

/** Normalise a path for use as a map key (case/slash-insensitive comparison). */
function normPath(p: string): string {
    return path.resolve(p).replace(/\\/g, "/").toLowerCase();
}

/**
 * Maps source lines ↔ Z80 addresses across an entry .asm file and everything
 * it INCLUDEs, built by:
 *  1. Using labels from the symbol table (.rasm) as address anchors.
 *  2. Accumulating Z80 instruction / data byte counts between anchors.
 * INCLUDE directives are followed and inlined at parse time, since the
 * assembler places included code at the point of inclusion.
 */
/** A STRUCT definition being read; fields accumulate offsets, not addresses. */
interface OpenStruct {
    name: string;
    fields: FieldDef[];
    size: number;
}

/** Parser state threaded across files (INCLUDEs share it). */
interface ParseState {
    /** Current assembly address, undefined until the first known anchor. */
    addr: number | undefined;
    /** Open STRUCT definition, if any. */
    struct: OpenStruct | null;
}

export class SourceMap {
    readonly sourceFile: string;

    /** normalised file path → (line (1-based) → Z80 address) */
    private readonly lineToAddr = new Map<string, Map<number, number>>();

    /** Sorted by address for fast reverse lookup, across all files */
    private readonly byAddr: Array<{ address: number; file: string; line: number }> = [];

    /** normalised file path → sorted list of mapped line numbers */
    private readonly byLine = new Map<string, number[]>();

    /** normalised file path → original on-disk path, for display */
    private readonly displayPath = new Map<string, string>();

    /** Variables and structures declared in the parsed sources. */
    readonly data = new DataSymbolTable();

    private constructor(file: string) { this.sourceFile = file; }

    // ── Builder ──────────────────────────────────────────────────────────────

    static build(asmFile: string, symbolTable: SymbolTable | null): SourceMap {
        const map = new SourceMap(asmFile);
        map.parseFile(asmFile, symbolTable, { addr: undefined, struct: null }, new Set());

        // The assembler's own addresses win over the parsed ones.
        map.data.reconcile(symbolTable);

        for (const [file, lm] of map.lineToAddr) {
            const lines = [...lm.keys()].sort((a, b) => a - b);
            map.byLine.set(file, lines);
            for (const [line, address] of lm) {
                map.byAddr.push({ address, file, line });
            }
        }
        map.byAddr.sort((a, b) => a.address - b.address);

        return map;
    }

    /** Parse one file (recursing into INCLUDEs), threading the current address across files. */
    private parseFile(
        asmFile: string,
        symbolTable: SymbolTable | null,
        state: ParseState,
        activeStack: Set<string>
    ): void {
        const key = normPath(asmFile);
        if (activeStack.has(key)) return; // circular INCLUDE guard

        let raw: string;
        try { raw = fs.readFileSync(asmFile, "utf-8"); }
        catch { return; }

        this.displayPath.set(key, asmFile);
        let fileLines = this.lineToAddr.get(key);
        if (!fileLines) { fileLines = new Map(); this.lineToAddr.set(key, fileLines); }

        activeStack.add(key);
        const lines = raw.split(/\r?\n/);

        for (let i = 0; i < lines.length; i++) {
            const lineNo = i + 1;
            let text = stripComment(lines[i]).trim();
            if (!text) continue;

            // ── Label definitions (may precede an instruction on the same line)
            // Anchor the physical line on a label, and adopt its address when
            // the assembler knows it. Shared by every statement on this line —
            // only the first one that has an address actually anchors it.
            let anchoredThisLine = false;
            const anchorLabel = (labelName: string): void => {
                // Inside a STRUCT definition a label names a field, not an
                // address: it must neither anchor the line nor move the address.
                if (state.struct) return;
                const known = symbolTable?.resolveLabel(labelName);
                if (known !== undefined) state.addr = known;
                if (state.addr !== undefined && !anchoredThisLine) {
                    fileLines!.set(lineNo, state.addr);
                    anchoredThisLine = true;
                }
            };

            const leadingLabels: string[] = [];
            while (true) {
                // Match: optional "@" or "." prefix, then word, then ":"
                const lm = text.match(/^(@?\.?\w+)\s*:\s*/);
                if (!lm) break;

                leadingLabels.push(lm[1]);
                anchorLabel(lm[1]);
                text = text.slice(lm[0].length);
                if (!text) break;
            }
            if (!text) continue;

            // RASM allows several statements on one physical line, separated
            // by ':' ("LD A,B : INC A"). Each gets its own byte size, but only
            // the first is eligible for the line's leading label(s) — matching
            // the original chain-of-labels semantics ("lineLabel" used to be
            // the first one captured).
            const firstLabel = leadingLabels[0];

            for (const [si, rawStmt] of splitStatements(text).entries()) {
                const stmt = rawStmt.trim();
                if (!stmt) continue;

                // ── Parse mnemonic + operands ────────────────────────────────
                const pm = stmt.match(/^([.\w]+)(?:\s+(.*))?$/);
                if (!pm) continue;
                let mnem = pm[1];
                let args = (pm[2] ?? '').trim();
                let stmtLabel: string | undefined = si === 0 ? firstLabel : undefined;

                // RASM also accepts a label without a colon ("counter DB 0",
                // "player point"). When the first word is not a mnemonic but
                // the second one is, read the first word as this statement's
                // label.
                if (!this.isKnownMnemonic(mnem) && args) {
                    const am = args.match(/^([.\w]+)(?:\s+(.*))?$/);
                    if (am && this.isKnownMnemonic(am[1])) {
                        if (stmtLabel === undefined) { stmtLabel = mnem; anchorLabel(mnem); }
                        mnem = am[1];
                        args = (am[2] ?? '').trim();
                    }
                }
                const upper = mnem.toUpperCase();

                // ── STRUCT definition blocks ─────────────────────────────────
                // A definition emits no bytes: its lines only describe field
                // offsets, so the current address must not move.
                if (upper === 'STRUCT' && !state.struct) {
                    const parts = splitCSV(args);
                    // "STRUCT type, instance[, init…]" declares an instance instead.
                    const typeIdx = parts.findIndex(p => this.data.hasStruct(p));
                    if (parts.length >= 2 && typeIdx >= 0) {
                        const instance = parts[typeIdx === 0 ? 1 : 0];
                        this.declareStructInstance(
                            instance, parts[typeIdx], '', state, asmFile, lineNo, anchoredThisLine, fileLines);
                    } else if (parts[0]) {
                        state.struct = { name: parts[0], fields: [], size: 0 };
                    }
                    continue;
                }
                if (upper === 'ENDSTRUCT' || upper === 'ENDS') {
                    if (state.struct) {
                        this.data.addStruct({
                            name:   state.struct.name,
                            size:   state.struct.size,
                            fields: state.struct.fields,
                        });
                        state.struct = null;
                    }
                    continue;
                }
                if (state.struct) {
                    this.addStructField(state.struct, stmtLabel, mnem, args);
                    continue;
                }

                // ── INCLUDE: recurse into the referenced file in place ─────────
                // Followed even before the first anchor, so that struct
                // definitions and a leading ORG inside the included file are
                // still seen.
                if (upper === 'INCLUDE') {
                    const incName = splitCSV(args)[0]?.trim().replace(/^["']|["']$/g, '');
                    if (incName) {
                        const incPath = path.resolve(path.dirname(asmFile), incName);
                        this.parseFile(incPath, symbolTable, state, activeStack);
                    }
                    continue;
                }

                // ── ORG anchors the address on its own ─────────────────────────
                // Handled before the "no address yet" bail-out, so a source that
                // starts with ORG maps even without a symbol file.
                if (upper === 'ORG') {
                    const org = parseNumber(splitCSV(args)[0] ?? '');
                    if (org !== undefined) state.addr = org;
                    continue;
                }

                if (state.addr === undefined) continue;

                // ── Try RASM directive first ─────────────────────────────────
                const dr = rasmDirSize(mnem, args, state.addr);
                if (dr.kind === "org") {
                    state.addr = dr.n;       // ORG resets address, no mapping entry
                    continue;
                }
                if (dr.kind === "bytes") {
                    if (dr.n > 0) {
                        if (!anchoredThisLine) fileLines.set(lineNo, state.addr);
                        // A labelled data directive is a variable we can display.
                        if (stmtLabel) {
                            const t = classifyDataDirective(mnem, args);
                            if (t) {
                                this.data.add({
                                    name: stmtLabel, address: state.addr, type: t,
                                    file: asmFile, line: lineNo, init: args,
                                });
                            }
                        }
                        state.addr += dr.n;
                    }
                    continue;
                }
                if (dr.kind === "zero") continue; // EQU, BANKSET, …

                // ── Try Z80 instruction ────────────────────────────────────────
                const sz = z80Size(mnem, args);
                if (sz !== null && sz > 0) {
                    if (!anchoredThisLine) fileLines.set(lineNo, state.addr);
                    state.addr += sz;
                    continue;
                }

                // ── Struct instance: "player point" / "enemies point 8" ────────
                if (this.declareStructInstance(
                        stmtLabel, mnem, args, state, asmFile, lineNo, anchoredThisLine, fileLines)) {
                    continue;
                }
                // unknown mnemonic (macro call?); skip, don't advance addr
            }
        }

        activeStack.delete(key);
    }

    /** True for anything the parser recognises as a mnemonic or directive. */
    private isKnownMnemonic(word: string): boolean {
        const u = word.toUpperCase();
        if (u === 'INCLUDE' || u === 'STRUCT' || u === 'ENDSTRUCT' || u === 'ENDS') return true;
        if (DIRECTIVES.has(u)) return true;
        if (this.data.hasStruct(word)) return true;
        return z80Size(u, '') !== null;
    }

    /**
     * Record a field inside an open STRUCT definition and advance its size.
     * Fields may themselves be structs ("pos point"), giving nested types.
     */
    private addStructField(
        open: OpenStruct,
        label: string | undefined,
        mnem: string,
        args: string
    ): void {
        if (!label) return;
        const type = this.data.structType(mnem) ?? classifyDataDirective(mnem, args);
        if (!type) return;
        open.fields.push({ name: label, offset: open.size, type });
        open.size += typeSize(type);
    }

    /**
     * Declare an instance of a known struct at the current address.
     * `args` may hold an element count ("enemies point 8").
     * Returns false when `typeName` is not a known struct.
     */
    private declareStructInstance(
        label: string | undefined,
        structName: string,
        args: string,
        state: ParseState,
        asmFile: string,
        lineNo: number,
        anchoredThisLine: boolean,
        fileLines: Map<number, number>
    ): boolean {
        const count = parseNumber(splitCSV(args)[0] ?? '') ?? 1;
        const type  = this.data.structType(structName, count > 0 ? count : 1);
        if (!type) return false;
        if (state.addr === undefined) return true;   // known struct, no address yet

        if (!anchoredThisLine) fileLines.set(lineNo, state.addr);
        if (label) {
            this.data.add({
                name: label, address: state.addr, type,
                file: asmFile, line: lineNo,
            });
        }
        state.addr += typeSize(type);
        return true;
    }

    // ── Queries ──────────────────────────────────────────────────────────────

    /** True if `file` has any mapped lines (i.e. is the entry file or one of its INCLUDEs). */
    hasFile(file: string): boolean {
        return this.lineToAddr.has(normPath(file));
    }

    /** Z80 address for a line in `file`, or undefined. */
    getAddress(file: string, line: number): number | undefined {
        return this.lineToAddr.get(normPath(file))?.get(line);
    }

    /**
     * File + source line whose address is ≤ `address` and closest to it.
     * Suitable for pointing the stack frame cursor.
     */
    getNearestLine(address: number): { file: string; line: number } | undefined {
        const a = this.byAddr;
        if (!a.length) return undefined;
        let lo = 0, hi = a.length - 1, result: { file: string; line: number } | undefined;
        while (lo <= hi) {
            const mid = (lo + hi) >> 1;
            if (a[mid].address <= address) {
                result = { file: this.displayPath.get(a[mid].file) ?? a[mid].file, line: a[mid].line };
                lo = mid + 1;
            } else {
                hi = mid - 1;
            }
        }
        return result;
    }

    /** Exact address → file + line (only when the address is the start of a mapped line). */
    getLine(address: number): { file: string; line: number } | undefined {
        const a = this.byAddr;
        let lo = 0, hi = a.length - 1;
        while (lo <= hi) {
            const mid = (lo + hi) >> 1;
            if      (a[mid].address === address) return { file: this.displayPath.get(a[mid].file) ?? a[mid].file, line: a[mid].line };
            else if (a[mid].address < address)   lo = mid + 1;
            else                                 hi = mid - 1;
        }
        return undefined;
    }

    /**
     * All mapped line numbers of `file` in [startLine, endLine] (both inclusive, 1-based).
     * Used by `breakpointLocations` to tell VS Code which lines accept a breakpoint.
     */
    getValidLinesInRange(file: string, startLine: number, endLine: number): number[] {
        const arr = this.byLine.get(normPath(file));
        if (!arr) return [];
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

    get size(): number {
        let n = 0;
        for (const lm of this.lineToAddr.values()) n += lm.size;
        return n;
    }
}
