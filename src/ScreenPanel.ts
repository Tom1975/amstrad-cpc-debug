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
        this._panel.webview.postMessage({ type: "frame", format: body.format, width: body.width, height: body.height, data: body.data });
    }

    async refresh(): Promise<void> {
        const session = vscode.debug.activeDebugSession;
        if (!session) {
            this._panel.webview.postMessage({ type: "error", message: "No active debug session" });
            return;
        }
        try {
            const screen = await session.customRequest("getScreen", {});
            if (screen?.error) {
                this._panel.webview.postMessage({ type: "error", message: screen.error });
                return;
            }
            if (screen.width)  this._lastWidth  = screen.width;
            if (screen.height) this._lastHeight = screen.height;
            this._panel.webview.postMessage({
                type: "frame",
                format: screen.format,
                width: screen.width,
                height: screen.height,
                data: screen.data
            });

            await this._updateCursor();
        } catch (e) {
            this._panel.webview.postMessage({ type: "error", message: String(e) });
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
  #screenWrap {
    position: relative;
    display: inline-block;
    margin-top: 4px;
    background: #000;
    border: 1px solid var(--border);
  }
  #screenImg {
    display: block;
    image-rendering: pixelated;
    image-rendering: crisp-edges;
    max-width: 100%;
  }
  #cursorDot {
    position: absolute;
    width: 8px;
    height: 8px;
    margin-left: -4px;
    margin-top: -4px;
    border-radius: 50%;
    background: #ff3b30;
    box-shadow: 0 0 0 1px #fff, 0 0 4px 1px rgba(255,59,48,0.9);
    pointer-events: none;
    display: none;
  }
  /* Beam is currently in the border/blanking area (outside the visible
     window): shown as a hollow ring clamped to the nearest edge instead
     of a filled dot, so it stays visible rather than disappearing. */
  #cursorDot.offscreen {
    background: transparent;
    border: 2px solid #ff3b30;
    box-shadow: 0 0 0 1px #fff;
    width: 6px;
    height: 6px;
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
  <button id="btnRefresh">&#x21BA; Refresh</button>
</div>
<div id="errorMsg" class="error"></div>

<div id="screenWrap">
  <img id="screenImg" alt="CPC screen">
  <div id="cursorDot"></div>
</div>

<div class="section-title">Cursor (CRTC beam)</div>
<div id="cursorInfo"></div>

<script>
const vscode = acquireVsCodeApi();
const img = document.getElementById('screenImg');
const dot = document.getElementById('cursorDot');
const cursorInfo = document.getElementById('cursorInfo');

function hex4(v) { return (v & 0xFFFF).toString(16).toUpperCase().padStart(4, '0'); }

function applyFrame(msg) {
    document.getElementById('errorMsg').style.display = 'none';
    img.src = 'data:image/' + (msg.format || 'png') + ';base64,' + msg.data;
}

function applyCursor(msg) {
    if (msg.clear || msg.displayX === undefined) {
        dot.style.display = 'none';
        cursorInfo.innerHTML = '';
        return;
    }

    const imgW = msg.imgW || img.naturalWidth  || 1;
    const imgH = msg.imgH || img.naturalHeight || 1;
    const scaleX = (img.clientWidth  || imgW) / imgW;
    const scaleY = (img.clientHeight || imgH) / imgH;

    // The beam spends most of its time outside the cropped visible window
    // (border, HSYNC/VSYNC blanking) — clamp it to the nearest edge and mark
    // it as "offscreen" instead of hiding it, so it's always shown somewhere.
    const offscreen = msg.displayX < 0 || msg.displayY < 0 || msg.displayX >= imgW || msg.displayY >= imgH;
    const clampedX = Math.max(0, Math.min(imgW  - 1, msg.displayX));
    const clampedY = Math.max(0, Math.min(imgH - 1, msg.displayY));

    dot.style.left = (clampedX * scaleX) + 'px';
    dot.style.top  = (clampedY * scaleY) + 'px';
    dot.style.display = 'block';
    dot.classList.toggle('offscreen', offscreen);

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
        case 'error':
            document.getElementById('errorMsg').textContent = 'Error: ' + msg.message;
            document.getElementById('errorMsg').style.display = 'block';
            break;
    }
});

document.getElementById('btnRefresh').addEventListener('click', () => {
    vscode.postMessage({ type: 'refresh' });
});

vscode.postMessage({ type: 'ready' });
</script>
</body>
</html>`;
    }
}
