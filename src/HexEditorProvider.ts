import * as vscode from "vscode";
import * as nodePath from "path";
import { HexDocument, HexEdit } from "./HexDocument";
import { getRegions, HexRegion } from "./HexFormatter";

export class HexEditorProvider implements vscode.CustomEditorProvider<HexDocument> {

    private readonly _onDidChangeCustomDocument =
        new vscode.EventEmitter<vscode.CustomDocumentEditEvent<HexDocument>>();
    readonly onDidChangeCustomDocument = this._onDidChangeCustomDocument.event;

    // Track all open webview panels per document URI (for multi-view sync)
    private readonly _panels = new Map<string, vscode.WebviewPanel[]>();

    static register(context: vscode.ExtensionContext): vscode.Disposable {
        return vscode.window.registerCustomEditorProvider(
            "z80debug.hexEditor",
            new HexEditorProvider(),
            {
                supportsMultipleEditorsPerDocument: true,
                webviewOptions: { retainContextWhenHidden: true }
            }
        );
    }

    // ── CustomEditorProvider lifecycle ────────────────────────────────────────

    async openCustomDocument(
        uri: vscode.Uri,
        _openContext: vscode.CustomDocumentOpenContext,
        _token: vscode.CancellationToken
    ): Promise<HexDocument> {
        return HexDocument.create(uri);
    }

    async saveCustomDocument(
        document: HexDocument,
        cancellation: vscode.CancellationToken
    ): Promise<void> {
        await document.save(cancellation);
        this._broadcast(document, { type: "savedState", isDirty: false });
    }

    async saveCustomDocumentAs(
        document: HexDocument,
        destination: vscode.Uri,
        cancellation: vscode.CancellationToken
    ): Promise<void> {
        await document.saveAs(destination, cancellation);
    }

    async revertCustomDocument(document: HexDocument): Promise<void> {
        document.revert();
        this._broadcast(document, { type: "revertAll" });
    }

    async backupCustomDocument(
        document: HexDocument,
        context: vscode.CustomDocumentBackupContext,
        cancellation: vscode.CancellationToken
    ): Promise<vscode.CustomDocumentBackup> {
        await document.saveAs(context.destination, cancellation);
        return {
            id: context.destination.toString(),
            delete: () => vscode.workspace.fs.delete(context.destination).then(() => {}, () => {})
        };
    }

    // ── Webview ───────────────────────────────────────────────────────────────

    async resolveCustomEditor(
        document: HexDocument,
        webviewPanel: vscode.WebviewPanel,
        _token: vscode.CancellationToken
    ): Promise<void> {
        webviewPanel.webview.options = { enableScripts: true };
        webviewPanel.webview.html = this._buildHtml();

        // Register panel for broadcast
        const key = document.uri.toString();
        if (!this._panels.has(key)) this._panels.set(key, []);
        this._panels.get(key)!.push(webviewPanel);
        webviewPanel.onDidDispose(() => {
            const arr = this._panels.get(key) ?? [];
            const idx = arr.indexOf(webviewPanel);
            if (idx >= 0) arr.splice(idx, 1);
        });

        const regions = getRegions(nodePath.basename(document.uri.fsPath), document.getRawData());

        webviewPanel.webview.onDidReceiveMessage(async msg => {
            switch (msg.type) {
                case "ready":
                    webviewPanel.webview.postMessage({
                        type: "init",
                        totalSize: document.size,
                        filename: nodePath.basename(document.uri.fsPath),
                        isDirty: document.isDirty,
                        regions
                    });
                    break;

                case "requestRange":
                    webviewPanel.webview.postMessage({
                        type: "data",
                        startOffset: msg.startOffset,
                        bytes: document.getBytes(msg.startOffset, msg.count)
                    });
                    break;

                case "search": {
                    const offsets = document.search(msg.pattern as number[]);
                    webviewPanel.webview.postMessage({ type: "searchResults", offsets, patternLen: (msg.pattern as number[]).length });
                    break;
                }

                case "editByte": {
                    const edit: HexEdit = document.setByte(msg.offset, msg.value);
                    this._onDidChangeCustomDocument.fire({
                        document,
                        label: `Edit 0x${msg.offset.toString(16).toUpperCase()}`,
                        undo: async () => {
                            document.revertEdit(edit);
                            this._broadcast(document, {
                                type: "byteChanged",
                                offset: edit.offset,
                                value: edit.oldValue,
                                isDirty: document.isDirty
                            });
                        },
                        redo: async () => {
                            document.applyEdit(edit);
                            this._broadcast(document, {
                                type: "byteChanged",
                                offset: edit.offset,
                                value: edit.newValue,
                                isDirty: document.isDirty
                            });
                        }
                    });
                    this._broadcast(document, {
                        type: "byteChanged",
                        offset: edit.offset,
                        value: edit.newValue,
                        isDirty: document.isDirty
                    });
                    break;
                }
            }
        });
    }

    private _broadcast(document: HexDocument, msg: object): void {
        for (const panel of this._panels.get(document.uri.toString()) ?? []) {
            panel.webview.postMessage(msg);
        }
    }

    // ── HTML ──────────────────────────────────────────────────────────────────

    private _buildHtml(): string {
        return /* html */`<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline';">
<style>
* { box-sizing: border-box; margin: 0; padding: 0; }
body {
  font-family: var(--vscode-editor-font-family, 'Consolas','Courier New',monospace);
  font-size: var(--vscode-editor-font-size, 13px);
  line-height: 1;
  background: var(--vscode-editor-background);
  color: var(--vscode-editor-foreground);
  height: 100vh;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}
#toolbar {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 4px 8px;
  border-bottom: 1px solid var(--vscode-editorWidget-border, #444);
  background: var(--vscode-editorGroupHeader-tabsBackground, var(--vscode-editor-background));
  font-size: 11px;
  flex-shrink: 0;
  user-select: none;
}
#info { color: var(--vscode-descriptionForeground); }
#dirty-badge {
  color: var(--vscode-gitDecoration-modifiedResourceForeground, #e2c08d);
  display: none;
}
#header {
  padding: 3px 8px;
  border-bottom: 1px solid var(--vscode-editorWidget-border, #444);
  background: var(--vscode-editorGutter-background, var(--vscode-editor-background));
  color: var(--vscode-editorLineNumber-foreground);
  font-family: inherit;
  font-size: inherit;
  white-space: pre;
  flex-shrink: 0;
  user-select: none;
}
#scroll-outer {
  flex: 1;
  overflow-y: scroll;
  overflow-x: auto;
  position: relative;
  outline: none;
}
#spacer { position: relative; }
#rows {
  position: absolute;
  left: 0; right: 0;
  padding: 0 8px;
}
.row {
  height: 20px;
  line-height: 20px;
  white-space: pre;
  cursor: default;
  display: flex;
  align-items: center;
}
.row:hover { background: var(--vscode-editor-hoverHighlightBackground, rgba(128,128,128,0.1)); }
.col-off { color: var(--vscode-editorLineNumber-foreground); }
.col-hex { display: flex; align-items: center; }
.col-asc { color: var(--vscode-terminal-ansiBrightCyan, #4ec9b0); margin-left: 8px; display: flex; }
.hb, .ab { display: inline-block; }
.hb { width: 2ch; }
.hb + .hb { margin-left: 1ch; }
.hex-gap { width: 1ch; display: inline-block; }
.dirty { color: var(--vscode-gitDecoration-modifiedResourceForeground, #e2c08d) !important; }
.cursor-hex {
  background: var(--vscode-editorCursor-foreground, #aeafad);
  color: var(--vscode-editor-background);
  outline: 1px solid var(--vscode-focusBorder, #007fd4);
}
.cursor-asc {
  background: var(--vscode-editorCursor-foreground, #aeafad);
  color: var(--vscode-editor-background);
}
.pending-nibble { color: var(--vscode-editorWarning-foreground, #cca700); }
.search-match   { background: var(--vscode-editor-findMatchHighlightBackground, rgba(234,92,0,0.33)); }
.search-current { background: var(--vscode-editor-findMatchBackground, rgba(234,92,0,0.7)); color: var(--vscode-editor-foreground); }
#search-bar {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 3px 8px;
  border-bottom: 1px solid var(--vscode-editorWidget-border, #444);
  background: var(--vscode-editorWidget-background, var(--vscode-editor-background));
  flex-shrink: 0;
}
#search-input {
  font-family: inherit;
  font-size: 12px;
  padding: 2px 6px;
  background: var(--vscode-input-background);
  color: var(--vscode-input-foreground);
  border: 1px solid var(--vscode-input-border, #555);
  border-radius: 2px;
  width: 220px;
  outline: none;
}
#search-input:focus { border-color: var(--vscode-focusBorder, #007fd4); }
#search-input.no-match { border-color: var(--vscode-inputValidation-errorBorder, #be1100); }
#search-count { font-size: 11px; color: var(--vscode-descriptionForeground); min-width: 70px; }
#search-count.search-error { color: var(--vscode-inputValidation-errorForeground, #f48771); font-style: italic; }
#search-bar button {
  font-size: 12px;
  padding: 1px 6px;
  background: var(--vscode-button-secondaryBackground, transparent);
  color: var(--vscode-button-secondaryForeground, var(--vscode-foreground));
  border: 1px solid var(--vscode-button-border, #555);
  border-radius: 2px;
  cursor: pointer;
}
#search-bar button:hover { background: var(--vscode-button-secondaryHoverBackground, rgba(128,128,128,0.2)); }
#btn-mode.mode-hex {
  background: var(--vscode-button-background, #0e639c);
  color: var(--vscode-button-foreground, #fff);
  border-color: var(--vscode-button-background, #0e639c);
}
#btn-mode.mode-txt {
  background: var(--vscode-button-secondaryBackground, #3a3d41);
  color: var(--vscode-button-secondaryForeground, #ccc);
  border-color: var(--vscode-button-secondaryBackground, #3a3d41);
  font-style: italic;
}
#statusbar {
  border-top: 1px solid var(--vscode-editorWidget-border, #444);
  padding: 2px 8px;
  font-size: 11px;
  color: var(--vscode-descriptionForeground);
  flex-shrink: 0;
  user-select: none;
}
#legend {
  display: flex;
  flex-wrap: wrap;
  gap: 4px 12px;
  padding: 4px 8px;
  border-bottom: 1px solid var(--vscode-editorWidget-border, #444);
  background: var(--vscode-editorGroupHeader-tabsBackground, var(--vscode-editor-background));
  font-size: 11px;
  flex-shrink: 0;
  user-select: none;
}
#legend:empty { display: none; }
.legend-item { display: flex; align-items: center; gap: 4px; }
.legend-swatch {
  width: 12px; height: 12px;
  border-radius: 2px;
  border: 1px solid rgba(128,128,128,0.3);
  flex-shrink: 0;
}
</style>
</head>
<body>
<div id="toolbar">
  <span id="info">Chargement…</span>
  <span id="dirty-badge">● modifié</span>
</div>
<div id="legend"></div>
<div id="search-bar">
  <button id="btn-mode" title="Basculer entre recherche texte et hexadécimale (v4)">AUTO</button>
  <input id="search-input" placeholder="Texte à rechercher…" autocomplete="off" spellcheck="false" />
  <button id="btn-prev" title="Précédent (Shift+Entrée)">◀</button>
  <button id="btn-next" title="Suivant (Entrée)">▶</button>
  <span id="search-count"></span>
  <button id="btn-clear-search" title="Effacer">✕</button>
</div>
<div id="header"></div>
<div id="scroll-outer" tabindex="0">
  <div id="spacer"><div id="rows"></div></div>
</div>
<div id="statusbar">Offset : —</div>
<script>
const vscode = acquireVsCodeApi();

// ── Constants ─────────────────────────────────────────────────────────────────
const ROW_H  = 20;
const BPR    = 16;
const BUFFER = 80;

// ── State ─────────────────────────────────────────────────────────────────────
let totalSize   = 0;
let cache       = null;    // { startOffset, bytes: number[] }
let pending     = false;
let queued      = null;
const dirtyMap  = new Map(); // offset → current value (local mirror)

// Format regions (sorted by offset, non-overlapping)
let regions     = [];   // HexRegion[]

// Binary search: returns index of region containing offset, or -1
function getRegionIdx(offset) {
    let lo = 0, hi = regions.length - 1;
    while (lo <= hi) {
        const mid = (lo + hi) >> 1;
        const r   = regions[mid];
        if (offset < r.offset)               hi = mid - 1;
        else if (offset >= r.offset + r.length) lo = mid + 1;
        else return mid;
    }
    return -1;
}

// Cursor state
let cursor      = null;    // { offset, mode: 'hex'|'ascii' }
let nibble1     = null;    // first hex nibble typed (string)

// ── DOM ───────────────────────────────────────────────────────────────────────
const scrollOuter = document.getElementById('scroll-outer');
const spacer      = document.getElementById('spacer');
const rowsDiv     = document.getElementById('rows');
const infoEl      = document.getElementById('info');
const dirtyBadge  = document.getElementById('dirty-badge');
const statusEl    = document.getElementById('statusbar');

// ── Header ────────────────────────────────────────────────────────────────────
function buildHeader() {
    const hdr = document.getElementById('header');
    let s = '          '; // offset (8) + 2 spaces
    for (let i = 0; i < BPR; i++) {
        s += i.toString(16).toUpperCase().padStart(2,'0');
        s += i === 7 ? '   ' : ' ';
    }
    s += '  '; // gap to ASCII
    for (let i = 0; i < BPR; i++) s += i.toString(16).toUpperCase()[0];
    hdr.textContent = s;
}

// ── Row rendering ─────────────────────────────────────────────────────────────
function makeRow(rowIdx) {
    const off = rowIdx * BPR;
    if (off >= totalSize) return null;

    const div = document.createElement('div');
    div.className = 'row';
    div.dataset.off = off;

    // Offset
    const offSpan = document.createElement('span');
    offSpan.className = 'col-off';
    offSpan.textContent = off.toString(16).toUpperCase().padStart(8,'0') + '  ';
    div.appendChild(offSpan);

    // Hex group
    const hexGrp = document.createElement('span');
    hexGrp.className = 'col-hex';
    const cacheBase = off - cache.startOffset;
    for (let i = 0; i < BPR; i++) {
        if (i === 8) {
            const gap = document.createElement('span');
            gap.className = 'hex-gap';
            gap.textContent = ' ';
            hexGrp.appendChild(gap);
        }
        const bi  = cacheBase + i;
        const val = (off + i < totalSize) ? (dirtyMap.has(off + i) ? dirtyMap.get(off + i) : cache.bytes[bi]) : undefined;
        const hb  = document.createElement('span');
        hb.className = 'hb' + (dirtyMap.has(off + i) ? ' dirty' : '');
        hb.dataset.i = i;
        hb.textContent = val !== undefined ? val.toString(16).toUpperCase().padStart(2,'0') : '  ';
        const ri = (off + i < totalSize) ? getRegionIdx(off + i) : -1;
        if (ri >= 0) { hb.style.backgroundColor = regions[ri].color; hb.dataset.rc = regions[ri].color; }
        hexGrp.appendChild(hb);
    }
    div.appendChild(hexGrp);

    // ASCII group
    const ascGrp = document.createElement('span');
    ascGrp.className = 'col-asc';
    for (let i = 0; i < BPR; i++) {
        const bi  = cacheBase + i;
        const val = (off + i < totalSize) ? (dirtyMap.has(off + i) ? dirtyMap.get(off + i) : cache.bytes[bi]) : 32;
        const ab  = document.createElement('span');
        ab.className = 'ab' + (dirtyMap.has(off + i) ? ' dirty' : '');
        ab.dataset.i = i;
        ab.textContent = (val >= 32 && val < 127) ? String.fromCharCode(val) : '.';
        const ri2 = (off + i < totalSize) ? getRegionIdx(off + i) : -1;
        if (ri2 >= 0) { ab.style.backgroundColor = regions[ri2].color; ab.dataset.rc = regions[ri2].color; }
        ascGrp.appendChild(ab);
    }
    div.appendChild(ascGrp);

    return div;
}

// ── Viewport ──────────────────────────────────────────────────────────────────
function totalRows() { return Math.ceil(totalSize / BPR); }

function paintFromCache() {
    const top     = scrollOuter.scrollTop;
    const visible = Math.ceil(scrollOuter.clientHeight / ROW_H);
    const first   = Math.floor(top / ROW_H);
    const pStart  = Math.max(0, first - BUFFER);
    const pEnd    = Math.min(totalRows(), first + visible + BUFFER);

    rowsDiv.style.top = (pStart * ROW_H) + 'px';
    const frag = document.createDocumentFragment();
    for (let r = pStart; r < pEnd; r++) {
        const el = makeRow(r);
        if (el) frag.appendChild(el);
    }
    rowsDiv.innerHTML = '';
    rowsDiv.appendChild(frag);
    applyCursorHighlight();
    applySearchHighlights();
}

function inCache(first, visible) {
    if (!cache) return false;
    const s = Math.max(0, first - BUFFER) * BPR;
    const e = Math.min(totalRows(), first + visible + BUFFER) * BPR;
    return s >= cache.startOffset && e <= cache.startOffset + cache.bytes.length;
}

function fetchChunk(first, visible) {
    const s = Math.max(0, (first - BUFFER) * BPR);
    const e = Math.min(totalSize, (first + visible + BUFFER) * BPR);
    pending = true;
    vscode.postMessage({ type: 'requestRange', startOffset: s, count: e - s });
}

function updateViewport() {
    const top     = scrollOuter.scrollTop;
    const visible = Math.ceil(scrollOuter.clientHeight / ROW_H);
    const first   = Math.floor(top / ROW_H);
    if (inCache(first, visible)) {
        paintFromCache();
    } else if (!pending) {
        fetchChunk(first, visible);
    } else {
        queued = { first, visible };
    }
}

let rafId = null;
scrollOuter.addEventListener('scroll', () => {
    if (!rafId) rafId = requestAnimationFrame(() => { rafId = null; updateViewport(); });
});

// ── Cursor ────────────────────────────────────────────────────────────────────
function applyCursorHighlight() {
    document.querySelectorAll('.cursor-hex,.cursor-asc,.pending-nibble').forEach(el =>
        el.classList.remove('cursor-hex','cursor-asc','pending-nibble'));
    if (!cursor) return;
    const rowOff = Math.floor(cursor.offset / BPR) * BPR;
    const idx    = cursor.offset % BPR;
    const row    = rowsDiv.querySelector('.row[data-off="' + rowOff + '"]');
    if (!row) return;
    const hbs = row.querySelectorAll('.hb');
    const abs = row.querySelectorAll('.ab');
    if (cursor.mode === 'hex' && hbs[idx]) {
        hbs[idx].classList.add('cursor-hex');
        if (nibble1 !== null) hbs[idx].classList.add('pending-nibble');
    }
    if (cursor.mode === 'ascii' && abs[idx]) abs[idx].classList.add('cursor-asc');
}

function moveCursor(delta) {
    if (!cursor) return;
    nibble1 = null;
    const next = Math.max(0, Math.min(totalSize - 1, cursor.offset + delta));
    cursor = { offset: next, mode: cursor.mode };
    ensureCursorVisible();
    applyCursorHighlight();
    updateStatus(next);
}

function ensureCursorVisible() {
    if (!cursor) return;
    const row   = Math.floor(cursor.offset / BPR);
    const rowTop = row * ROW_H;
    if (rowTop < scrollOuter.scrollTop) {
        scrollOuter.scrollTop = rowTop;
    } else if (rowTop + ROW_H > scrollOuter.scrollTop + scrollOuter.clientHeight) {
        scrollOuter.scrollTop = rowTop + ROW_H - scrollOuter.clientHeight;
    }
}

// ── Byte update (DOM only, no full repaint) ───────────────────────────────────
function updateByteInDom(offset, value) {
    const rowOff = Math.floor(offset / BPR) * BPR;
    const idx    = offset % BPR;
    const row    = rowsDiv.querySelector('.row[data-off="' + rowOff + '"]');
    if (!row) return;
    const hb = row.querySelectorAll('.hb')[idx];
    const ab = row.querySelectorAll('.ab')[idx];
    const isDirty = dirtyMap.has(offset);
    if (hb) {
        hb.textContent = value.toString(16).toUpperCase().padStart(2,'0');
        hb.classList.toggle('dirty', isDirty);
    }
    if (ab) {
        ab.textContent = (value >= 32 && value < 127) ? String.fromCharCode(value) : '.';
        ab.classList.toggle('dirty', isDirty);
    }
}

// ── Edit from keyboard ────────────────────────────────────────────────────────
function commitByte(offset, value) {
    vscode.postMessage({ type: 'editByte', offset, value });
}

function handleHexKey(k) {
    if (!cursor || cursor.mode !== 'hex') return false;
    const lo = k.toLowerCase();
    if (!'0123456789abcdef'.includes(lo)) return false;
    if (nibble1 === null) {
        nibble1 = lo;
        applyCursorHighlight();
        // show partial in DOM
        const rowOff = Math.floor(cursor.offset / BPR) * BPR;
        const idx    = cursor.offset % BPR;
        const row    = rowsDiv.querySelector('.row[data-off="' + rowOff + '"]');
        if (row) {
            const hb = row.querySelectorAll('.hb')[idx];
            if (hb) hb.textContent = lo.toUpperCase() + '_';
        }
    } else {
        const val = parseInt(nibble1 + lo, 16);
        nibble1 = null;
        commitByte(cursor.offset, val);
        moveCursor(1);
    }
    return true;
}

function handleAsciiKey(k) {
    if (!cursor || cursor.mode !== 'ascii') return false;
    const code = k.charCodeAt(0);
    if (code < 32 || code >= 127) return false;
    commitByte(cursor.offset, code);
    moveCursor(1);
    return true;
}

// ── Keyboard ──────────────────────────────────────────────────────────────────
scrollOuter.addEventListener('keydown', e => {
    if (!cursor) return;
    if (e.ctrlKey || e.metaKey || e.altKey) return; // let Ctrl+Z etc. pass through

    if (handleHexKey(e.key))  { e.preventDefault(); return; }
    if (handleAsciiKey(e.key)){ e.preventDefault(); return; }

    switch (e.key) {
        case 'ArrowRight': e.preventDefault(); moveCursor(1); break;
        case 'ArrowLeft':  e.preventDefault(); moveCursor(-1); break;
        case 'ArrowDown':  e.preventDefault(); moveCursor(BPR); break;
        case 'ArrowUp':    e.preventDefault(); moveCursor(-BPR); break;
        case 'Tab':        e.preventDefault(); moveCursor(e.shiftKey ? -1 : 1); break;
        case 'Escape':
            cursor  = null;
            nibble1 = null;
            document.querySelectorAll('.cursor-hex,.cursor-asc,.pending-nibble')
                    .forEach(el => el.classList.remove('cursor-hex','cursor-asc','pending-nibble'));
            break;
    }
});

// ── Mouse ─────────────────────────────────────────────────────────────────────
rowsDiv.addEventListener('click', e => {
    scrollOuter.focus({ preventScroll: true });
    nibble1 = null;
    const hb = e.target.closest('.hb');
    const ab = e.target.closest('.ab');
    const row = e.target.closest('.row');
    if (!row) return;
    const base = parseInt(row.dataset.off, 10);
    if (hb) {
        cursor = { offset: base + parseInt(hb.dataset.i, 10), mode: 'hex' };
    } else if (ab) {
        cursor = { offset: base + parseInt(ab.dataset.i, 10), mode: 'ascii' };
    }
    applyCursorHighlight();
    if (cursor) updateStatus(cursor.offset);
});

// ── Status bar ────────────────────────────────────────────────────────────────
function updateStatus(offset) {
    const hex = '0x' + offset.toString(16).toUpperCase().padStart(8,'0');
    let val = '';
    if (dirtyMap.has(offset)) {
        val = '  =  0x' + dirtyMap.get(offset).toString(16).toUpperCase().padStart(2,'0');
    } else if (cache) {
        const ci = offset - cache.startOffset;
        if (ci >= 0 && ci < cache.bytes.length)
            val = '  =  0x' + cache.bytes[ci].toString(16).toUpperCase().padStart(2,'0');
    }
    statusEl.textContent = 'Offset : ' + hex + '  (' + offset + ')' + val;
}

rowsDiv.addEventListener('mousemove', e => {
    if (cursor) return; // keep cursor info while editing
    const row = e.target.closest('.row');
    if (!row) { statusEl.textContent = 'Offset : —'; return; }
    const base = parseInt(row.dataset.off, 10);
    const hb   = e.target.closest('.hb');
    const ab   = e.target.closest('.ab');
    const idx  = hb ? parseInt(hb.dataset.i,10) : ab ? parseInt(ab.dataset.i,10) : 0;
    updateStatus(base + idx);
});
rowsDiv.addEventListener('mouseleave', () => {
    if (!cursor) statusEl.textContent = 'Offset : —';
});

// ── Messages from extension ───────────────────────────────────────────────────
window.addEventListener('message', e => {
    const msg = e.data;
    switch (msg.type) {
        case 'init': {
            totalSize = msg.totalSize;
            regions   = msg.regions || [];
            infoEl.textContent = msg.filename + '  —  ' + totalSize.toLocaleString() + ' octets';
            dirtyBadge.style.display = msg.isDirty ? 'inline' : 'none';
            spacer.style.height = (totalRows() * ROW_H + 8) + 'px';
            buildHeader();
            // Build legend
            const legendEl = document.getElementById('legend');
            legendEl.innerHTML = '';
            regions.forEach(r => {
                const item = document.createElement('span');
                item.className = 'legend-item';
                const sw = document.createElement('span');
                sw.className = 'legend-swatch';
                sw.style.background = r.color;
                const lbl = document.createElement('span');
                lbl.textContent = r.name;
                item.appendChild(sw);
                item.appendChild(lbl);
                legendEl.appendChild(item);
            });
            updateViewport();
            break;
        }
        case 'data': {
            cache   = { startOffset: msg.startOffset, bytes: msg.bytes };
            pending = false;
            paintFromCache();
            if (queued) {
                const q = queued; queued = null;
                if (!inCache(q.first, q.visible)) fetchChunk(q.first, q.visible);
                else paintFromCache();
            }
            break;
        }
        case 'searchResults': {
            searchMatches = msg.offsets;
            searchPatLen  = msg.patternLen;
            searchIdx     = searchMatches.length > 0 ? 0 : -1;
            updateSearchCount();
            if (searchIdx >= 0) goToMatch(0);
            else applySearchHighlights();
            break;
        }
        case 'byteChanged': {
            const { offset, value, isDirty } = msg;
            if (isDirty) dirtyMap.set(offset, value);
            else         dirtyMap.delete(offset);
            // Update cache so next repaint is correct
            if (cache) {
                const ci = offset - cache.startOffset;
                if (ci >= 0 && ci < cache.bytes.length) cache.bytes[ci] = value;
            }
            updateByteInDom(offset, value);
            dirtyBadge.style.display = isDirty ? 'inline' : 'none';
            applyCursorHighlight();
            applySearchHighlights();
            // Keep search results fresh after edits
            if (searchInput.value.trim()) triggerSearch();
            break;
        }
        case 'revertAll': {
            dirtyMap.clear();
            dirtyBadge.style.display = 'none';
            cache = null;
            updateViewport();
            break;
        }
        case 'savedState': {
            dirtyMap.clear();
            dirtyBadge.style.display = 'none';
            // Refresh visible rows to remove dirty highlight
            if (cache) paintFromCache();
            break;
        }
    }
});

// ── Search ────────────────────────────────────────────────────────────────────
let searchMatches  = [];
let searchIdx      = -1;
let searchPatLen   = 0;
let searchDebounce = null;
// searchMode: 0 = AUTO, 1 = HEX (forcé), 2 = TXT (forcé)
let searchMode = 0;

const searchInput = document.getElementById('search-input');
const searchCount = document.getElementById('search-count');
const btnMode     = document.getElementById('btn-mode');
const btnPrev     = document.getElementById('btn-prev');
const btnNext     = document.getElementById('btn-next');
const btnClear    = document.getElementById('btn-clear-search');

function setSearchMode(m) {
    searchMode = m;
    if (m === 0) {
        btnMode.textContent = 'AUTO';
        btnMode.className   = '';
        searchInput.placeholder = 'Texte ou FF ED… (auto)';
    } else if (m === 1) {
        btnMode.textContent = 'HEX';
        btnMode.className   = 'mode-hex';
        searchInput.placeholder = 'Ex : FF ED 3E 00…';
    } else {
        btnMode.textContent = 'TXT';
        btnMode.className   = 'mode-txt';
        searchInput.placeholder = 'Texte à rechercher…';
    }
}

function isHexDigit(ch) {
    return (ch >= '0' && ch <= '9') || (ch >= 'a' && ch <= 'f') || (ch >= 'A' && ch <= 'F');
}

function stripWS(s) {
    let out = '';
    for (let i = 0; i < s.length; i++) {
        const code = s.charCodeAt(i);
        if (code !== 32 && code !== 9 && code !== 13 && code !== 10) out += s[i];
    }
    return out;
}

function hexCompact(trimmed) {
    const c = stripWS(trimmed);
    if (c.length < 2 || c.length % 2 !== 0) return null;
    for (let i = 0; i < c.length; i++) { if (!isHexDigit(c[i])) return null; }
    return c;
}

function parseSearchInput(raw) {
    let trimmed = '';
    for (let i = 0; i < raw.length; i++) {
        const code = raw.charCodeAt(i);
        if (code !== 32 && code !== 9 && code !== 13 && code !== 10) trimmed += raw[i];
    }
    if (!trimmed) return null;
    if (searchMode === 1) {
        const c = stripWS(trimmed);
        if (c.length === 0 || c.length % 2 !== 0) return null;
        for (let i = 0; i < c.length; i++) { if (!isHexDigit(c[i])) return null; }
        const pattern = [];
        for (let i = 0; i < c.length; i += 2) pattern.push(parseInt(c.slice(i, i + 2), 16));
        return pattern.length > 0 ? { pattern } : null;
    }
    if (searchMode === 2) {
        const full = raw.trim();
        return full ? { pattern: Array.from(full).map(function(ch) { return ch.charCodeAt(0); }) } : null;
    }
    // AUTO : hex si ça ressemble à des octets hex, sinon texte ASCII
    const c = hexCompact(raw.trim());
    if (c) {
        const pattern = [];
        for (let i = 0; i < c.length; i += 2) pattern.push(parseInt(c.slice(i, i + 2), 16));
        return { pattern };
    }
    const full = raw.trim();
    return full ? { pattern: Array.from(full).map(function(ch) { return ch.charCodeAt(0); }) } : null;
}

let lastPatternDesc = '';  // description du dernier pattern envoyé

function getHexError(raw) {
    const c = stripWS(raw);
    if (!c) return null;
    for (let i = 0; i < c.length; i++) {
        if (!isHexDigit(c[i])) return 'Caractères non hex : ' + c[i];
    }
    if (c.length % 2 !== 0) return 'Chiffre(s) manquant(s)';
    return null;
}

function triggerSearch() {
    searchCount.classList.remove('search-error');
    if (searchMode === 1) {
        const err = getHexError(searchInput.value);
        if (err) {
            searchInput.classList.add('no-match');
            searchCount.textContent = err;
            searchCount.classList.add('search-error');
            return;
        }
    }
    const parsed = parseSearchInput(searchInput.value);
    if (!parsed) { lastPatternDesc = ''; clearSearch(false); return; }
    lastPatternDesc = parsed.pattern.map(b => b.toString(16).toUpperCase().padStart(2,'0')).join(' ');
    vscode.postMessage({ type: 'search', pattern: parsed.pattern });
}

function clearSearch(clearInput) {
    rowsDiv.querySelectorAll('.search-match,.search-current').forEach(el => {
        el.classList.remove('search-match', 'search-current');
        el.style.backgroundColor = el.dataset.rc || '';
    });
    searchMatches = []; searchIdx = -1; searchPatLen = 0;
    searchCount.textContent = '';
    searchCount.classList.remove('search-error');
    searchInput.classList.remove('no-match');
    if (clearInput) searchInput.value = '';
}

btnMode.addEventListener('click', () => {
    setSearchMode((searchMode + 1) % 3);
    if (searchInput.value.trim()) triggerSearch();
});
setSearchMode(0); // initialiser le placeholder

function updateSearchCount() {
    const desc = lastPatternDesc ? '  [' + lastPatternDesc + ']' : '';
    if (!searchMatches.length) {
        searchCount.textContent = searchInput.value.trim() ? '0 résultat' + desc : '';
        searchInput.classList.toggle('no-match', searchInput.value.trim().length > 0);
    } else {
        searchCount.textContent = (searchIdx + 1) + ' / ' + searchMatches.length + desc;
        searchInput.classList.remove('no-match');
    }
}

function goToMatch(idx) {
    if (!searchMatches.length) return;
    searchIdx = ((idx % searchMatches.length) + searchMatches.length) % searchMatches.length;
    const off    = searchMatches[searchIdx];
    const rowTop = Math.floor(off / BPR) * ROW_H;
    scrollOuter.scrollTop = Math.max(0, rowTop - Math.floor(scrollOuter.clientHeight / 2));
    cursor = { offset: off, mode: 'hex' };
    updateStatus(off);
    updateSearchCount();
    // paintFromCache (called by updateViewport) already invokes applyCursorHighlight + applySearchHighlights
    updateViewport();
}

const C_CURRENT = 'var(--vscode-editor-findMatchBackground,        rgba(234,92,0,0.7))';
const C_MATCH   = 'var(--vscode-editor-findMatchHighlightBackground, rgba(234,92,0,0.33))';

function applySearchHighlights() {
    // Restore region color (or clear) on previously highlighted spans
    rowsDiv.querySelectorAll('.search-match,.search-current').forEach(el => {
        el.classList.remove('search-match', 'search-current');
        el.style.backgroundColor = el.dataset.rc || '';
    });
    if (!searchMatches.length) return;
    rowsDiv.querySelectorAll('.row').forEach(row => {
        const rowOff = parseInt(row.dataset.off, 10);
        const hbs    = row.querySelectorAll('.hb');
        const abs    = row.querySelectorAll('.ab');
        for (let mi = 0; mi < searchMatches.length; mi++) {
            const m = searchMatches[mi];
            if (m + searchPatLen <= rowOff) continue;
            if (m >= rowOff + BPR) break;
            const isCur = mi === searchIdx;
            const cls   = isCur ? 'search-current' : 'search-match';
            const color = isCur ? C_CURRENT : C_MATCH;
            for (let bi = 0; bi < BPR; bi++) {
                const bOff = rowOff + bi;
                if (bOff >= m && bOff < m + searchPatLen) {
                    if (hbs[bi]) { hbs[bi].classList.add(cls); hbs[bi].style.backgroundColor = color; }
                    if (abs[bi]) { abs[bi].classList.add(cls); abs[bi].style.backgroundColor = color; }
                }
            }
        }
    });
}

searchInput.addEventListener('input', () => {
    clearTimeout(searchDebounce);
    searchDebounce = setTimeout(triggerSearch, 180);
});

searchInput.addEventListener('keydown', e => {
    if (e.key === 'Enter') {
        e.preventDefault();
        if (e.shiftKey) goToMatch(searchIdx - 1);
        else            goToMatch(searchIdx + 1);
    } else if (e.key === 'Escape') {
        clearSearch(true);
        scrollOuter.focus({ preventScroll: true });
    }
});

btnNext.addEventListener('click',  () => goToMatch(searchIdx + 1));
btnPrev.addEventListener('click',  () => goToMatch(searchIdx - 1));
btnClear.addEventListener('click', () => clearSearch(true));

// Ctrl+F focuses search (works if VS Code doesn't intercept it first)
document.addEventListener('keydown', e => {
    if ((e.ctrlKey || e.metaKey) && e.key === 'f') {
        e.preventDefault();
        searchInput.focus();
        searchInput.select();
    }
});

vscode.postMessage({ type: 'ready' });
</script>
</body>
</html>`;
    }
}
