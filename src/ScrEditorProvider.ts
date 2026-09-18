import * as vscode from "vscode";
import { HardwarePanel } from "./HardwarePanel";

// 27 CPC hardware colors indexed 0-26 (as used in BASIC INK command)
const CPC_HW_COLORS: [number, number, number][] = [
    [0,   0,   0  ], //  0 Black
    [0,   0,   128], //  1 Blue
    [0,   0,   255], //  2 Bright Blue
    [128, 0,   0  ], //  3 Red
    [128, 0,   128], //  4 Magenta
    [128, 0,   255], //  5 Mauve
    [255, 0,   0  ], //  6 Bright Red
    [255, 0,   128], //  7 Purple
    [255, 0,   255], //  8 Bright Magenta
    [0,   128, 0  ], //  9 Green
    [0,   128, 128], // 10 Cyan
    [0,   128, 255], // 11 Sky Blue
    [128, 128, 0  ], // 12 Yellow
    [128, 128, 128], // 13 Medium White
    [128, 128, 255], // 14 Pastel Blue
    [255, 128, 0  ], // 15 Orange
    [255, 128, 128], // 16 Pink
    [255, 128, 255], // 17 Pastel Magenta
    [0,   255, 0  ], // 18 Bright Green
    [0,   255, 128], // 19 Sea Green
    [0,   255, 255], // 20 Bright Cyan
    [128, 255, 0  ], // 21 Lime
    [128, 255, 128], // 22 Pastel Green
    [128, 255, 255], // 23 Pastel Cyan
    [255, 255, 0  ], // 24 Bright Yellow
    [255, 255, 128], // 25 Pastel Yellow
    [255, 255, 255], // 26 White
];

// Default ink→hw_color mapping per mode (hw color index 0-26)
const DEFAULT_PALETTES: Record<number, number[]> = {
    0: [1, 24, 20, 6, 26, 0, 2, 8, 10, 12, 14, 16, 18, 22, 24, 13],
    1: [1, 24, 20, 6, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
    2: [0, 26, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
};

class ScrDocument implements vscode.CustomDocument {
    constructor(readonly uri: vscode.Uri) {}
    dispose() {}
}

interface ScrViewState {
    mode: number;
    numCols: number;
    numLines: number;
    palette: number[];
}

const VIEW_STATE_KEY_PREFIX = "scrEditor.viewState.";

export class ScrEditorProvider implements vscode.CustomReadonlyEditorProvider<ScrDocument> {

    constructor(private readonly context: vscode.ExtensionContext) {}

    static register(context: vscode.ExtensionContext): vscode.Disposable {
        return vscode.window.registerCustomEditorProvider(
            "z80debug.scrEditor",
            new ScrEditorProvider(context),
            { webviewOptions: { retainContextWhenHidden: true } }
        );
    }

    openCustomDocument(uri: vscode.Uri): ScrDocument {
        return new ScrDocument(uri);
    }

    async resolveCustomEditor(
        document: ScrDocument,
        webviewPanel: vscode.WebviewPanel,
        _token: vscode.CancellationToken
    ): Promise<void> {
        webviewPanel.webview.options = { enableScripts: true };
        webviewPanel.webview.html = this._buildHtml();

        const stateKey = VIEW_STATE_KEY_PREFIX + document.uri.toString();

        webviewPanel.webview.onDidReceiveMessage(async (msg) => {
            if (msg.type === "ready") {
                const bytes = await vscode.workspace.fs.readFile(document.uri);
                const b64 = Buffer.from(bytes).toString("base64");
                const viewState = this.context.workspaceState.get<ScrViewState>(stateKey);
                webviewPanel.webview.postMessage({ type: "load", data: b64, viewState });
            } else if (msg.type === "saveState") {
                await this.context.workspaceState.update(stateKey, msg.state);
            }
        });
    }

    private _buildHtml(): string {
        const hwColorsJson = JSON.stringify(CPC_HW_COLORS);
        const defaultPalettesJson = JSON.stringify(DEFAULT_PALETTES);

        return /* html */`<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline';">
<style>
${HardwarePanel.commonCss()}
body { padding-bottom: 16px; }
#toolbar { gap: 6px; flex-wrap: wrap; }
.mode-btn {
    background: var(--vscode-button-secondaryBackground, #3c3c3c);
    color: var(--vscode-button-secondaryForeground, #ccc);
    border: 1px solid var(--border);
    border-radius: 3px; padding: 2px 10px; cursor: pointer; font-size: 12px;
}
.mode-btn.active {
    background: var(--vscode-button-background);
    color: var(--vscode-button-foreground);
    border-color: var(--vscode-button-background);
}
#dimFields { display: flex; align-items: center; gap: 4px; }
#dimFields label { font-size: 12px; color: var(--fg-dim); }
#dimFields input {
    width: 4.5em; background: var(--vscode-input-background, #3c3c3c);
    color: var(--vscode-input-foreground, #ccc); border: 1px solid var(--border);
    border-radius: 3px; padding: 2px 4px; font-size: 12px;
}
#canvasOuter {
    width: 100%; overflow-x: auto; overflow-y: hidden;
    background: #000; border: 1px solid var(--border); margin-top: 6px;
    box-sizing: border-box;
}
#scrCanvas {
    display: block;
    image-rendering: pixelated;
    image-rendering: crisp-edges;
}
.section-title { margin-top: 12px; margin-bottom: 6px; }
#paletteRow {
    display: flex; flex-wrap: wrap; gap: 4px; align-items: center;
}
.ink-swatch {
    width: 22px; height: 22px; border-radius: 3px; cursor: pointer;
    border: 2px solid transparent; box-sizing: border-box;
    flex-shrink: 0;
}
.ink-swatch.selected { border-color: var(--vscode-focusBorder, #007acc); }
.ink-label {
    font-size: 10px; color: var(--fg-dim); text-align: center;
    width: 22px; flex-shrink: 0;
}
#inkGrid { display: flex; flex-direction: column; gap: 2px; }
#inkGridRow { display: flex; gap: 4px; }
#hwPicker {
    margin-top: 8px;
    display: grid; grid-template-columns: repeat(9, 22px); gap: 3px;
}
.hw-swatch {
    width: 22px; height: 22px; border-radius: 3px; cursor: pointer;
    border: 1px solid rgba(255,255,255,0.15); box-sizing: border-box;
    position: relative;
}
.hw-swatch:hover { outline: 2px solid var(--vscode-focusBorder, #007acc); outline-offset: 1px; }
.hw-swatch .hw-idx {
    position: absolute; bottom: 1px; right: 2px;
    font-size: 7px; color: rgba(255,255,255,0.7); pointer-events: none;
    text-shadow: 0 0 2px #000;
}
#selectedInkLabel { font-size: 12px; color: var(--fg-dim); margin-top: 4px; }
#presetBtns { display: flex; gap: 6px; margin-top: 8px; flex-wrap: wrap; }
#errorMsg { color: var(--vscode-errorForeground); display: none; margin-top: 6px; }
</style>
</head>
<body>

<div class="toolbar" id="toolbar">
  <span class="badge">CPC Screen (.scr)</span>
  <button class="mode-btn active" data-mode="0">Mode 0 (160×200)</button>
  <button class="mode-btn"        data-mode="1">Mode 1 (320×200)</button>
  <button class="mode-btn"        data-mode="2">Mode 2 (640×200)</button>
  <div id="dimFields">
    <label for="inColumns">Colonnes</label>
    <input type="number" id="inColumns" min="1" max="255" value="80">
    <label for="inLines">Lignes</label>
    <input type="number" id="inLines" min="1" max="1024" value="200">
  </div>
  <span style="flex:1"></span>
  <button id="btnZoomOut" title="Zoom arrière (molette ↓)">&#x2212;</button>
  <span id="lblZoom" style="min-width:2.5em;text-align:center;font-variant-numeric:tabular-nums">1×</span>
  <button id="btnZoomIn" title="Zoom avant (molette ↑)">&#x2B;</button>
</div>

<div id="errorMsg"></div>
<div id="canvasOuter">
  <canvas id="scrCanvas"></canvas>
</div>

<div class="section-title">Palette inks</div>
<div id="inkGrid">
  <div id="inkGridRow"></div>
  <div style="display:flex;gap:4px;" id="inkLabelRow"></div>
</div>
<div id="selectedInkLabel">Ink sélectionné : 0</div>

<div class="section-title">Couleurs hardware CPC (cliquer pour assigner)</div>
<div id="hwPicker"></div>

<div id="presetBtns">
  <button class="btn" id="btnPresetFirmware">Preset firmware</button>
  <button class="btn" id="btnPresetBlack">Tout noir</button>
</div>

<script>
const vscode = acquireVsCodeApi();

const HW_COLORS = ${hwColorsJson};
const DEFAULT_PALETTES = ${defaultPalettesJson};
const ZOOM_STEPS = [0.25, 0.5, 1, 2, 3, 4];
let zoomIdx = 2;
let scrData = null;
let currentMode = 0;
let selectedInk = 0;
let numCols = 80;   // octets par ligne (largeur mémoire écran)
let numLines = 200; // lignes de balayage
// palette[i] = hw color index (0-26)
let palette = DEFAULT_PALETTES[0].slice();

const canvas = document.getElementById('scrCanvas');
const ctx = canvas.getContext('2d');

// ── Pixel decode (exact formulas from CPCCoreEmu/GateArray.cpp) ─────────────
function decodeMode0(b) {
    const p0 = ((b & 0x80) ? 1 : 0) | ((b & 0x08) ? 2 : 0) | ((b & 0x20) ? 4 : 0) | ((b & 0x02) ? 8 : 0);
    const p1 = ((b & 0x40) ? 1 : 0) | ((b & 0x04) ? 2 : 0) | ((b & 0x10) ? 4 : 0) | ((b & 0x01) ? 8 : 0);
    return [p0, p1];
}
function decodeMode1(b) {
    return [
        ((b & 0x80) ? 1 : 0) | ((b & 0x08) ? 2 : 0),
        ((b & 0x40) ? 1 : 0) | ((b & 0x04) ? 2 : 0),
        ((b & 0x20) ? 1 : 0) | ((b & 0x02) ? 2 : 0),
        ((b & 0x10) ? 1 : 0) | ((b & 0x01) ? 2 : 0),
    ];
}
function decodeMode2(b) {
    return [(b>>7)&1,(b>>6)&1,(b>>5)&1,(b>>4)&1,(b>>3)&1,(b>>2)&1,(b>>1)&1,b&1];
}

// SCR memory layout: offset for screen line y, byte column x (0-based, numCols wide)
function scrOffset(x, y) { return (y & 7) * 0x800 + (y >> 3) * numCols + x; }

function render() {
    if (!scrData) return;

    // Mode 0: 2 CPC pixels/byte × 2 canvas px/CPC px = 4 canvas px/byte
    // Mode 1: 4 CPC pixels/byte × 1 canvas px        = 4 canvas px/byte
    // Mode 2: 8 CPC pixels/byte × 1 canvas px         = 8 canvas px/byte
    const canvasW = numCols * (currentMode === 2 ? 8 : 4);
    const canvasH = numLines;
    canvas.width  = canvasW;
    canvas.height = canvasH;

    const imgData = ctx.createImageData(canvasW, canvasH);
    const px = imgData.data;

    for (let y = 0; y < numLines; y++) {
        for (let xb = 0; xb < numCols; xb++) {
            const off = scrOffset(xb, y);
            if (off >= scrData.length) continue;
            const b = scrData[off];

            let colorIds;
            if (currentMode === 0) colorIds = decodeMode0(b);
            else if (currentMode === 1) colorIds = decodeMode1(b);
            else colorIds = decodeMode2(b);

            // canvas pixels per CPC pixel
            const cpw = currentMode === 0 ? 2 : 1;
            // starting canvas x for this byte
            const cx0 = xb * colorIds.length * cpw;

            for (let pi = 0; pi < colorIds.length; pi++) {
                const hw = palette[colorIds[pi]] ?? 0;
                const rgb = HW_COLORS[hw] ?? [0,0,0];
                for (let w = 0; w < cpw; w++) {
                    const ci = ((y * canvasW) + cx0 + pi * cpw + w) * 4;
                    px[ci] = rgb[0]; px[ci+1] = rgb[1]; px[ci+2] = rgb[2]; px[ci+3] = 255;
                }
            }
        }
    }
    ctx.putImageData(imgData, 0, 0);
    applyZoom();
}

// ── Zoom ─────────────────────────────────────────────────────────────────────
function applyZoom() {
    const z = ZOOM_STEPS[zoomIdx];
    canvas.style.width  = Math.round(canvas.width  * z) + 'px';
    canvas.style.height = Math.round(canvas.height * z) + 'px';
    document.getElementById('lblZoom').textContent =
        (z === Math.floor(z) ? z : z.toFixed(2)) + '×';
    document.getElementById('btnZoomOut').disabled = zoomIdx <= 0;
    document.getElementById('btnZoomIn').disabled  = zoomIdx >= ZOOM_STEPS.length - 1;
}
function zoomIn()  { if (zoomIdx < ZOOM_STEPS.length - 1) { zoomIdx++; applyZoom(); } }
function zoomOut() { if (zoomIdx > 0)                     { zoomIdx--; applyZoom(); } }

// ── Palette UI ────────────────────────────────────────────────────────────────
function inkCount() { return currentMode === 0 ? 16 : currentMode === 1 ? 4 : 2; }

function rgbToHex(rgb) {
    return '#' + rgb.map(v => v.toString(16).padStart(2,'0')).join('');
}

function rebuildInkRow() {
    const row   = document.getElementById('inkGridRow');
    const lrow  = document.getElementById('inkLabelRow');
    const n     = inkCount();
    row.innerHTML  = '';
    lrow.innerHTML = '';
    for (let i = 0; i < n; i++) {
        const sw = document.createElement('div');
        sw.className = 'ink-swatch' + (i === selectedInk ? ' selected' : '');
        const rgb = HW_COLORS[palette[i]] ?? [0,0,0];
        sw.style.background = rgbToHex(rgb);
        sw.title = 'Ink ' + i + ' = couleur ' + palette[i];
        sw.addEventListener('click', () => { selectedInk = i; updateSelectedLabel(); rebuildInkRow(); });
        row.appendChild(sw);

        const lbl = document.createElement('div');
        lbl.className = 'ink-label';
        lbl.textContent = String(i);
        lrow.appendChild(lbl);
    }
    if (selectedInk >= n) { selectedInk = 0; }
}

function buildHwPicker() {
    const picker = document.getElementById('hwPicker');
    picker.innerHTML = '';
    for (let i = 0; i < HW_COLORS.length; i++) {
        const sw = document.createElement('div');
        sw.className = 'hw-swatch';
        sw.style.background = rgbToHex(HW_COLORS[i]);
        sw.title = 'Couleur CPC ' + i;
        const idx = document.createElement('span');
        idx.className = 'hw-idx';
        idx.textContent = String(i);
        sw.appendChild(idx);
        sw.addEventListener('click', () => {
            palette[selectedInk] = i;
            rebuildInkRow();
            render();
            saveState();
        });
        picker.appendChild(sw);
    }
}

function updateSelectedLabel() {
    document.getElementById('selectedInkLabel').textContent =
        'Ink sélectionné : ' + selectedInk + ' (couleur CPC ' + palette[selectedInk] + ')';
}

// ── Persistance de l'état de vue (mode, dimensions, palette) par fichier ───────
function saveState() {
    vscode.postMessage({
        type: 'saveState',
        state: { mode: currentMode, numCols, numLines, palette: palette.slice() }
    });
}

function applyMode(m) {
    currentMode = m;
    if (selectedInk >= inkCount()) selectedInk = 0;
    document.querySelectorAll('.mode-btn').forEach(b => b.classList.toggle('active', b.dataset.mode == m));
}

// ── Mode switch ───────────────────────────────────────────────────────────────
document.querySelectorAll('.mode-btn').forEach(btn => {
    btn.addEventListener('click', () => {
        const m = parseInt(btn.dataset.mode);
        if (m === currentMode) return;
        applyMode(m);
        palette = DEFAULT_PALETTES[m].slice();
        rebuildInkRow();
        updateSelectedLabel();
        render();
        saveState();
    });
});

// ── Dimensions (colonnes/lignes) ────────────────────────────────────────────────
function clampDim(value, min, max, fallback) {
    const n = parseInt(value, 10);
    if (!Number.isFinite(n)) return fallback;
    return Math.min(max, Math.max(min, n));
}
const inColumns = document.getElementById('inColumns');
const inLines   = document.getElementById('inLines');
inColumns.addEventListener('change', () => {
    numCols = clampDim(inColumns.value, 1, 255, numCols);
    inColumns.value = numCols;
    render();
    saveState();
});
inLines.addEventListener('change', () => {
    numLines = clampDim(inLines.value, 1, 1024, numLines);
    inLines.value = numLines;
    render();
    saveState();
});

// ── Presets ───────────────────────────────────────────────────────────────────
document.getElementById('btnPresetFirmware').addEventListener('click', () => {
    palette = DEFAULT_PALETTES[currentMode].slice();
    rebuildInkRow();
    updateSelectedLabel();
    render();
    saveState();
});
document.getElementById('btnPresetBlack').addEventListener('click', () => {
    palette = Array(16).fill(0);
    rebuildInkRow();
    updateSelectedLabel();
    render();
    saveState();
});

// ── Zoom controls ─────────────────────────────────────────────────────────────
document.getElementById('btnZoomIn').addEventListener('click',  zoomIn);
document.getElementById('btnZoomOut').addEventListener('click', zoomOut);
document.getElementById('canvasOuter').addEventListener('wheel', e => {
    e.preventDefault();
    if (e.deltaY < 0) zoomIn(); else zoomOut();
}, { passive: false });

// ── Message handler ───────────────────────────────────────────────────────────
window.addEventListener('message', e => {
    const msg = e.data;
    if (msg.type === 'load') {
        const raw = atob(msg.data);
        scrData = new Uint8Array(raw.length);
        for (let i = 0; i < raw.length; i++) scrData[i] = raw.charCodeAt(i);

        const vs = msg.viewState;
        if (vs) {
            applyMode(vs.mode ?? 0);
            numCols  = clampDim(vs.numCols,  1, 255,  numCols);
            numLines = clampDim(vs.numLines, 1, 1024, numLines);
            inColumns.value = numCols;
            inLines.value   = numLines;
            if (Array.isArray(vs.palette) && vs.palette.length === 16) palette = vs.palette.slice();
            else palette = DEFAULT_PALETTES[currentMode].slice();
            rebuildInkRow();
            updateSelectedLabel();
        }
        render();
    }
});

// ── Init ──────────────────────────────────────────────────────────────────────
buildHwPicker();
rebuildInkRow();
updateSelectedLabel();
vscode.postMessage({ type: 'ready' });
</script>
</body>
</html>`;
    }
}
