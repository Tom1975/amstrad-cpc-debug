import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { SourceMap } from "../src/SourceMap";

// Line numbers are 1-based; line 1 is the empty line after the backtick.
const SRC = `
    ORG #8000
start:
    LD A,1
    LD HL,#1234
data    DB 1,2
    STRUCT point
xx      DB 0
yy      DB 0
    ENDSTRUCT
after:
    RET
`;

let dir: string;
let file: string;

beforeAll(() => {
    dir  = fs.mkdtempSync(path.join(os.tmpdir(), "srcmap-"));
    file = path.join(dir, "a.asm");
    fs.writeFileSync(file, SRC, "utf-8");
});

afterAll(() => { fs.rmSync(dir, { recursive: true, force: true }); });

const lineOf = (needle: string) => SRC.split("\n").findIndex(l => l.includes(needle)) + 1;

describe("SourceMap addressing", () => {
    it("anchors on ORG without a symbol file", () => {
        const map = SourceMap.build(file, null);
        expect(map.getAddress(file, lineOf("start:"))).toBe(0x8000);
        expect(map.getAddress(file, lineOf("LD A,1"))).toBe(0x8000);
    });

    it("advances over instructions and data, including labels without a colon", () => {
        const map = SourceMap.build(file, null);
        expect(map.getAddress(file, lineOf("LD HL,"))).toBe(0x8002);  // after LD A,1 (2 bytes)
        expect(map.getAddress(file, lineOf("data "))).toBe(0x8005);   // after LD HL,nn (3 bytes)
        expect(map.getAddress(file, lineOf("after:"))).toBe(0x8007);  // after DB 1,2
    });

    it("does not let a STRUCT definition consume address space", () => {
        const map = SourceMap.build(file, null);
        expect(map.getAddress(file, lineOf("RET"))).toBe(0x8007);
        expect(map.getAddress(file, lineOf("xx "))).toBeUndefined();
    });

    it("maps addresses back to their source line", () => {
        const map = SourceMap.build(file, null);
        expect(map.getLine(0x8007)).toEqual({ file, line: lineOf("after:") });
        expect(map.getNearestLine(0x8008)).toEqual({ file, line: lineOf("RET") });
    });

    it("lets the symbol file override the parsed address", () => {
        const table = { resolveLabel: (n: string) => (n === "after" ? 0x9000 : undefined) } as any;
        const map = SourceMap.build(file, table);
        expect(map.getAddress(file, lineOf("after:"))).toBe(0x9000);
        expect(map.data.get("data")!.address).toBe(0x8005);   // untouched, not in the table
    });
});
