import * as vscode from "vscode";
import { HardwarePanel } from "./HardwarePanel";

// Must mirror ORIGIN_X/ORIGIN_Y and the Screenshot()/CaptureFrameRGBA() crop
// loop in Sugarbox/Display.cpp: for each source scanline `line` (starting at
// ORIGIN_Y), that loop draws into destination row `line * 2` (de-interlace)
// — i.e. only X is offset by ORIGIN_X; Y is just doubled, not offset.
// Beam coordinates (beamX/beamY from getCrtcState) are in raw monitor space;
// this converts them into displayed-image space to place the cursor marker
// exactly on the pixel the CRTC is currently on.
const ORIGIN_X = 193;

export class ScreenPanel extends HardwarePanel {
    static currentPanel: ScreenPanel | undefined;
    private _lastWidth = 0;
    private _lastHeight = 0;
    private _hasFrame = false;

    static createOrShow(): void {
        const column = vscode.window.activeTextEditor
            ? vscode.ViewColumn.Beside
            : vscode.ViewColumn.One;

        if (ScreenPanel.currentPanel) {
            ScreenPanel.currentPanel._panel.reveal(column);
            ScreenPanel.currentPanel.refresh().catch(() => {});
            return;
        }

        const panel = vscode.window.createWebviewPanel(
            "z80screenPanel",
            "CPC Screen",
            column,
            { enableScripts: true, retainContextWhenHidden: true }
        );

        ScreenPanel.currentPanel = new ScreenPanel(panel);
    }

    private constructor(panel: vscode.WebviewPanel) {
        super(panel);
        this._panel.webview.html = this._buildHtml();

        this._panel.webview.onDidReceiveMessage(async (msg) => {
            if (msg.type === "ready") {
                await this.refresh();
                await this._subscribe();
            } else if (msg.type === "refresh") {
                await this.refresh();
            }
        });
    }

    protected override onDispose(): void {
        ScreenPanel.currentPanel = undefined;
        this._unsubscribe();
    }

    // Cursor is only meaningful (and only updated) while the CPU is stopped —
    // it's driven by refresh(), which HardwarePanel.refreshAll() calls on every
    // "stopped" DAP event (breakpoint, step, step in, step out, pause). While
    // running, the beam moves far too fast for per-instruction updates to mean
    // anything, so we don't poll it continuously.
    private async _updateCursor(): Promise<void> {
        const session = vscode.debug.activeDebugSession;
        if (!session) return;
        try {
            const crtc = await session.customRequest("getCrtcState", {});
            if (!crtc || crtc.error) {
                this._panel.webview.postMessage({ type: "cursor", clear: true });
                return;
            }
            const ga = await Promise.resolve(session.customRequest("getGateArrayState", {})).catch(() => undefined);
            const displayX = (crtc.beamX ?? 0) - ORIGIN_X;
            const displayY = (crtc.beamY ?? 0) * 2;
            const border = Array.isArray(ga?.palette) ? ga.palette[16] : undefined;
            this._panel.webview.postMessage({
                type: "cursor",
                beamX: crtc.beamX, beamY: crtc.beamY,
                displayX, displayY,
                imgW: this._lastWidth, imgH: this._lastHeight,
                ma: crtc.ma,
                hSyncActive: crtc.hSyncActive,
                vSyncActive: crtc.vSyncActive,
                border
            });
        } catch {
            this._panel.webview.postMessage({ type: "cursor", clear: true });
        }
    }

    private async _subscribe(): Promise<void> {
        const session = vscode.debug.activeDebugSession;
        if (!session) return;
        try { await session.customRequest("subscribeScreen", {}); } catch { /* optional command */ }
    }

    private _unsubscribe(): void {
        const session = vscode.debug.activeDebugSession;
        if (!session) return;
        session.customRequest("unsubscribeScreen", {}).then(() => {}, () => {});
    }

    // Called on every "frame" push event while the CPU runs.
    async pushFrame(body: any): Promise<void> {
        if (!body?.data) return;
        if (body.width)  this._lastWidth  = body.width;
        if (body.height) this._lastHeight = body.height;
        this._hasFrame = true;
        this._panel.webview.postMessage({ type: "frame", format: body.format, width: body.width, height: body.height, data: body.data });
    }

    async refresh(): Promise<void> {
        const session = vscode.debug.activeDebugSession;
        if (!session) {
            if (!this._hasFrame) this._panel.webview.postMessage({ type: "clear" });
            return;
        }
        try {
            const screen = await session.customRequest("getScreen", {});
            if (screen?.error) {
                this._panel.webview.postMessage({ type: "clear" });
                return;
            }
            if (screen.width)  this._lastWidth  = screen.width;
            if (screen.height) this._lastHeight = screen.height;
            this._hasFrame = true;
            this._panel.webview.postMessage({
                type: "frame",
                format: screen.format,
                width: screen.width,
                height: screen.height,
                data: screen.data
            });

            await this._updateCursor();
        } catch {
            this._panel.webview.postMessage({ type: "clear" });
        }
    }

    private _buildHtml(): string {
        return /* html */`<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; style-src 'unsafe-inline'; script-src 'unsafe-inline';">
<style>
${HardwarePanel.commonCss()}
  /* Outer: fixed-width scroll container */
  #screenOuter {
    display: none;
    margin-top: 4px;
    width: 100%;
    overflow-x: auto;
    overflow-y: hidden;
    background: #000;
    border: 1px solid var(--border);
  }
  /* Inner: inline-block so it sizes to the image */
  #screenWrap {
    position: relative;
    display: inline-block;
  }
  #screenCanvas {
    display: block;
    image-rendering: pixelated;
    image-rendering: crisp-edges;
  }
  #cursorH, #cursorV {
    position: absolute;
    pointer-events: none;
    display: none;
    background: rgba(255, 59, 48, 0.85);
    box-shadow: 0 0 2px rgba(0, 0, 0, 0.9);
  }
  #cursorH {
    left: 0; right: 0;
    height: 1px;
    margin-top: 0;
  }
  #cursorV {
    top: 0; bottom: 0;
    width: 1px;
    margin-left: 0;
  }
  /* Beam outside the visible window: shown faded, clamped to the edge. */
  #cursorH.offscreen, #cursorV.offscreen {
    background: rgba(255, 59, 48, 0.35);
  }
  #cursorInfo {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(140px, 1fr));
    gap: 4px 16px;
    margin-top: 8px;
  }
  .ci-row { display: flex; justify-content: space-between; }
  .ci-label { color: var(--fg-dim); }
  .border-swatch {
    display: inline-block;
    width: 10px; height: 10px;
    border-radius: 2px;
    border: 1px solid var(--border);
    vertical-align: -1px;
    margin-right: 4px;
  }
</style>
</head>
<body>

<div class="toolbar">
  <span id="badge" class="badge">CPC Screen</span>
  <button id="btnZoomOut" title="Zoom arrière (molette ↓)">&#x2212;</button>
  <span id="lblZoom" style="min-width:2.5em;text-align:center;font-variant-numeric:tabular-nums">1×</span>
  <button id="btnZoomIn" title="Zoom avant (molette ↑)">&#x2B;</button>
  <button id="btnRefresh">&#x21BA; Refresh</button>
</div>
<div id="errorMsg" class="error"></div>

<div id="screenOuter">
  <div id="screenWrap">
    <canvas id="screenCanvas"></canvas>
    <div id="cursorH"></div>
    <div id="cursorV"></div>
  </div>
</div>

<div class="section-title">Cursor (CRTC beam)</div>
<div id="cursorInfo"></div>

<script>
const vscode = acquireVsCodeApi();
const canvas  = document.getElementById('screenCanvas');
const ctx     = canvas.getContext('2d');
const cursorH = document.getElementById('cursorH');
const cursorV = document.getElementById('cursorV');
const cursorInfo = document.getElementById('cursorInfo');

const ZOOM_STEPS = [0.5, 1, 2, 3, 4];
let zoomIdx = 1;         // 1× par défaut
let currentImg = null;   // Image décodée en mémoire
let lastCursorMsg = null;

function redraw() {
    if (!currentImg) return;
    const z = ZOOM_STEPS[zoomIdx];
    canvas.width  = Math.round(currentImg.naturalWidth  * z);
    canvas.height = Math.round(currentImg.naturalHeight * z);
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(currentImg, 0, 0, canvas.width, canvas.height);
}

function applyZoom() {
    redraw();
    const z = ZOOM_STEPS[zoomIdx];
    document.getElementById('lblZoom').textContent = (z === Math.floor(z) ? z : z.toFixed(1)) + '×';
    document.getElementById('btnZoomOut').disabled = zoomIdx <= 0;
    document.getElementById('btnZoomIn').disabled  = zoomIdx >= ZOOM_STEPS.length - 1;
    if (lastCursorMsg) applyCursor(lastCursorMsg);
}

function zoomIn()  { if (zoomIdx < ZOOM_STEPS.length - 1) { zoomIdx++; applyZoom(); } }
function zoomOut() { if (zoomIdx > 0)                     { zoomIdx--; applyZoom(); } }

function hex4(v) { return (v & 0xFFFF).toString(16).toUpperCase().padStart(4, '0'); }

function applyFrame(msg) {
    document.getElementById('errorMsg').style.display = 'none';
    document.getElementById('screenOuter').style.display = 'block';
    const tmpImg = new Image();
    tmpImg.onload = () => { currentImg = tmpImg; redraw(); if (lastCursorMsg) applyCursor(lastCursorMsg); };
    tmpImg.src = 'data:image/' + (msg.format || 'png') + ';base64,' + msg.data;
}

function clearScreen() {
    document.getElementById('screenOuter').style.display = 'none';
    document.getElementById('errorMsg').style.display = 'none';
    currentImg = null;
    canvas.width = 0; canvas.height = 0;
    cursorH.style.display = 'none';
    cursorV.style.display = 'none';
    cursorInfo.innerHTML = '';
}

function applyCursor(msg) {
    lastCursorMsg = msg;
    if (msg.clear || msg.displayX === undefined) {
        cursorH.style.display = 'none';
        cursorV.style.display = 'none';
        cursorInfo.innerHTML = '';
        return;
    }

    const imgW = msg.imgW || (currentImg ? currentImg.naturalWidth  : 0) || 1;
    const imgH = msg.imgH || (currentImg ? currentImg.naturalHeight : 0) || 1;
    // canvas.width = naturalWidth * zoom, so scaleX = zoom
    const scaleX = canvas.width  / imgW;
    const scaleY = canvas.height / imgH;

    // The beam spends most of its time outside the cropped visible window
    // (border, HSYNC/VSYNC blanking) — clamp it to the nearest edge and mark
    // it as "offscreen" instead of hiding it, so it's always shown somewhere.
    const offscreen = msg.displayX < 0 || msg.displayY < 0 || msg.displayX >= imgW || msg.displayY >= imgH;
    const clampedX = Math.max(0, Math.min(imgW  - 1, msg.displayX));
    const clampedY = Math.max(0, Math.min(imgH - 1, msg.displayY));

    cursorV.style.left = (clampedX * scaleX) + 'px';
    cursorH.style.top  = (clampedY * scaleY) + 'px';
    cursorH.style.display = 'block';
    cursorV.style.display = 'block';
    cursorH.classList.toggle('offscreen', offscreen);
    cursorV.classList.toggle('offscreen', offscreen);

    const borderSwatch = msg.border !== undefined
        ? '<span class="border-swatch" style="background:rgb(' +
            ((msg.border >> 16) & 0xFF) + ',' + ((msg.border >> 8) & 0xFF) + ',' + (msg.border & 0xFF) + ')"></span>'
        : '';

    const items = [
        { label: 'X',      value: String(msg.displayX) },
        { label: 'Y',      value: String(msg.displayY) },
        { label: 'Addr (MA)', value: '0x' + hex4(msg.ma ?? 0) },
        { label: 'Border', value: borderSwatch + (msg.border !== undefined ? '0x' + hex4(msg.border) : '?') },
        { label: 'HSYNC',  value: msg.hSyncActive ? 'active' : '—' },
        { label: 'VSYNC',  value: msg.vSyncActive ? 'active' : '—' },
    ];
    cursorInfo.innerHTML = items.map(it =>
        '<div class="ci-row"><span class="ci-label">' + it.label + '</span><span class="mono">' + it.value + '</span></div>'
    ).join('');
}

window.addEventListener('message', e => {
    const msg = e.data;
    switch (msg.type) {
        case 'frame':
            applyFrame(msg);
            break;
        case 'cursor':
            applyCursor(msg);
            break;
        case 'clear':
            clearScreen();
            break;
        case 'error':
            document.getElementById('errorMsg').textContent = 'Error: ' + msg.message;
            document.getElementById('errorMsg').style.display = 'block';
            break;
    }
});

document.getElementById('btnRefresh').addEventListener('click', () => {
    vscode.postMessage({ type: 'refresh' });
});
document.getElementById('btnZoomIn').addEventListener('click',  zoomIn);
document.getElementById('btnZoomOut').addEventListener('click', zoomOut);
document.getElementById('screenOuter').addEventListener('wheel', e => {
    e.preventDefault();
    if (e.deltaY < 0) zoomIn(); else zoomOut();
}, { passive: false });

vscode.postMessage({ type: 'ready' });
</script>
</body>
</html>`;
    }
}
