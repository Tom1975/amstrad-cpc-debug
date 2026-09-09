import * as vscode from "vscode";
import * as nodePath from "path";

// Même regex que ResourceIndex — capture le chemin dans les 3 variantes de guillemets
const INCBIN_RE = /^\s*INCBIN\s+(?:"([^"]+)"|'([^']+)'|(\S+))/i;

export class AsmLinkProvider implements vscode.DocumentLinkProvider {

    static register(): vscode.Disposable {
        return vscode.languages.registerDocumentLinkProvider(
            [{ language: "asm" }, { language: "z80-disasm" }],
            new AsmLinkProvider()
        );
    }

    provideDocumentLinks(
        document: vscode.TextDocument,
        _token: vscode.CancellationToken
    ): vscode.DocumentLink[] {
        const links: vscode.DocumentLink[] = [];
        const dir = nodePath.dirname(document.uri.fsPath);

        for (let i = 0; i < document.lineCount; i++) {
            const line = document.lineAt(i).text;
            const m = INCBIN_RE.exec(line);
            if (!m) continue;

            const rawPath = m[1] ?? m[2] ?? m[3];
            if (!rawPath) continue;

            // Trouver la position du chemin dans la ligne
            const pathStart = line.indexOf(rawPath, line.toUpperCase().indexOf("INCBIN") + 6);
            if (pathStart === -1) continue;

            const range = new vscode.Range(i, pathStart, i, pathStart + rawPath.length);
            const target = vscode.Uri.file(nodePath.resolve(dir, rawPath));
            const link = new vscode.DocumentLink(range, target);
            link.tooltip = `Ouvrir ${rawPath}`;
            links.push(link);
        }

        return links;
    }
}
