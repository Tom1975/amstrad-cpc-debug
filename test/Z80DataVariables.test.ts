import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { Z80DebugSession } from "../src/Z80DebugSession";
import { SourceMap } from "../src/SourceMap";

const SCOPE_DATA = 4;

const MAIN = `
    ORG #4000

    STRUCT point
xx      DB 0
yy      DB 0
    ENDSTRUCT

start:
    RET

counter:    DB 0
score:      DW 0
table:      DB 1,2,3,4
player      point
`;

let dir: string;
let mainPath: string;

beforeAll(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "dapvars-"));
    mainPath = path.join(dir, "main.asm");
    fs.writeFileSync(mainPath, MAIN, "utf-8");
});

afterAll(() => { fs.rmSync(dir, { recursive: true, force: true }); });

interface Harness {
    session: any;
    sent: any[];
    /** Memory seen by the fake emulator, address → byte. */
    mem: Map<number, number>;
}

/** A debug session wired to an in-memory emulator and a parsed source. */
function harness(withSource = true): Harness {
    const session: any = new Z80DebugSession();
    const sent: any[] = [];
    const mem = new Map<number, number>();

    session.emulator = {
        send: async (req: any) => {
            sent.push(req);
            if (req.cmd === "readMemory") {
                const bytes: number[] = [];
                for (let i = 0; i < req.size; i++) bytes.push(mem.get(req.address + i) ?? 0);
                return { bytes };
            }
            if (req.cmd === "writeMemory") {
                req.bytes.forEach((b: number, i: number) => mem.set(req.address + i, b));
                return { status: "ok" };
            }
            return {};
        },
    };
    if (withSource) session.sourceMap = SourceMap.build(mainPath, null);
    return { session, sent, mem };
}

/** Run a protected request and return the response body it filled in. */
async function request(session: any, method: string, args: any): Promise<any> {
    const response: any = { body: undefined };
    session.sendResponse = (r: any) => { /* captured through the same object */ };
    session.sendErrorResponse = (r: any, code: number, msg: string) => {
        response.error = { code, message: msg };
    };
    await session[method](response, args);
    return response;
}

const addrOf = (session: any, name: string): number =>
    session.sourceMap.data.get(name).address;

// ─── Scopes ───────────────────────────────────────────────────────────────────

describe("scopesRequest", () => {
    it("offers the Variables scope when the source declares data", async () => {
        const { session } = harness();
        const res = await request(session, "scopesRequest", {});
        expect(res.body.scopes.map((s: any) => s.name))
            .toEqual(["Registers", "Variables", "Memory", "Stack"]);
    });

    it("hides it when no source was parsed", async () => {
        const { session } = harness(false);
        const res = await request(session, "scopesRequest", {});
        expect(res.body.scopes.map((s: any) => s.name)).not.toContain("Variables");
    });
});

// ─── Variables tree ───────────────────────────────────────────────────────────

describe("variablesRequest — source variables", () => {
    it("lists every declared variable with its value and address", async () => {
        const { session, mem } = harness();
        mem.set(addrOf(session, "counter"), 0x41);
        mem.set(addrOf(session, "score"), 0x34);
        mem.set(addrOf(session, "score") + 1, 0x12);

        const res = await request(session, "variablesRequest", { variablesReference: SCOPE_DATA });
        const vars: any[] = res.body.variables;
        const by = (n: string) => vars.find(v => v.name === n);

        expect(vars.map(v => v.name)).toEqual(["counter", "score", "table", "player"]);
        expect(by("counter").value).toBe("0x41 (65) 'A'");
        expect(by("score").value).toBe("0x1234 (4660)");
        expect(by("counter").type).toContain("byte @0x");
        expect(by("counter").evaluateName).toBe("counter");
        expect(by("counter").memoryReference)
            .toBe("0x" + addrOf(session, "counter").toString(16).toUpperCase().padStart(4, "0"));
        expect(by("counter").variablesReference).toBe(0);      // scalar: leaf
    });

    it("merges nearby reads into a single request", async () => {
        const { session, sent } = harness();
        await request(session, "variablesRequest", { variablesReference: SCOPE_DATA });
        expect(sent.filter(r => r.cmd === "readMemory")).toHaveLength(1);
    });

    it("expands an array into its elements", async () => {
        const { session, mem } = harness();
        const base = addrOf(session, "table");
        [10, 20, 30, 40].forEach((v, i) => mem.set(base + i, v));

        const root = await request(session, "variablesRequest", { variablesReference: SCOPE_DATA });
        const table = root.body.variables.find((v: any) => v.name === "table");
        expect(table.variablesReference).toBeGreaterThan(0);
        expect(table.indexedVariables).toBe(4);

        const children = await request(session, "variablesRequest",
            { variablesReference: table.variablesReference });
        expect(children.body.variables.map((v: any) => v.name)).toEqual(["[0]", "[1]", "[2]", "[3]"]);
        expect(children.body.variables[2].value).toBe("0x1E (30)");
        expect(children.body.variables[2].evaluateName).toBe("table[2]");
    });

    it("expands a struct into its fields, with short labels", async () => {
        const { session, mem } = harness();
        const base = addrOf(session, "player");
        mem.set(base, 5);
        mem.set(base + 1, 9);

        const root = await request(session, "variablesRequest", { variablesReference: SCOPE_DATA });
        const player = root.body.variables.find((v: any) => v.name === "player");
        expect(player.value).toBe("{ xx: 0x05 (5), yy: 0x09 (9) }");

        const fields = await request(session, "variablesRequest",
            { variablesReference: player.variablesReference });
        expect(fields.body.variables.map((v: any) => v.name)).toEqual(["xx", "yy"]);
        expect(fields.body.variables[1].evaluateName).toBe("player.yy");
    });

    it("keeps a node handle stable across stops", async () => {
        const { session } = harness();
        const first  = await request(session, "variablesRequest", { variablesReference: SCOPE_DATA });
        const second = await request(session, "variablesRequest", { variablesReference: SCOPE_DATA });
        const h = (r: any) => r.body.variables.find((v: any) => v.name === "table").variablesReference;
        expect(h(first)).toBe(h(second));
    });

    it("returns nothing for an unknown handle", async () => {
        const { session } = harness();
        const res = await request(session, "variablesRequest", { variablesReference: 0xDEAD });
        expect(res.body.variables).toEqual([]);
    });
});

// ─── evaluate ─────────────────────────────────────────────────────────────────

describe("evaluateRequest", () => {
    it("evaluates a variable, a field and an element", async () => {
        const { session, mem } = harness();
        mem.set(addrOf(session, "counter"), 7);
        mem.set(addrOf(session, "player") + 1, 0x20);
        mem.set(addrOf(session, "table") + 3, 0xFF);

        expect((await request(session, "evaluateRequest", { expression: "counter" })).body.result)
            .toBe("0x07 (7)");
        expect((await request(session, "evaluateRequest", { expression: "player.yy" })).body.result)
            .toBe("0x20 (32) ' '");
        expect((await request(session, "evaluateRequest", { expression: "table[3]" })).body.result)
            .toBe("0xFF (255)");
    });

    it("returns an expandable reference for aggregates", async () => {
        const { session } = harness();
        const res = await request(session, "evaluateRequest", { expression: "player" });
        expect(res.body.variablesReference).toBeGreaterThan(0);
        const fields = await request(session, "variablesRequest",
            { variablesReference: res.body.variablesReference });
        expect(fields.body.variables.map((v: any) => v.name)).toEqual(["xx", "yy"]);
    });

    it("leaves register names to the emulator", async () => {
        const { session, sent } = harness();
        session.emulator.send = async (req: any) => {
            sent.push(req);
            return req.cmd === "evaluate" ? { text: "0x1234" } : {};
        };
        const res = await request(session, "evaluateRequest", { expression: "HL" });
        expect(res.body.result).toBe("0x1234");
        expect(sent.some(r => r.cmd === "evaluate")).toBe(true);
    });

    it("falls back to the symbol table for code labels", async () => {
        const { session } = harness();
        // The emulator answers "?" for a name it does not know
        session.emulator.send = async () => ({ text: "?" });
        session.symbolTable = { resolveLabel: (n: string) => (n === "start" ? 0x4000 : undefined) };
        const res = await request(session, "evaluateRequest", { expression: "start" });
        expect(res.body.result).toBe("0x4000");
        expect(res.body.type).toBe("label");
    });

    it("reports unknown expressions", async () => {
        const { session } = harness();
        const res = await request(session, "evaluateRequest", { expression: "nosuchthing" });
        expect(res.body.result).toBe("?");
    });
});

// ─── Writing ──────────────────────────────────────────────────────────────────

describe("setVariableRequest / setExpressionRequest", () => {
    it("writes a scalar from the tree", async () => {
        const { session, mem } = harness();
        const res = await request(session, "setVariableRequest",
            { variablesReference: SCOPE_DATA, name: "score", value: "0x1234" });

        expect(res.body.value).toBe("0x1234 (4660)");
        const base = addrOf(session, "score");
        expect([mem.get(base), mem.get(base + 1)]).toEqual([0x34, 0x12]);   // little-endian
    });

    it("writes a struct field addressed by its short name", async () => {
        const { session, mem } = harness();
        const root = await request(session, "variablesRequest", { variablesReference: SCOPE_DATA });
        const player = root.body.variables.find((v: any) => v.name === "player");

        await request(session, "setVariableRequest",
            { variablesReference: player.variablesReference, name: "yy", value: "42" });
        expect(mem.get(addrOf(session, "player") + 1)).toBe(42);
    });

    it("refuses to assign to an aggregate", async () => {
        const { session } = harness();
        const res = await request(session, "setVariableRequest",
            { variablesReference: SCOPE_DATA, name: "table", value: "0" });
        expect(res.error.message).toContain("not a scalar");
    });

    it("writes through a watch expression", async () => {
        const { session, mem } = harness();
        const res = await request(session, "setExpressionRequest",
            { expression: "table[2]", value: "'Z'" });
        expect(res.body.value).toBe("0x5A (90) 'Z'");
        expect(mem.get(addrOf(session, "table") + 2)).toBe(0x5A);
    });

    it("rejects an unknown expression", async () => {
        const { session } = harness();
        const res = await request(session, "setExpressionRequest",
            { expression: "nosuchthing", value: "1" });
        expect(res.error.message).toContain("not a known source variable");
    });

    it("still writes registers", async () => {
        const { session, sent } = harness();
        const res = await request(session, "setVariableRequest",
            { variablesReference: 1, name: "HL", value: "0x8000" });
        expect(sent).toContainEqual({ cmd: "setRegisters", hl: 0x8000 });
        expect(res.body.value).toBe("0x8000");
    });
});
