import { AsmEvaluatableExpressionProvider } from "../src/AsmEvaluatableExpressionProvider";

const provider = new AsmEvaluatableExpressionProvider();

/** Expression the provider would send to the debug adapter, or undefined. */
function exprAt(line: string, cursor: number): string | undefined {
    const document = { lineAt: () => ({ text: line }) } as any;
    const position = { line: 0, character: cursor } as any;
    const result = provider.provideEvaluatableExpression(document, position) as any;
    return result?.expression;
}

/** Cursor placed on the first character of `needle`. */
function exprOn(line: string, needle: string): string | undefined {
    return exprAt(line, line.indexOf(needle));
}

describe("AsmEvaluatableExpressionProvider", () => {
    it("picks up a plain symbol", () => {
        expect(exprOn("    LD A,(counter)", "counter")).toBe("counter");
    });

    it("keeps a struct field chain whole", () => {
        expect(exprOn("    LD A,(player.pos.xx)", "player")).toBe("player.pos.xx");
        // Cursor in the middle of the chain widens both ways
        expect(exprOn("    LD A,(player.pos.xx)", "pos")).toBe("player.pos.xx");
    });

    it("includes array indexing", () => {
        expect(exprOn("    LD HL,enemies[2].hp", "enemies")).toBe("enemies[2].hp");
        expect(exprOn("    LD A,(table[3])", "table")).toBe("table[3]");
    });

    it("keeps the name of a label definition", () => {
        expect(exprOn("counter:    DB 0", "counter")).toBe("counter");
    });

    it("ignores comments", () => {
        const line = "    LD A,1        ; counter is unused";
        expect(exprOn(line, "counter")).toBeUndefined();
    });

    it("ignores numbers and empty positions", () => {
        expect(exprOn("    LD A,#FF", "#FF")).toBeUndefined();
        expect(exprAt("    LD A,1", 2)).toBeUndefined();
    });
});
