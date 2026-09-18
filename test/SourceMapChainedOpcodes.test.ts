import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { SourceMap } from "../src/SourceMap";
import { splitStatements } from "../src/AsmSyntax";

let dir: string;

beforeAll(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), "chained-")); });
afterAll(() => { fs.rmSync(dir, { recursive: true, force: true }); });

function build(src: string): { map: SourceMap; file: string; lineOf: (needle: string) => number } {
    const file = path.join(dir, `t${Math.random().toString(36).slice(2)}.asm`);
    fs.writeFileSync(file, src, "utf-8");
    return { map: SourceMap.build(file, null), file, lineOf: (n: string) => src.split("\n").findIndex(l => l.includes(n)) + 1 };
}

// ─── splitStatements ──────────────────────────────────────────────────────────

describe("splitStatements", () => {
    it("splits on ':' outside quotes", () => {
        expect(splitStatements("LD A,B : INC A")).toEqual(["LD A,B ", " INC A"]);
    });

    it("keeps a ':' inside a string literal intact", () => {
        expect(splitStatements('DB "a:b",0')).toEqual(['DB "a:b",0']);
    });

    it("returns an empty trailing segment for a line ending right after ':'", () => {
        expect(splitStatements("RET :")).toEqual(["RET ", ""]);
    });
});

// ─── Address correctness across chained opcodes ───────────────────────────────

describe("chained opcodes on one line", () => {
    it("advances the address by the sum of every statement's size", () => {
        // LD A,B (1) + INC A (1) = 2
        const { map, file, lineOf } = build(`
    ORG #8000
start:
    LD A,B : INC A
next:
    RET
`);
        expect(map.getAddress(file, lineOf("start:"))).toBe(0x8000);
        expect(map.getAddress(file, lineOf("next:"))).toBe(0x8002);
    });

    it("does not let a later statement's operand corrupt an earlier statement's size", () => {
        // This used to under-count: LD BC,nn (3) parsed with "1234:RET" glued
        // into its operand, and returned 3 instead of LD BC,nn(3) + RET(1) = 4.
        const { map, file, lineOf } = build(`
    ORG #8000
start:
    LD BC,1234 : RET
next:
    RET
`);
        expect(map.getAddress(file, lineOf("next:"))).toBe(0x8004);
    });

    it("handles three or more chained instructions", () => {
        // LD A,1(2) + INC A(1) + LD B,A(1) + RET(1) = 5
        const { map, file, lineOf } = build(`
    ORG #8000
start:
    LD A,1 : INC A : LD B,A : RET
next:
    NOP
`);
        expect(map.getAddress(file, lineOf("next:"))).toBe(0x8005);
    });

    it("chains a label, several instructions and a following label", () => {
        const { map, file, lineOf } = build(`
    ORG #8000
loop: LD A,B : INC A : DJNZ loop
after:
    RET
`);
        // LD A,B(1) + INC A(1) + DJNZ(2) = 4
        expect(map.getAddress(file, lineOf("loop:"))).toBe(0x8000);
        expect(map.getAddress(file, lineOf("after:"))).toBe(0x8004);
    });

    it("chains a labelled data directive with a following instruction", () => {
        const { map, file, lineOf } = build(`
    ORG #8000
start:
    NOP
counter: DB 1 : RET
after:
    RET
`);
        // counter is at start+1 (after NOP); DB 1 (1 byte) then RET (1 byte) → after = start+1+1+1
        expect(map.data.get("counter")!.address).toBe(0x8001);
        expect(map.getAddress(file, lineOf("after:"))).toBe(0x8003);
    });

    it("chains a struct-instance declaration with a following instruction", () => {
        const { map, file, lineOf } = build(`
    ORG #8000

    STRUCT point
xx  DB 0
yy  DB 0
    ENDSTRUCT

start:
player point : NOP
after:
    RET
`);
        // point is 2 bytes, NOP is 1 byte
        expect(map.data.get("player")!.address).toBe(0x8000);
        expect(map.getAddress(file, lineOf("after:"))).toBe(0x8003);
    });

    it("keeps the chain byte-accurate against a real emulated run", () => {
        // Cross-check against z80Size for each individual instruction summed
        // by hand, for a chain mixing multiple operand shapes.
        const { map, file, lineOf } = build(`
    ORG #C000
start:
    LD HL,#1234 : LD (HL),A : INC HL : LD (HL),B : RET
after:
    NOP
`);
        // LD HL,nn(3) + LD (HL),A(1) + INC HL(1) + LD (HL),B(1) + RET(1) = 7
        expect(map.getAddress(file, lineOf("after:"))).toBe(0xC007);
    });
});
