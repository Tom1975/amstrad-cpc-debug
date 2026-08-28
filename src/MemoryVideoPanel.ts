import * as vscode from "vscode";
import { HardwarePanel } from "./HardwarePanel";

interface PanelParams {
    address:      number;
    mode:         number;           // 0 / 1 / 2
    bytesPerLine: number;           // default 64 (ignored in cpc_screen layout)
    lines:        number;           // default 200 (ignored in cpc_screen layout)
    paletteMode:  "gate_array" | "custom";
    layout:       "linear" | "cpc_screen";
    live:         boolean;
}

export class MemoryVideoPanel extends HardwarePanel {
    static currentPanel: MemoryVideoPanel | undefined;

    private _intervalHandle: NodeJS.Timeout | undefined;

    private _params: PanelParams = {
        address:      0xC000,
        mode:         0,
        bytesPerLine: 64,
        lines:        200,
        paletteMode:  "gate_array",
        layout:       "cpc_screen",
        live:         true,
    };

    // ── Public API ─────────────────────────────────────────────────────────────

    static createOrShow(): void {
        const column = vscode.window.activeTextEditor
            ? vscode.ViewColumn.Beside
            : vscode.ViewColumn.One;

        if (MemoryVideoPanel.currentPanel) {
            MemoryVideoPanel.currentPanel._panel.reveal(column);
            return;
        }

        const panel = vscode.window.createWebviewPanel(
            "z80memVideo",
            "Memory Video",
            column,
            { enableScripts: true, retainContextWhenHidden: true }
        );

        MemoryVideoPanel.currentPanel = new MemoryVideoPanel(panel);
    }

    // ── Constructor ────────────────────────────────────────────────────────────

    private constructor(panel: vscode.WebviewPanel) {
        super(panel);
        this._panel.webview.html = this._buildHtml();

        this._panel.webview.onDidReceiveMessage(async (msg) => {
            switch (msg.type) {
                case "ready":
                    this._startLive();
                    break;
                case "paramsChanged":
                    this._params = { ...this._params, ...msg };
                    delete (this._params as any).type;
                    if (this._params.live) this._startLive(); else this._stopLive();
                    break;
                case "followCRTC":
                    await this._followCRTC();
                    break;
                case "manualRefresh":
                    await this._sendFrame();
                    break;
            }
        });
    }

    // ── Live polling ───────────────────────────────────────────────────────────

    private _startLive(): void {
        if (this._intervalHandle) return;
        this._intervalHandle = setInterval(() => { this._sendFrame().catch(() => {}); }, 100);
    }

    private _stopLive(): void {
        if (this._intervalHandle) {
            clearInterval(this._intervalHandle);
            this._intervalHandle = undefined;
        }
    }

    // ── Frame fetch & dispatch ─────────────────────────────────────────────────

    private async _sendFrame(): Promise<void> {
        const session = vscode.debug.activeDebugSession;
        if (!session) return;

        const { address, mode, bytesPerLine, lines, paletteMode, layout } = this._params;
        // CPC Screen layout spans up to 0x4000 bytes (25 char rows × 8 scan lines × 0x800 stride)
        const count = layout === "cpc_screen"
            ? Math.min(0x4000, 0x10000 - (address & 0xFFFF))
            : Math.min(bytesPerLine * lines, 0x10000 - (address & 0xFFFF));

        try {
            const [memResult, gaResult] = await Promise.all([
                session.customRequest("readMemoryEx", { address: address & 0xFFFF, count }),
                paletteMode === "gate_array"
                    ? session.customRequest("getGateArrayState", {})
                    : Promise.resolve(null),
            ]);

            const bytes: number[] = memResult?.bytes ?? [];
            const inks:  number[] | null = gaResult?.inks ?? null;   // ARGB values

            this._panel.webview.postMessage({ type: "frame", bytes, mode, bytesPerLine, inks, layout });
        } catch {
            // Silently drop failed frames (session closing, timeout…)
        }
    }

    // ── Follow CRTC ────────────────────────────────────────────────────────────

    private async _followCRTC(): Promise<void> {
        const session = vscode.debug.activeDebugSession;
        if (!session) return;
        try {
            const result = await session.customRequest("getCrtcState", {});
            const regs: number[] = result?.registers ?? [];
            const r12 = regs[12] ?? 0x30;
            const r13 = regs[13] ?? 0x00;
            // Standard CPC formula: bits 5-4 of R12 → CPU address bits 15-14
            const addr = ((r12 & 0x30) << 10) | ((r12 & 0x03) << 9) | (r13 << 1);
            this._panel.webview.postMessage({ type: "setAddress", address: addr });
            this._params.address = addr;
        } catch {}
    }

    // ── Required overrides ─────────────────────────────────────────────────────

    async refresh(): Promise<void> {
        await this._sendFrame();
    }

    protected override onDispose(): void {
        this._stopLive();
        MemoryVideoPanel.currentPanel = undefined;
    }

    // ── HTML ───────────────────────────────────────────────────────────────────

    private _buildHtml(): string {
        return /* html */`<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline';">
<style>
${HardwarePanel.commonCss()}

body { display: flex; flex-direction: column; height: 100vh; overflow: hidden; }

.toolbar {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 6px;
    padding: 6px 8px;
    border-bottom: 1px solid var(--border);
    flex-shrink: 0;
}

.toolbar label { font-size: 0.82em; color: var(--fg-dim); }

.toolbar input[type="text"],
.toolbar input[type="number"],
.toolbar select {
    font-family: var(--font);
    font-size: 0.85em;
    background: var(--bg-section);
    color: var(--fg);
    border: 1px solid var(--border);
    border-radius: 3px;
    padding: 2px 5px;
}
.toolbar input[type="text"]   { width: 5.5em; }
.toolbar input[type="number"] { width: 4em; }

.sep { width: 1px; height: 18px; background: var(--border); margin: 0 2px; }

.palette-row {
    display: flex;
    flex-wrap: wrap;
    gap: 3px;
    padding: 4px 8px;
    border-bottom: 1px solid var(--border);
    flex-shrink: 0;
}
.palette-row.hidden { display: none; }
.palette-row label { font-size: 0.78em; color: var(--fg-dim); align-self: center; }

.pen-wrap { display: flex; flex-direction: column; align-items: center; gap: 1px; }
.pen-idx  { font-size: 0.68em; color: var(--fg-dim); font-family: var(--font); }
input.pen-color {
    width: 28px; height: 20px;
    padding: 0; border: 1px solid var(--border); border-radius: 2px; cursor: pointer;
    background: none;
}

.canvas-wrap {
    flex: 1;
    overflow: auto;
    display: flex;
    align-items: flex-start;
    justify-content: flex-start;
    padding: 6px;
}

canvas {
    image-rendering: pixelated;
    image-rendering: crisp-edges;
    display: block;
}

.live-dot {
    display: inline-block;
    width: 7px; height: 7px;
    border-radius: 50%;
    margin-right: 3px;
    background: var(--fg-dim);
}
.live-dot.on { background: #f04040; }

</style>
</head>
<body>

<!-- Controls -->
<div class="toolbar">
    <label>Addr</label>
    <input type="text" id="inpAddr" value="C000" maxlength="4" title="Start address (hex)">

    <div class="sep"></div>
    <label>Mode</label>
    <select id="selMode">
        <option value="0">0  (2px/B, 16col)</option>
        <option value="1">1  (4px/B, 4col)</option>
        <option value="2">2  (8px/B, 2col)</option>
    </select>

    <div class="sep"></div>
    <label>Layout</label>
    <select id="selLayout">
        <option value="cpc_screen">CPC Screen</option>
        <option value="linear">Linéaire</option>
    </select>

    <span id="linearControls" style="display:none">
        <label style="margin-left:4px">Width</label>
        <input type="number" id="inpWidth" value="64" min="1" max="256">
        <label>Lines</label>
        <input type="number" id="inpLines" value="200" min="1" max="1024">
    </span>

    <div class="sep"></div>
    <label>Palette</label>
    <select id="selPalette">
        <option value="gate_array">Gate Array</option>
        <option value="custom">Custom</option>
    </select>

    <div class="sep"></div>
    <button id="btnCRTC" title="Set address from CRTC display start">Follow CRTC</button>
    <button id="btnRefresh" title="Fetch one frame now">&#x21BA;</button>
    <button id="btnLive" title="Toggle live 100ms refresh">
        <span class="live-dot on" id="liveDot"></span>Live
    </button>

    <div class="sep"></div>
    <button id="btnZoomOut" title="Zoom out (or mouse wheel)">&#x2212;</button>
    <span id="zoomLabel" style="font-size:0.82em;min-width:3em;text-align:center;">2×</span>
    <button id="btnZoomIn"  title="Zoom in (or mouse wheel)">&#x2B;</button>
</div>

<!-- Custom palette (hidden unless mode = custom) -->
<div class="palette-row hidden" id="palRow">
    <label>Pens:</label>
</div>

<!-- Canvas -->
<div class="canvas-wrap">
    <canvas id="cv"></canvas>
</div>

<script>
const vscode = acquireVsCodeApi();
const canvas  = document.getElementById('cv');
const ctx     = canvas.getContext('2d');
const inpAddr = document.getElementById('inpAddr');
const selMode = document.getElementById('selMode');
const selPal  = document.getElementById('selPalette');
const btnCRTC = document.getElementById('btnCRTC');
const btnRef  = document.getElementById('btnRefresh');
const btnLive = document.getElementById('btnLive');
const liveDot = document.getElementById('liveDot');
const palRow  = document.getElementById('palRow');

let isLive = true;
let currentPal = new Array(16).fill({r:0,g:0,b:0});  // cached per-pen RGB
let zoom = 2;
const ZOOM_STEPS = [0.5, 1, 2, 3, 4, 6, 8];

function applyZoom() {
    canvas.style.width  = (canvas.width  * zoom) + 'px';
    canvas.style.height = (canvas.height * zoom) + 'px';
    document.getElementById('zoomLabel').textContent = (zoom % 1 === 0 ? zoom : zoom.toFixed(1)) + '\xD7';
}

function changeZoom(delta) {
    const idx = ZOOM_STEPS.indexOf(zoom);
    const next = idx + delta;
    if (next >= 0 && next < ZOOM_STEPS.length) {
        zoom = ZOOM_STEPS[next];
        applyZoom();
    }
}

// ── Build custom pen colour pickers ────────────────────────────────────────────
const DEFAULT_HEX = [
    '#000000','#0000FF','#FF0000','#FF00FF','#00FF00','#00FFFF','#FFFF00','#FFFFFF',
    '#000080','#008080','#FF8000','#800080','#008000','#FF0080','#808080','#0080FF'
];
const penInputs = [];
for (let i = 0; i < 16; i++) {
    const wrap  = document.createElement('div');
    wrap.className = 'pen-wrap';
    const idx   = document.createElement('span');
    idx.className = 'pen-idx';
    idx.textContent = i;
    const inp   = document.createElement('input');
    inp.type    = 'color';
    inp.className = 'pen-color';
    inp.value   = DEFAULT_HEX[i];
    inp.title   = 'Pen ' + i;
    inp.addEventListener('input', () => {
        currentPal[i] = parseHex(inp.value);
        sendParams();
    });
    wrap.appendChild(idx);
    wrap.appendChild(inp);
    palRow.appendChild(wrap);
    penInputs.push(inp);
}
// Initialise currentPal from defaults
DEFAULT_HEX.forEach((h, i) => { currentPal[i] = parseHex(h); });

// ── Helpers ────────────────────────────────────────────────────────────────────

function parseHex(h) {
    return {
        r: parseInt(h.slice(1,3), 16),
        g: parseInt(h.slice(3,5), 16),
        b: parseInt(h.slice(5,7), 16)
    };
}

function argbToRgb(argb) {
    return {
        r: (argb >>> 16) & 0xFF,
        g: (argb >>>  8) & 0xFF,
        b:  argb         & 0xFF
    };
}

function decodePixels(byte, mode) {
    if (mode === 0) {
        // 2 pixels, 4-bit ink (interleaved bits 7,5,3,1 and 6,4,2,0)
        const p0 = ((byte>>7)&1) | (((byte>>5)&1)<<1) | (((byte>>3)&1)<<2) | (((byte>>1)&1)<<3);
        const p1 = ((byte>>6)&1) | (((byte>>4)&1)<<1) | (((byte>>2)&1)<<2) | ( (byte    &1)<<3);
        return [p0, p1];
    } else if (mode === 1) {
        // 4 pixels, 2-bit ink (bits 7,3 / 6,2 / 5,1 / 4,0)
        const p0 = ((byte>>7)&1) | (((byte>>3)&1)<<1);
        const p1 = ((byte>>6)&1) | (((byte>>2)&1)<<1);
        const p2 = ((byte>>5)&1) | (((byte>>1)&1)<<1);
        const p3 = ((byte>>4)&1) | ( (byte    &1)<<1);
        return [p0, p1, p2, p3];
    } else {
        // 8 pixels, 1-bit ink (bit 7 = leftmost)
        return [7,6,5,4,3,2,1,0].map(b => (byte >> b) & 1);
    }
}

// ── CPC screen layout : offset in bytes[] for visual line Y, column X ─────────
// Standard CRTC mapping: char_row × 80 + scan_line × 0x800 + X
function cpcOffset(y, x) {
    return Math.floor(y / 8) * 80 + (y % 8) * 0x800 + x;
}

// ── Rendering ──────────────────────────────────────────────────────────────────

function renderFrame(bytes, mode, bytesPerLine, layout) {
    // Pixels per byte decoded (logical CPC pixels)
    const pxPerByte = mode === 0 ? 2 : mode === 1 ? 4 : 8;
    // Canvas dots per decoded pixel: mode 0 = 4×, mode 1 = 2×, mode 2 = 1×
    // → all modes produce cols × 8 canvas dots per row (same physical width)
    const dotWidth  = mode === 0 ? 4 : mode === 1 ? 2 : 1;

    const isCpc = layout === 'cpc_screen';
    const cols = isCpc ? 80 : bytesPerLine;
    const rows = isCpc ? 200 : Math.max(1, Math.floor(bytes.length / cols));
    const w = cols * pxPerByte * dotWidth;   // = cols × 8 always
    const h = rows;

    if (canvas.width !== w || canvas.height !== h) {
        canvas.width  = w;
        canvas.height = h;
    }

    const imgData = ctx.createImageData(w, h);
    const d = imgData.data;

    for (let row = 0; row < rows; row++) {
        for (let col = 0; col < cols; col++) {
            const byteIdx = isCpc ? cpcOffset(row, col) : row * cols + col;
            const byte = bytes[byteIdx] ?? 0;
            const pixels = decodePixels(byte, mode);
            for (let p = 0; p < pixels.length; p++) {
                const inkIdx = pixels[p] & 0xF;
                const c = currentPal[inkIdx] ?? {r:0,g:0,b:0};
                const baseX = (col * pxPerByte + p) * dotWidth;
                for (let dx = 0; dx < dotWidth; dx++) {
                    const i = (row * w + baseX + dx) * 4;
                    d[i]   = c.r;
                    d[i+1] = c.g;
                    d[i+2] = c.b;
                    d[i+3] = 255;
                }
            }
        }
    }

    ctx.putImageData(imgData, 0, 0);
    applyZoom();
}

// ── Message handling ───────────────────────────────────────────────────────────

window.addEventListener('message', e => {
    const msg = e.data;
    if (msg.type === 'frame') {
        if (msg.inks) {
            // Gate Array mode: inks is array[16] of ARGB values
            for (let i = 0; i < 16; i++) {
                currentPal[i] = argbToRgb(msg.inks[i] ?? 0);
            }
        }
        renderFrame(msg.bytes, msg.mode, msg.bytesPerLine, msg.layout);
    } else if (msg.type === 'setAddress') {
        inpAddr.value = msg.address.toString(16).toUpperCase().padStart(4, '0');
    }
});

// ── Send params to extension ───────────────────────────────────────────────────

function parseAddr() {
    const v = parseInt(inpAddr.value, 16);
    return isNaN(v) ? 0xC000 : v & 0xFFFF;
}

function sendParams() {
    vscode.postMessage({
        type:         'paramsChanged',
        address:      parseAddr(),
        mode:         parseInt(selMode.value),
        bytesPerLine: Math.max(1, parseInt(inpW?.value) || 64),
        lines:        Math.max(1, parseInt(inpL?.value) || 200),
        paletteMode:  selPal.value,
        layout:       selLayout.value,
        live:         isLive,
    });
}

// ── Control events ─────────────────────────────────────────────────────────────

const selLayout = document.getElementById('selLayout');
const inpW      = document.getElementById('inpWidth');
const inpL      = document.getElementById('inpLines');

inpAddr.addEventListener('change', sendParams);
selMode.addEventListener('change', sendParams);
inpW?.addEventListener('change', sendParams);
inpL?.addEventListener('change', sendParams);

selLayout.addEventListener('change', () => {
    document.getElementById('linearControls').style.display =
        selLayout.value === 'linear' ? '' : 'none';
    sendParams();
});

selPal.addEventListener('change', () => {
    palRow.classList.toggle('hidden', selPal.value !== 'custom');
    sendParams();
});

btnCRTC.addEventListener('click', () => {
    vscode.postMessage({ type: 'followCRTC' });
});

btnRef.addEventListener('click', () => {
    vscode.postMessage({ type: 'manualRefresh' });
});

btnLive.addEventListener('click', () => {
    isLive = !isLive;
    liveDot.classList.toggle('on', isLive);
    sendParams();
});

document.getElementById('btnZoomIn').addEventListener('click',  () => changeZoom(+1));
document.getElementById('btnZoomOut').addEventListener('click', () => changeZoom(-1));

canvas.addEventListener('wheel', e => {
    e.preventDefault();
    changeZoom(e.deltaY < 0 ? +1 : -1);
}, { passive: false });

// ── Init ───────────────────────────────────────────────────────────────────────

vscode.postMessage({ type: 'ready' });
</script>
</body>
</html>`;
    }
}
