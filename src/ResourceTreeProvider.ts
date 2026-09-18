import * as vscode from "vscode";
import * as nodePath from "path";
import { ResourceIndex, ResourceEntry, ResourceRef } from "./ResourceIndex";

// ── Types de nœuds ────────────────────────────────────────────────────────────

type ResNode = CategoryNode | FileNode | RefNode;

class CategoryNode extends vscode.TreeItem {
    kind = "category" as const;
    constructor(
        readonly ext: string,
        readonly entries: ResourceEntry[]
    ) {
        const label = CategoryNode._label(ext);
        super(label, vscode.TreeItemCollapsibleState.Expanded);
        this.iconPath = new vscode.ThemeIcon(CategoryNode._icon(ext));
        this.id = "cat:" + ext;
    }
    private static _label(ext: string): string {
        const map: Record<string, string> = {
            ".scr": "Écrans (.scr)",
            ".bin": "Binaires (.bin)",
            ".pal": "Palettes (.pal)",
            ".sna": "Snapshots (.sna)",
        };
        return map[ext] ?? `Ressources (${ext || "sans extension"})`;
    }
    private static _icon(ext: string): string {
        const map: Record<string, string> = {
            ".scr": "device-desktop",
            ".bin": "file-binary",
            ".pal": "symbol-color",
            ".sna": "save",
        };
        return map[ext] ?? "file";
    }
}

class FileNode extends vscode.TreeItem {
    kind = "file" as const;
    constructor(readonly entry: ResourceEntry) {
        const n = entry.refs.length;
        super(
            nodePath.basename(entry.workspaceRelative),
            vscode.TreeItemCollapsibleState.Collapsed
        );
        this.description = `${n} ref${n > 1 ? "s" : ""}`;
        this.tooltip = entry.workspaceRelative;
        this.iconPath = new vscode.ThemeIcon("file");
        this.id = "file:" + entry.uri.fsPath;
        this.command = {
            command: "vscode.open",
            title: "Ouvrir",
            arguments: [entry.uri],
        };
        this.contextValue = "cpcResource";
    }
}

class RefNode extends vscode.TreeItem {
    kind = "ref" as const;
    constructor(readonly ref: ResourceRef) {
        const basename = nodePath.basename(ref.asmFile);
        super(`${basename}:${ref.line}`, vscode.TreeItemCollapsibleState.None);
        this.description = ref.rawPath;
        this.tooltip = `${ref.asmFile}:${ref.line}`;
        this.iconPath = new vscode.ThemeIcon("references");
        this.id = `ref:${ref.asmFile}:${ref.line}`;
        this.command = {
            command: "vscode.open",
            title: "Aller à la référence",
            arguments: [
                vscode.Uri.file(ref.asmFile),
                {
                    selection: new vscode.Range(ref.line - 1, 0, ref.line - 1, 999),
                } as vscode.TextDocumentShowOptions,
            ],
        };
    }
}

// ── Provider ──────────────────────────────────────────────────────────────────

export class ResourceTreeProvider implements vscode.TreeDataProvider<ResNode> {

    private _onDidChangeTreeData = new vscode.EventEmitter<ResNode | undefined | void>();
    readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

    constructor(private readonly index: ResourceIndex) {
        index.onDidChange(() => this._onDidChangeTreeData.fire());
    }

    getTreeItem(node: ResNode): vscode.TreeItem { return node; }

    getChildren(node?: ResNode): ResNode[] {
        if (!node) {
            // Root: group entries by extension
            const byExt = new Map<string, ResourceEntry[]>();
            for (const entry of this.index.entries) {
                const list = byExt.get(entry.ext) ?? [];
                list.push(entry);
                byExt.set(entry.ext, list);
            }
            if (byExt.size === 0) return [];

            // Sort: .scr first, then .bin, .pal, alphabetically for the rest
            const order = [".scr", ".bin", ".pal", ".sna"];
            const sorted = [...byExt.keys()].sort((a, b) => {
                const ai = order.indexOf(a), bi = order.indexOf(b);
                if (ai !== -1 && bi !== -1) return ai - bi;
                if (ai !== -1) return -1;
                if (bi !== -1) return 1;
                return a.localeCompare(b);
            });
            return sorted.map(ext => new CategoryNode(ext, byExt.get(ext)!));
        }

        if (node instanceof CategoryNode) {
            return node.entries
                .sort((a, b) => a.workspaceRelative.localeCompare(b.workspaceRelative))
                .map(e => new FileNode(e));
        }

        if (node instanceof FileNode) {
            return node.entry.refs.map(r => new RefNode(r));
        }

        return [];
    }

    refresh(): void { this._onDidChangeTreeData.fire(); }
}
