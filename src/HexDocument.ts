import * as vscode from "vscode";

export interface HexEdit {
    offset:   number;
    oldValue: number;
    newValue: number;
}

export class HexDocument implements vscode.CustomDocument {
    readonly uri: vscode.Uri;
    private _data:  Uint8Array;
    private _dirty: Map<number, number> = new Map(); // offset → new value

    private constructor(uri: vscode.Uri, data: Uint8Array) {
        this.uri  = uri;
        this._data = data;
    }

    static async create(uri: vscode.Uri): Promise<HexDocument> {
        const raw = await vscode.workspace.fs.readFile(uri);
        return new HexDocument(uri, new Uint8Array(raw));
    }

    get size(): number { return this._data.length; }
    get isDirty(): boolean { return this._dirty.size > 0; }

    getBytes(offset: number, count: number): number[] {
        const end = Math.min(offset + count, this._data.length);
        const arr: number[] = [];
        for (let i = offset; i < end; i++) {
            arr.push(this._dirty.has(i) ? this._dirty.get(i)! : this._data[i]);
        }
        return arr;
    }

    /** Apply a new byte value; returns an edit record for undo/redo. */
    setByte(offset: number, newValue: number): HexEdit {
        const oldValue = this._dirty.has(offset) ? this._dirty.get(offset)! : this._data[offset];
        if (newValue === this._data[offset]) {
            this._dirty.delete(offset);
        } else {
            this._dirty.set(offset, newValue);
        }
        return { offset, oldValue, newValue };
    }

    /** Undo: restore old value. */
    revertEdit(edit: HexEdit): void {
        if (edit.oldValue === this._data[edit.offset]) {
            this._dirty.delete(edit.offset);
        } else {
            this._dirty.set(edit.offset, edit.oldValue);
        }
    }

    /** Redo: re-apply new value. */
    applyEdit(edit: HexEdit): void {
        if (edit.newValue === this._data[edit.offset]) {
            this._dirty.delete(edit.offset);
        } else {
            this._dirty.set(edit.offset, edit.newValue);
        }
    }

    async save(cancellation: vscode.CancellationToken): Promise<void> {
        await this._writeTo(this.uri, cancellation);
    }

    async saveAs(destination: vscode.Uri, cancellation: vscode.CancellationToken): Promise<void> {
        await this._writeTo(destination, cancellation);
    }

    revert(): void {
        this._dirty.clear();
    }

    getRawData(): Uint8Array { return this._data; }

    /** Returns offsets of all occurrences of pattern in the file (dirty bytes included). */
    search(pattern: number[]): number[] {
        if (pattern.length === 0 || pattern.length > this._data.length) return [];
        const buf = this._dirty.size > 0 ? this._workingBuffer() : this._data;
        const results: number[] = [];
        outer: for (let i = 0; i <= buf.length - pattern.length; i++) {
            for (let j = 0; j < pattern.length; j++) {
                if (buf[i + j] !== pattern[j]) continue outer;
            }
            results.push(i);
        }
        return results;
    }

    private _workingBuffer(): Uint8Array {
        const buf = new Uint8Array(this._data);
        for (const [off, val] of this._dirty) buf[off] = val;
        return buf;
    }

    private async _writeTo(uri: vscode.Uri, cancellation: vscode.CancellationToken): Promise<void> {
        const buf = new Uint8Array(this._data);
        for (const [off, val] of this._dirty) buf[off] = val;
        if (!cancellation.isCancellationRequested) {
            await vscode.workspace.fs.writeFile(uri, buf);
            // Dirty becomes new baseline
            for (const [off, val] of this._dirty) this._data[off] = val;
            this._dirty.clear();
        }
    }

    dispose(): void {}
}
