import * as vscode from "vscode";

// A variable reference as written in the source: a name, then any number of
// .field and [index] accessors — "player", "player.pos.x", "enemies[2].hp".
const NAME_CHAR  = /[A-Za-z0-9_.@]/;
const ACCESSOR   = /^(?:\.[A-Za-z_][A-Za-z0-9_]*|\[\s*[#%0-9A-Fa-fxX]+\s*\])/;

/**
 * Tells VS Code which text to evaluate when hovering the assembler source
 * during a debug session.  The debug adapter resolves the expression against
 * the variables declared in the source, so hovering `player.hp` shows its
 * current value instead of VS Code's plain-word guess (`hp`).
 */
export class AsmEvaluatableExpressionProvider implements vscode.EvaluatableExpressionProvider {

    static register(): vscode.Disposable {
        return vscode.languages.registerEvaluatableExpressionProvider(
            [{ language: "asm" }, { language: "z80-disasm" }],
            new AsmEvaluatableExpressionProvider()
        );
    }

    provideEvaluatableExpression(
        document: vscode.TextDocument,
        position: vscode.Position
    ): vscode.ProviderResult<vscode.EvaluatableExpression> {
        const line = document.lineAt(position.line).text;

        // A ; comment holds no evaluatable expression
        const commentAt = line.indexOf(";");
        if (commentAt >= 0 && position.character > commentAt) return undefined;

        // Widen left over the name (dots included, so "player.pos" stays whole)
        let start = position.character;
        while (start > 0 && NAME_CHAR.test(line[start - 1])) start--;

        // Widen right over the name, then over any accessor chain
        let end = position.character;
        while (end < line.length && NAME_CHAR.test(line[end])) end++;
        while (end < line.length) {
            const m = ACCESSOR.exec(line.slice(end));
            if (!m) break;
            end += m[0].length;
        }

        if (end <= start) return undefined;
        let text = line.slice(start, end);

        // A leading label definition ("counter: DB 0") is not a value to read
        // while it is the label itself being hovered, but its name is — keep it.
        text = text.replace(/[.:]+$/, "");
        if (!/^[A-Za-z_@.]/.test(text)) return undefined;

        return new vscode.EvaluatableExpression(
            new vscode.Range(position.line, start, position.line, start + text.length),
            text
        );
    }
}
