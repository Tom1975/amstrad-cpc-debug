import * as vscode from "vscode";

// Labels globaux RASM : identifiant alphanumérique en colonne 0, suivi de ':'
// Labels locaux : commencent par '.' (convention RASM pour les labels locaux au label parent)
const RE_GLOBAL = /^([A-Za-z_][A-Za-z0-9_]*)\s*:/;
const RE_LOCAL  = /^(\.[A-Za-z0-9_][A-Za-z0-9_]*)\s*:/;

export class AsmSymbolProvider implements vscode.DocumentSymbolProvider {
    provideDocumentSymbols(
        document: vscode.TextDocument,
        _token: vscode.CancellationToken
    ): vscode.DocumentSymbol[] {
        const symbols: vscode.DocumentSymbol[] = [];
        let current: vscode.DocumentSymbol | undefined;
        const lineCount = document.lineCount;

        for (let i = 0; i < lineCount; i++) {
            const text = document.lineAt(i).text;

            const gm = RE_GLOBAL.exec(text);
            if (gm) {
                if (current) {
                    current.range = new vscode.Range(current.range.start, document.lineAt(i - 1).range.end);
                }
                const nameRange = new vscode.Range(i, 0, i, gm[1].length);
                current = new vscode.DocumentSymbol(
                    gm[1], "",
                    vscode.SymbolKind.Function,
                    document.lineAt(i).range,
                    nameRange
                );
                symbols.push(current);
                continue;
            }

            const lm = RE_LOCAL.exec(text);
            if (lm && current) {
                const nameRange = new vscode.Range(i, 0, i, lm[1].length);
                current.children.push(new vscode.DocumentSymbol(
                    lm[1], "",
                    vscode.SymbolKind.Field,
                    document.lineAt(i).range,
                    nameRange
                ));
            }
        }

        if (current) {
            current.range = new vscode.Range(current.range.start, document.lineAt(lineCount - 1).range.end);
        }

        return symbols;
    }
}
