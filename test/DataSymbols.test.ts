import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { SourceMap } from "../src/SourceMap";
import {
    classifyDataDirective, formatValue, parseScalarInput,
    typeName, typeSize, DataSymbolTable,
} from "../src/DataSymbols";

// ─── Fixture ──────────────────────────────────────────────────────────────────

const MAIN = `
    ORG #4000

    STRUCT point
xx      DB 0
yy      DB 0
    ENDSTRUCT

    STRUCT sprite
pos     point
hp      DW 0
name    DB "....."
    ENDSTRUCT

start:
    LD A,1
    CALL routine
    RET

routine:
    LD HL,counter
    RET

counter:    DB 0
score:      DW 0
lives       DB 3          ; label without a colon
message:    DB "HELLO",0
table:      DB 1,2,3,4
words:      DW 1,2
buffer:     DS 64
player      sprite
enemies     sprite 4
`;

let dir: string;
let mainPath: string;

beforeAll(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "datasym-"));
    mainPath = path.join(dir, "main.asm");
    fs.writeFileSync(mainPath, MAIN, "utf-8");
});

afterAll(() => { fs.rmSync(dir, { recursive: true, force: true }); });

function build(): SourceMap {
    return SourceMap.build(mainPath, null);
}

// ─── Directive classification ─────────────────────────────────────────────────

describe("classifyDataDirective", () => {
    it("types byte and word definitions", () => {
        expect(classifyDataDirective("DB", "0")).toEqual({ kind: "byte", elemSize: 1, count: 1 });
        expect(classifyDataDirective("DB", "1,2,3")).toEqual({ kind: "byte", elemSize: 1, count: 3 });
        expect(classifyDataDirective("DW", "0")).toEqual({ kind: "word", elemSize: 2, count: 1 });
        expect(classifyDataDirective("DEFW", "1,2")).toEqual({ kind: "word", elemSize: 2, count: 2 });
    });

    it("types strings by their character count", () => {
        expect(classifyDataDirective("DB", '"HELLO",0'))
            .toEqual({ kind: "string", elemSize: 1, count: 6 });
    });

    it("types reserved space as a scalar or a blob", () => {
        expect(classifyDataDirective("DS", "1")).toEqual({ kind: "byte", elemSize: 1, count: 1 });
        expect(classifyDataDirective("DS", "2")).toEqual({ kind: "word", elemSize: 2, count: 1 });
        expect(classifyDataDirective("DS", "64")).toEqual({ kind: "blob", elemSize: 1, count: 64 });
    });

    it("rejects non-data mnemonics", () => {
        expect(classifyDataDirective("LD", "A,1")).toBeNull();
        expect(classifyDataDirective("EQU", "5")).toBeNull();
    });
});

// ─── Source parsing ───────────────────────────────────────────────────────────

describe("SourceMap data collection", () => {
    it("collects labelled data definitions with their types", () => {
        const data = build().data;

        expect(typeName(data.get("counter")!.type)).toBe("byte");
        expect(typeName(data.get("score")!.type)).toBe("word");
        expect(typeName(data.get("message")!.type)).toBe("string[6]");
        expect(typeName(data.get("table")!.type)).toBe("byte[4]");
        expect(typeName(data.get("words")!.type)).toBe("word[2]");
        expect(typeName(data.get("buffer")!.type)).toBe("byte[64]");
    });

    it("accepts a label written without a colon", () => {
        expect(build().data.get("lives")).toBeDefined();
    });

    it("lays data out at consecutive addresses", () => {
        const data = build().data;
        const counter = data.get("counter")!.address;
        expect(data.get("score")!.address).toBe(counter + 1);
        expect(data.get("lives")!.address).toBe(counter + 3);
        expect(data.get("message")!.address).toBe(counter + 4);
        expect(data.get("table")!.address).toBe(counter + 10);
        expect(data.get("words")!.address).toBe(counter + 14);
        expect(data.get("buffer")!.address).toBe(counter + 18);
    });

    it("records the defining file and line", () => {
        const sym = build().data.get("counter")!;
        expect(sym.file).toBe(mainPath);
        expect(sym.line).toBeGreaterThan(0);
    });
});

describe("STRUCT definitions", () => {
    it("registers structs with field offsets, emitting no bytes", () => {
        const data = build().data;

        const point = data.getStruct("point")!;
        expect(point.size).toBe(2);
        expect(point.fields.map(f => [f.name, f.offset])).toEqual([["xx", 0], ["yy", 1]]);

        const sprite = data.getStruct("sprite")!;
        // point(2) + DW(2) + 5-char string = 9
        expect(sprite.size).toBe(9);
        expect(sprite.fields.map(f => [f.name, f.offset])).toEqual([["pos", 0], ["hp", 2], ["name", 4]]);
    });

    it("declares struct instances and arrays of them", () => {
        const data = build().data;

        const player = data.get("player")!;
        expect(player.type.kind).toBe("struct");
        expect(typeSize(player.type)).toBe(9);

        const enemies = data.get("enemies")!;
        expect(enemies.type.count).toBe(4);
        expect(typeSize(enemies.type)).toBe(36);
        expect(enemies.address).toBe(player.address + 9);
    });

    it("does not consume address space for the definition itself", () => {
        // `start:` follows both STRUCT blocks and must still sit at ORG #4000.
        const map = build();
        expect(map.getAddress(mainPath, MAIN.split("\n").indexOf("start:") + 1)).toBe(0x4000);
    });
});

// ─── Expression resolution ────────────────────────────────────────────────────

describe("resolve", () => {
    it("resolves a plain symbol", () => {
        const data = build().data;
        const ref = data.resolve("counter")!;
        expect(ref.address).toBe(data.get("counter")!.address);
        expect(ref.name).toBe("counter");
    });

    it("resolves array indexing", () => {
        const data = build().data;
        const base = data.get("words")!.address;
        expect(data.resolve("words[1]")!.address).toBe(base + 2);
        expect(data.resolve("words[1]")!.type.count).toBe(1);
        expect(data.resolve("words[2]")).toBeUndefined();   // out of range
    });

    it("resolves nested struct fields", () => {
        const data = build().data;
        const player = data.get("player")!.address;
        expect(data.resolve("player.pos.yy")!.address).toBe(player + 1);
        expect(data.resolve("player.hp")!.address).toBe(player + 2);
        expect(typeName(data.resolve("player.hp")!.type)).toBe("word");
        expect(data.resolve("player.nope")).toBeUndefined();
    });

    it("resolves indexing and fields combined", () => {
        const data = build().data;
        const enemies = data.get("enemies")!.address;
        const ref = data.resolve("enemies[2].pos.xx")!;
        expect(ref.address).toBe(enemies + 18);
        expect(ref.name).toBe("enemies[2].pos.xx");
    });

    it("accepts the parenthesised form and is case-insensitive", () => {
        const data = build().data;
        expect(data.resolve("(COUNTER)")!.address).toBe(data.get("counter")!.address);
    });

    it("ignores unknown roots and trailing garbage", () => {
        const data = build().data;
        expect(data.resolve("nosuchthing")).toBeUndefined();
        expect(data.resolve("counter + 1")).toBeUndefined();
    });
});

describe("children", () => {
    it("expands arrays then struct fields, leaving scalars as leaves", () => {
        const data = build().data;

        expect(data.children(data.resolve("counter")!)).toHaveLength(0);
        expect(data.children(data.resolve("message")!)).toHaveLength(0);   // shown as text
        expect(data.children(data.resolve("buffer")!)).toHaveLength(0);    // shown as hex preview
        expect(data.children(data.resolve("table")!)).toHaveLength(4);
        expect(data.children(data.resolve("enemies")!)).toHaveLength(4);
        expect(data.children(data.resolve("player")!).map(c => c.name))
            .toEqual(["player.pos", "player.hp", "player.name"]);
    });
});

// ─── Formatting ───────────────────────────────────────────────────────────────

describe("formatValue", () => {
    const byte = { kind: "byte" as const, elemSize: 1, count: 1 };
    const word = { kind: "word" as const, elemSize: 2, count: 1 };

    it("shows scalars in hex and decimal", () => {
        expect(formatValue(byte, [0x1F])).toBe("0x1F (31)");
        expect(formatValue(word, [0x34, 0x12])).toBe("0x1234 (4660)");
    });

    it("appends the character for printable bytes", () => {
        expect(formatValue(byte, [0x41])).toBe("0x41 (65) 'A'");
    });

    it("renders strings and blobs", () => {
        expect(formatValue({ kind: "string", elemSize: 1, count: 3 }, [72, 73, 0]))
            .toBe('"HI."');
        expect(formatValue({ kind: "blob", elemSize: 1, count: 16 }, [1, 2, 3]))
            .toContain("[16 bytes]");
    });

    it("previews arrays and structs", () => {
        expect(formatValue({ kind: "byte", elemSize: 1, count: 2 }, [1, 2])).toBe("[0x01, 0x02]");
        const data = build().data;
        const ref = data.resolve("player.pos")!;
        expect(formatValue(ref.type, [5, 9])).toBe("{ xx: 0x05 (5), yy: 0x09 (9) }");
    });
});

describe("parseScalarInput", () => {
    const byte = { kind: "byte" as const, elemSize: 1, count: 1 };
    const word = { kind: "word" as const, elemSize: 2, count: 1 };

    it("accepts hex, decimal, binary and characters", () => {
        expect(parseScalarInput(byte, "0x1F")).toEqual([0x1F]);
        expect(parseScalarInput(byte, "#1F")).toEqual([0x1F]);
        expect(parseScalarInput(byte, "31")).toEqual([31]);
        expect(parseScalarInput(byte, "%1010")).toEqual([10]);
        expect(parseScalarInput(byte, "'A'")).toEqual([65]);
    });

    it("writes words little-endian", () => {
        expect(parseScalarInput(word, "0x1234")).toEqual([0x34, 0x12]);
    });

    it("refuses aggregates and junk", () => {
        expect(parseScalarInput({ kind: "blob", elemSize: 1, count: 4 }, "0")).toBeNull();
        expect(parseScalarInput(byte, "hello")).toBeNull();
    });
});

// ─── Address reconciliation ───────────────────────────────────────────────────

describe("reconcile", () => {
    it("prefers the assembler address and flags confirmed symbols", () => {
        const data = new DataSymbolTable();
        data.add({ name: "counter", address: 0x1111, type: { kind: "byte", elemSize: 1, count: 1 } });
        data.add({ name: "other",   address: 0x2222, type: { kind: "byte", elemSize: 1, count: 1 } });

        data.reconcile({ resolveLabel: (n: string) => (n === "counter" ? 0x9000 : undefined) } as any);

        expect(data.get("counter")!.address).toBe(0x9000);
        expect(data.get("counter")!.confirmed).toBe(true);
        expect(data.get("other")!.address).toBe(0x2222);
        expect(data.get("other")!.confirmed).toBeUndefined();
    });
});
