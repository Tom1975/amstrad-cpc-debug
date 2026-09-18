import { splitCSV, parseNumber, isStringLiteral, stringLiteralBody } from "./AsmSyntax";
import { SymbolTable } from "./SymbolTable";

// ─── Types ────────────────────────────────────────────────────────────────────

export type TypeKind = "byte" | "word" | "dword" | "string" | "blob" | "struct";

export interface DataType {
    kind: TypeKind;
    /** Size of ONE element, in bytes. */
    elemSize: number;
    /** Number of elements (1 for a scalar). */
    count: number;
    /** Struct name, for kind === "struct". */
    structName?: string;
    /** Fields, for kind === "struct" (shared with the struct definition). */
    fields?: FieldDef[];
}

export interface FieldDef {
    name: string;
    /** Byte offset from the start of the struct. */
    offset: number;
    type: DataType;
}

export interface StructDef {
    name: string;
    size: number;
    fields: FieldDef[];
}

export interface DataSymbol {
    name: string;
    address: number;
    type: DataType;
    /** Source file the definition came from (absolute path as parsed). */
    file?: string;
    /** 1-based line of the definition. */
    line?: number;
    /** Initialiser text as written in the source, for display. */
    init?: string;
    /** True when the address was confirmed by the assembler symbol table. */
    confirmed?: boolean;
}

/** A resolved location inside a data symbol: what to read and how to format it. */
export interface ResolvedRef {
    /** Full display name, e.g. "enemies[2].pos.x" */
    name: string;
    address: number;
    type: DataType;
}

/** Total byte size of a type. */
export function typeSize(t: DataType): number {
    return t.elemSize * t.count;
}

/** Short human-readable type name, e.g. "byte[4]", "point", "word". */
export function typeName(t: DataType): string {
    const base = t.kind === "struct" ? (t.structName ?? "struct")
               : t.kind === "string" ? "string"
               : t.kind === "blob"   ? "byte"
               : t.kind;
    if (t.kind === "string") return `string[${t.count}]`;
    if (t.kind === "blob")   return `byte[${t.count}]`;
    return t.count > 1 ? `${base}[${t.count}]` : base;
}

/** One element of an array type (or the type itself when not an array). */
export function elementType(t: DataType): DataType {
    if (t.count <= 1) return t;
    return { ...t, count: 1 };
}

// ─── Data directive classification ────────────────────────────────────────────

const BYTE_DIRS  = new Set(["DB", "DEFB", "FCB", "DEFM", "DM", "DC"]);
const WORD_DIRS  = new Set(["DW", "DEFW", "FDB"]);
const DWORD_DIRS = new Set(["DL"]);
const SPACE_DIRS = new Set(["DS", "DEFS", "RMB", "RMEM", "BLOCK"]);

/**
 * Type described by a data directive, or null when `mnem` is not one.
 *
 *   DB 1,2,3        → byte[3]
 *   DB "hello",0    → string[6]   (a lone string keeps its length)
 *   DW 0            → word
 *   DS 64           → byte[64] (blob)
 */
export function classifyDataDirective(mnem: string, args: string): DataType | null {
    const m = mnem.toUpperCase();

    if (BYTE_DIRS.has(m)) {
        const elems = splitCSV(args);
        if (elems.length === 0) return null;
        // A definition containing any string literal is displayed as text.
        const hasString = elems.some(isStringLiteral);
        let total = 0;
        for (const el of elems) total += isStringLiteral(el) ? stringLiteralBody(el).length : 1;
        if (total === 0) return null;
        if (hasString) return { kind: "string", elemSize: 1, count: total };
        return { kind: "byte", elemSize: 1, count: total };
    }

    if (WORD_DIRS.has(m)) {
        const n = splitCSV(args).length;
        return n > 0 ? { kind: "word", elemSize: 2, count: n } : null;
    }

    if (DWORD_DIRS.has(m)) {
        const n = splitCSV(args).length;
        return n > 0 ? { kind: "dword", elemSize: 4, count: n } : null;
    }

    if (SPACE_DIRS.has(m)) {
        const n = parseNumber(splitCSV(args)[0] ?? "");
        if (n === undefined || n <= 0) return null;
        // DS 1 / DS 2 are most often a scalar slot, larger blocks a buffer.
        if (n === 1) return { kind: "byte", elemSize: 1, count: 1 };
        if (n === 2) return { kind: "word", elemSize: 2, count: 1 };
        return { kind: "blob", elemSize: 1, count: n };
    }

    return null;
}

// ─── Table ────────────────────────────────────────────────────────────────────

const KEY = (s: string) => s.toUpperCase();

/**
 * Variables and structures declared in the assembler source.
 *
 * Filled while SourceMap walks the .asm tree (it already tracks the current
 * address and follows INCLUDEs), then cross-checked against the assembler
 * symbol table so the addresses come from the real build whenever possible.
 */
export class DataSymbolTable {
    private readonly structs = new Map<string, StructDef>();
    private readonly byName  = new Map<string, DataSymbol>();
    private readonly symbols: DataSymbol[] = [];

    get size(): number { return this.symbols.length; }
    get structCount(): number { return this.structs.size; }

    // ── Population ───────────────────────────────────────────────────────────

    addStruct(def: StructDef): void {
        this.structs.set(KEY(def.name), def);
    }

    getStruct(name: string): StructDef | undefined {
        return this.structs.get(KEY(name));
    }

    hasStruct(name: string): boolean {
        return this.structs.has(KEY(name));
    }

    /** Struct instance type for `name`, or null when no such struct exists. */
    structType(name: string, count = 1): DataType | null {
        const def = this.getStruct(name);
        if (!def) return null;
        return {
            kind: "struct",
            elemSize: def.size,
            count,
            structName: def.name,
            fields: def.fields,
        };
    }

    add(sym: DataSymbol): void {
        const key = KEY(sym.name);
        // First definition wins — a duplicate label in a macro expansion must
        // not shadow the real one.
        if (this.byName.has(key)) return;
        this.byName.set(key, sym);
        this.symbols.push(sym);
    }

    /**
     * Replace parsed addresses with the assembler's own, and mark which
     * symbols the build confirms.  Parsing cannot see macros, conditionals or
     * INCBIN sizes, so the .rasm value always wins when present.
     */
    reconcile(table: SymbolTable | null): void {
        if (!table) return;
        for (const sym of this.symbols) {
            const real = table.resolveLabel(sym.name);
            if (real !== undefined) {
                sym.address = real;
                sym.confirmed = true;
            }
        }
    }

    all(): DataSymbol[] { return this.symbols; }

    get(name: string): DataSymbol | undefined {
        return this.byName.get(KEY(name));
    }

    /** Symbols grouped by source file, in declaration order. */
    byFile(): Map<string, DataSymbol[]> {
        const out = new Map<string, DataSymbol[]>();
        for (const sym of this.symbols) {
            const f = sym.file ?? "";
            const list = out.get(f);
            if (list) list.push(sym); else out.set(f, [sym]);
        }
        return out;
    }

    // ── Expression resolution ────────────────────────────────────────────────

    /**
     * Resolve an expression against the data symbols.
     *
     *   counter              → the symbol itself
     *   enemies[2]           → one array element
     *   player.pos.x         → a nested struct field
     *   enemies[2].hp        → both combined
     *
     * Returns undefined when the root is not a known data symbol or the path
     * does not fit the type (unknown field, index out of range).
     */
    resolve(expr: string): ResolvedRef | undefined {
        const trimmed = expr.trim().replace(/^\((.*)\)$/, "$1").trim();
        const rootMatch = trimmed.match(/^(@?[A-Za-z_.][A-Za-z0-9_.]*)/);
        if (!rootMatch) return undefined;

        // The root name itself may contain dots (RASM emits "instance.field"
        // labels), so try the longest prefix that is a known symbol.
        let root: DataSymbol | undefined;
        let rest = "";
        const head = rootMatch[1];
        const parts = head.split(".");
        for (let take = parts.length; take >= 1; take--) {
            const candidate = parts.slice(0, take).join(".");
            const sym = this.get(candidate);
            if (sym) {
                root = sym;
                rest = trimmed.slice(candidate.length);
                break;
            }
        }
        if (!root) return undefined;

        let ref: ResolvedRef = { name: root.name, address: root.address, type: root.type };

        // Walk the remaining .field and [index] accessors.
        const TOKEN = /^\s*(?:\.([A-Za-z_][A-Za-z0-9_]*)|\[\s*([^\]]+)\s*\])/;
        while (rest.trim().length > 0) {
            const m = TOKEN.exec(rest);
            if (!m) return undefined;      // trailing garbage → not our expression
            rest = rest.slice(m[0].length);

            if (m[1] !== undefined) {
                const next = this.field(ref, m[1]);
                if (!next) return undefined;
                ref = next;
            } else {
                const idx = parseNumber(m[2]) ?? Number(m[2]);
                if (!Number.isFinite(idx)) return undefined;
                const next = this.index(ref, idx);
                if (!next) return undefined;
                ref = next;
            }
        }
        return ref;
    }

    /** Field access on a struct ref. */
    field(ref: ResolvedRef, fieldName: string): ResolvedRef | undefined {
        if (ref.type.kind !== "struct" || !ref.type.fields) return undefined;
        const f = ref.type.fields.find(x => KEY(x.name) === KEY(fieldName));
        if (!f) return undefined;
        return {
            name: `${ref.name}.${f.name}`,
            address: (ref.address + f.offset) & 0xFFFF,
            type: f.type,
        };
    }

    /** Array element access. */
    index(ref: ResolvedRef, idx: number): ResolvedRef | undefined {
        if (idx < 0 || idx >= ref.type.count) return undefined;
        return {
            name: `${ref.name}[${idx}]`,
            address: (ref.address + idx * ref.type.elemSize) & 0xFFFF,
            type: elementType(ref.type),
        };
    }

    /**
     * Children of a ref for the Variables tree: array elements first, then
     * struct fields.  Scalars, strings and blobs are leaves.
     */
    children(ref: ResolvedRef): ResolvedRef[] {
        if (ref.type.count > 1 && ref.type.kind !== "string" && ref.type.kind !== "blob") {
            const out: ResolvedRef[] = [];
            for (let i = 0; i < ref.type.count; i++) {
                const child = this.index(ref, i);
                if (child) out.push(child);
            }
            return out;
        }
        if (ref.type.kind === "struct" && ref.type.fields) {
            return ref.type.fields
                .map(f => this.field(ref, f.name))
                .filter((r): r is ResolvedRef => r !== undefined);
        }
        return [];
    }

    /** True when a ref can be expanded in the Variables tree. */
    hasChildren(ref: ResolvedRef): boolean {
        if (ref.type.kind === "string" || ref.type.kind === "blob") return false;
        if (ref.type.count > 1) return true;
        return ref.type.kind === "struct" && (ref.type.fields?.length ?? 0) > 0;
    }
}

// ─── Value formatting ─────────────────────────────────────────────────────────

const hex = (v: number, digits: number) =>
    "0x" + (v >>> 0).toString(16).toUpperCase().padStart(digits, "0");

const printable = (b: number) => b >= 0x20 && b <= 0x7E;

/** Read a little-endian unsigned integer of `size` bytes. */
export function readLE(bytes: number[], offset: number, size: number): number {
    let v = 0;
    for (let i = 0; i < size; i++) v |= (bytes[offset + i] ?? 0) << (8 * i);
    return v >>> 0;
}

/** Bytes rendered as `"text"`, non-printables escaped as dots. */
function formatString(bytes: number[]): string {
    const s = bytes.map(b => (printable(b) ? String.fromCharCode(b) : ".")).join("");
    return `"${s}"`;
}

const BLOB_PREVIEW = 8;

/**
 * Value text for a resolved ref, given the bytes read at its address.
 *
 * Scalars show hex and decimal (plus the character for printable bytes),
 * aggregates show a short preview so the tree stays readable collapsed.
 */
export function formatValue(type: DataType, bytes: number[]): string {
    switch (type.kind) {
        case "string":
            return formatString(bytes.slice(0, type.count));

        case "blob": {
            const shown = bytes.slice(0, BLOB_PREVIEW)
                .map(b => b.toString(16).toUpperCase().padStart(2, "0")).join(" ");
            const more = type.count > BLOB_PREVIEW ? " …" : "";
            return `[${type.count} bytes] ${shown}${more}`;
        }

        case "struct": {
            if (type.count > 1) return `${typeName(type)}`;
            const parts: string[] = [];
            for (const f of type.fields ?? []) {
                if (parts.length >= 4) { parts.push("…"); break; }
                const sub = bytes.slice(f.offset, f.offset + typeSize(f.type));
                parts.push(`${f.name}: ${formatValue(f.type, sub)}`);
            }
            return `{ ${parts.join(", ")} }`;
        }

        default: {
            const digits = type.elemSize * 2;
            if (type.count > 1) {
                const shown: string[] = [];
                for (let i = 0; i < Math.min(type.count, BLOB_PREVIEW); i++) {
                    shown.push(hex(readLE(bytes, i * type.elemSize, type.elemSize), digits));
                }
                const more = type.count > BLOB_PREVIEW ? ", …" : "";
                return `[${shown.join(", ")}${more}]`;
            }
            const v = readLE(bytes, 0, type.elemSize);
            let text = `${hex(v, digits)} (${v})`;
            if (type.elemSize === 1 && printable(v)) text += ` '${String.fromCharCode(v)}'`;
            return text;
        }
    }
}

/**
 * Parse a user-entered value for a scalar type into the bytes to write.
 * Accepts "0x1F", "#1F", "31", "%1010", "'A'".  Returns null when the input
 * is not usable for that type.
 */
export function parseScalarInput(type: DataType, input: string): number[] | null {
    if (type.count !== 1 || type.kind === "struct" || type.kind === "blob" || type.kind === "string") {
        return null;
    }
    const t = input.trim();
    let v: number | undefined;

    const charMatch = t.match(/^'(.)'$/) ?? t.match(/^"(.)"$/);
    if (charMatch) v = charMatch[1].charCodeAt(0);
    else v = parseNumber(t) ?? (/^-?\d+$/.test(t) ? Number(t) : undefined);

    if (v === undefined || !Number.isFinite(v)) return null;
    const bytes: number[] = [];
    let n = v < 0 ? v + (1 << (8 * type.elemSize)) : v;
    for (let i = 0; i < type.elemSize; i++) { bytes.push(n & 0xFF); n >>>= 8; }
    return bytes;
}
