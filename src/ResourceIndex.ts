import * as vscode from "vscode";
import * as nodePath from "path";

export interface ResourceRef {
    asmFile: string;   // chemin absolu
    line: number;      // 1-based
    rawPath: string;   // chemin tel qu'écrit dans le source
}

export interface ResourceEntry {
    uri: vscode.Uri;
    workspaceRelative: string;
    ext: string;           // ".scr", ".bin", etc. (lowercase)
    refs: ResourceRef[];
}

// Regex INCBIN : INCBIN "path" ou INCBIN 'path' ou INCBIN path
// Capture le chemin (groupe 1 ou 2)
const INCBIN_RE = /^\s*INCBIN\s+(?:"([^"]+)"|'([^']+)'|(\S+))/i;

export class ResourceIndex {
    private _entries = new Map<string, ResourceEntry>(); // key = normalised abs path
    private _onDidChange = new vscode.EventEmitter<void>();
    readonly onDidChange = this._onDidChange.event;

    private _watcher: vscode.FileSystemWatcher | undefined;

    async start(): Promise<void> {
        await this.scan();

        this._watcher = vscode.workspace.createFileSystemWatcher("**/*.{asm,s}");
        this._watcher.onDidChange(() => this.scan());
        this._watcher.onDidCreate(() => this.scan());
        this._watcher.onDidDelete(() => this.scan());
    }

    dispose(): void {
        this._watcher?.dispose();
        this._onDidChange.dispose();
    }

    get entries(): ResourceEntry[] {
        return [...this._entries.values()];
    }

    async scan(): Promise<void> {
        const asmFiles = await vscode.workspace.findFiles("**/*.{asm,s}", "**/node_modules/**");
        const newMap = new Map<string, ResourceEntry>();

        await Promise.all(asmFiles.map(async (asmUri) => {
            const asmDir = nodePath.dirname(asmUri.fsPath);
            let text: string;
            try {
                const bytes = await vscode.workspace.fs.readFile(asmUri);
                text = Buffer.from(bytes).toString("utf8");
            } catch { return; }

            const lines = text.split(/\r?\n/);
            for (let i = 0; i < lines.length; i++) {
                const m = INCBIN_RE.exec(lines[i]);
                if (!m) continue;
                const rawPath = m[1] ?? m[2] ?? m[3];
                if (!rawPath) continue;

                // Resolve relative to ASM file directory
                const resolved = nodePath.resolve(asmDir, rawPath);
                const key = resolved.replace(/\\/g, "/").toLowerCase();

                let entry = newMap.get(key);
                if (!entry) {
                    const wsRoot = vscode.workspace.getWorkspaceFolder(asmUri)?.uri.fsPath ?? asmDir;
                    const rel = nodePath.relative(wsRoot, resolved).replace(/\\/g, "/");
                    entry = {
                        uri: vscode.Uri.file(resolved),
                        workspaceRelative: rel,
                        ext: nodePath.extname(resolved).toLowerCase(),
                        refs: [],
                    };
                    newMap.set(key, entry);
                }
                entry.refs.push({
                    asmFile: asmUri.fsPath,
                    line: i + 1,
                    rawPath,
                });
            }
        }));

        this._entries = newMap;
        this._onDidChange.fire();
    }
}
