import * as vscode from "vscode";
import { HardwarePanel } from "./HardwarePanel";

export class GateArrayPanel extends HardwarePanel {
    static currentPanel: GateArrayPanel | undefined;

    static createOrShow(): void {
        const column = vscode.window.activeTextEditor
            ? vscode.ViewColumn.Beside
            : vscode.ViewColumn.One;

        if (GateArrayPanel.currentPanel) {
            GateArrayPanel.currentPanel._panel.reveal(column);
            GateArrayPanel.currentPanel.refresh().catch(() => {});
            return;
        }

        const panel = vscode.window.createWebviewPanel(
            "z80gaPanel",
            "Gate Array",
            column,
            { enableScripts: true, retainContextWhenHidden: true }
        );

        GateArrayPanel.currentPanel = new GateArrayPanel(panel);
    }

    private constructor(panel: vscode.WebviewPanel) {
        super(panel);
        this._panel.webview.html = this._buildHtml();
        this._panel.webview.onDidReceiveMessage(async (msg) => {
            if (msg.type === "ready" || msg.type === "refresh") {
                await this.refresh();
            }
        });
    }

    protected override onDispose(): void {
        GateArrayPanel.currentPanel = undefined;
    }

    async refresh(): Promise<void> {
        const session = vscode.debug.activeDebugSession;
        if (!session) {
            this._panel.webview.postMessage({ type: "error", message: "No active debug session" });
            return;
        }
        try {
            const result = await session.customRequest("getGateArrayState", {});
            if (result?.error) {
                this._panel.webview.postMessage({ type: "error", message: result.error });
            } else {
                this._panel.webview.postMessage({ type: "gaState", state: result });
            }
        } catch (e) {
            this._panel.webview.postMessage({ type: "error", message: String(e) });
        }
    }

    private _buildHtml(): string {
        return /* html */`<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline';">
<style>
${HardwarePanel.commonCss()}
  /* Palette grid */
  .palette-grid {
    display: grid;
    grid-template-columns: repeat(8, 1fr);
    gap: 4px;
    margin-top: 4px;
  }
  .swatch {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 2px;
    padding: 3px;
    border: 1px solid var(--border);
    border-radius: 3px;
    cursor: default;
  }
  .swatch.active-pen {
    border: 2px solid var(--vscode-focusBorder, #007fd4);
  }
  .swatch.changed {
    background: var(--diff-ins);
  }
  .color-box {
    width: 36px;
    height: 24px;
    border-radius: 2px;
    border: 1px solid rgba(255,255,255,0.15);
    flex-shrink: 0;
  }
  .swatch-label {
    font-size: 0.75em;
    color: var(--fg-dim);
    font-family: var(--font);
    text-align: center;
    line-height: 1.2;
  }
  /* Border swatch */
  .border-row {
    display: flex;
    align-items: center;
    gap: 8px;
    margin-top: 4px;
  }
  .border-box {
    width: 60px;
    height: 24px;
    border-radius: 2px;
    border: 1px solid rgba(255,255,255,0.15);
  }
  /* Flags row */
  .flags-row {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
    margin-top: 4px;
  }
  .flag {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    font-size: 0.85em;
    padding: 1px 6px;
    border: 1px solid var(--border);
    border-radius: 3px;
  }
  .flag .dot {
    width: 7px; height: 7px;
    border-radius: 50%;
  }
  .dot-on  { background: var(--vscode-testing-iconPassed, #73c991); }
  .dot-off { background: var(--fg-dim); }
  .dot-warn { background: var(--vscode-testing-iconFailed, #f48771); }
  /* Memory map */
  .memmap {
    display: grid;
    grid-template-columns: 5.5em 1fr 1fr;
    gap: 0;
    margin-top: 4px;
    border: 1px solid var(--border);
    border-radius: 4px;
    overflow: hidden;
    font-size: 0.82em;
  }
  .memmap-hdr {
    background: var(--bg-section);
    color: var(--fg-dim);
    padding: 3px 6px;
    font-weight: 600;
    border-bottom: 1px solid var(--border);
    text-align: center;
  }
  .memmap-addr {
    font-family: var(--font);
    padding: 5px 6px;
    border-right: 1px solid var(--border);
    border-bottom: 1px solid var(--border);
    color: var(--fg-dim);
    white-space: nowrap;
    background: var(--bg-section);
  }
  .memmap-cell {
    padding: 5px 6px;
    border-right: 1px solid var(--border);
    border-bottom: 1px solid var(--border);
    display: flex;
    align-items: center;
    gap: 5px;
  }
  .memmap-cell:last-child { border-right: none; }
  .memmap-addr:last-of-type,
  .memmap-cell.last-row { border-bottom: none; }
  .mem-badge {
    display: inline-block;
    border-radius: 3px;
    padding: 1px 5px;
    font-weight: 600;
    font-size: 0.82em;
    letter-spacing: 0.03em;
    white-space: nowrap;
  }
  .mem-rom   { background: #7c4f00; color: #ffd080; }
  .mem-ram   { background: #00497a; color: #7dd4fa; }
  .mem-cart  { background: #1a5c2a; color: #89d9a0; }
  .mem-ext   { background: #4a2080; color: #c8a0fa; }
  .mem-unk   { background: var(--bg-section); color: var(--fg-dim); }
  @media (prefers-color-scheme: light) {
    .mem-rom  { background: #ffe5b0; color: #7c3a00; }
    .mem-ram  { background: #b8dff7; color: #00457a; }
    .mem-cart { background: #b8f0cc; color: #1a5c2a; }
    .mem-ext  { background: #e0d0ff; color: #4a2080; }
  }
</style>
</head>
<body>

<div class="toolbar">
  <span id="badgeMode" class="badge">Mode ?</span>
  <span id="badgeIrq"  class="badge">IRQ —</span>
  <button id="btnRefresh">&#x21BA; Refresh</button>
</div>
<div id="errorMsg" class="error"></div>

<div class="section-title">Ink Palette (INK 0–15)</div>
<div id="paletteGrid" class="palette-grid"></div>

<div class="section-title">Border</div>
<div class="border-row">
  <div id="borderBox" class="border-box"></div>
  <span id="borderHex" class="mono dim"></span>
</div>

<div class="section-title">Flags</div>
<div id="flagsRow" class="flags-row"></div>

<div class="section-title">Memory Map</div>
<div id="memMap" class="memmap">
  <div class="memmap-hdr">Address</div>
  <div class="memmap-hdr">Read</div>
  <div class="memmap-hdr">Write</div>
</div>

<script>
const vscode = acquireVsCodeApi();

let prevInks    = null;
let prevBorder  = null;
let prevInkRegs = null;

// Maps raw GA color byte (data & 0x5F) to CPC hardware color index 0-26
// ListeColorsIndexConvert from GateArray.cpp: index i → raw byte
const CPC_RAW_TO_INDEX = new Uint8Array(0x60).fill(255);
const CONVERT = [0x54,0x44,0x55,0x5c,0x58,0x5D,0x4c,0x45,0x4d,0x56,0x46,0x57,0x5e,0x40,0x5f,0x4e,0x47,0x4f,0x52,0x42,0x53,0x5a,0x59,0x5b,0x4a,0x43,0x4b];
for (let i = 0; i < 27; i++) CPC_RAW_TO_INDEX[CONVERT[i]] = i;
// Alias: 0x60-0x7F → same as 0x40-0x5F (case 0x60 in GA)
for (let b = 0x40; b < 0x60; b++) if (CPC_RAW_TO_INDEX[b] !== 255) CPC_RAW_TO_INDEX[b & 0x5F] = CPC_RAW_TO_INDEX[b];

const CPC_COLOR_NAMES = [
    'Black','Blue','Bright Blue','Red','Magenta','Mauve',
    'Bright Red','Purple','Bright Magenta','Green','Cyan','Sky Blue',
    'Yellow','White','Pastel Blue','Orange','Pink','Pastel Magenta',
    'Bright Green','Sea Green','Bright Cyan','Lime','Pastel Green',
    'Pastel Cyan','Bright Yellow','Pastel Yellow','Bright White'
];

function cpcColorFromReg(reg) {
    const idx = CPC_RAW_TO_INDEX[reg & 0x5F] ?? 255;
    return { idx, name: idx < 27 ? CPC_COLOR_NAMES[idx] : '?' };
}

function argbToRgb(v) {
    const r = (v >>> 16) & 0xFF;
    const g = (v >>> 8)  & 0xFF;
    const b =  v         & 0xFF;
    return { r, g, b, css: \`rgb(\${r},\${g},\${b})\`, hex: '#' + r.toString(16).padStart(2,'0') + g.toString(16).padStart(2,'0') + b.toString(16).padStart(2,'0') };
}

function luminance(r, g, b) { return 0.299*r + 0.587*g + 0.114*b; }

function renderPalette(state) {
    const inks    = state.inks;      // array[16] ARGB
    const inkRegs = state.inkRegs;   // array[16] raw GA byte
    const pen     = state.pen ?? 0;
    const grid    = document.getElementById('paletteGrid');
    grid.innerHTML = '';

    for (let i = 0; i < 16; i++) {
        const col      = argbToRgb(inks[i]);
        const cpc      = inkRegs ? cpcColorFromReg(inkRegs[i]) : { idx: '?', name: '' };
        const changed  = prevInkRegs ? (prevInkRegs[i] !== (inkRegs?.[i] ?? -1)) : false;
        const isActive = (i === pen);
        const lum      = luminance(col.r, col.g, col.b);
        const labelCol = lum > 128 ? '#000' : '#fff';

        const div = document.createElement('div');
        div.className = 'swatch' + (isActive ? ' active-pen' : '') + (changed ? ' changed' : '');
        div.title = \`INK \${i} — CPC color \${cpc.idx} (\${cpc.name}) — \${col.hex}\${isActive ? ' (selected pen)' : ''}\`;
        div.innerHTML =
            \`<div class="color-box" style="background:\${col.css}; color:\${labelCol}"></div>\` +
            \`<div class="swatch-label">\${i}<br><b>\${cpc.idx}</b> \${cpc.name}</div>\`;
        grid.appendChild(div);
    }
    prevInks    = inks.slice();
    prevInkRegs = inkRegs ? inkRegs.slice() : null;
}

function renderBorder(state) {
    const col    = argbToRgb(state.border ?? 0);
    const cpc    = state.borderReg !== undefined ? cpcColorFromReg(state.borderReg) : { idx: '?', name: '' };
    const changed = prevBorder !== null && prevBorder !== (state.borderReg ?? state.border);
    document.getElementById('borderBox').style.background = col.css;
    const hexEl = document.getElementById('borderHex');
    hexEl.textContent = \`\${cpc.idx} \${cpc.name}\`;
    if (changed) hexEl.style.background = 'var(--diff-ins)';
    else         hexEl.style.background = '';
    prevBorder = state.borderReg ?? state.border;
}

function flag(label, on, warn) {
    const cls = warn ? 'dot-warn' : (on ? 'dot-on' : 'dot-off');
    return \`<span class="flag"><span class="dot \${cls}"></span>\${label}</span>\`;
}

function renderFlags(state) {
    const irqN = state.interruptCounter ?? 0;
    const irqR = state.interruptRaised  ?? false;

    document.getElementById('badgeMode').textContent = 'Mode ' + (state.mode ?? '?');
    document.getElementById('badgeIrq').textContent  = 'IRQ ' + irqN + (irqR ? ' !' : '');

    const row = document.getElementById('flagsRow');
    row.innerHTML =
        flag('IRQ Raised', irqR, irqR) +
        flag('ASIC Locked', state.asicLocked ?? false, false);
}

function memLabel(type, index) {
    switch (type) {
        case 'lower_rom': return { cls: 'mem-rom',  text: 'Lower ROM (OS)' };
        case 'upper_rom': return { cls: 'mem-rom',  text: 'Upper ROM #' + index };
        case 'ram':       return { cls: 'mem-ram',  text: 'RAM bank '   + index };
        case 'ext_ram':   return { cls: 'mem-ext',  text: 'Ext RAM #'   + index };
        case 'cart':      return { cls: 'mem-cart', text: 'Cart slot '  + index };
        default:          return { cls: 'mem-unk',  text: '?' };
    }
}

function renderMemMap(state) {
    const wins = state.memWindows;
    if (!wins || wins.length === 0) return;

    const container = document.getElementById('memMap');
    // Remove all rows except the header (first 3 divs)
    while (container.children.length > 3) container.removeChild(container.lastChild);

    // Display from high to low address (C000 first)
    for (let w = 3; w >= 0; w--) {
        const win  = wins[w];
        const base = win.base;
        const top  = base + 0x3FFF;
        const isLast = (w === 0);

        const addrEl = document.createElement('div');
        addrEl.className = 'memmap-addr' + (isLast ? ' last-row' : '');
        addrEl.textContent = \`\${hex4(base)}–\${hex4(top)}\`;

        const rd = memLabel(win.readType, win.readIndex);
        const rdEl = document.createElement('div');
        rdEl.className = 'memmap-cell' + (isLast ? ' last-row' : '');
        rdEl.innerHTML = \`<span class="mem-badge \${rd.cls}">\${rd.text}</span>\`;

        const wr = memLabel(win.writeType, win.writeIndex);
        const wrEl = document.createElement('div');
        wrEl.className = 'memmap-cell' + (isLast ? ' last-row' : '');
        wrEl.innerHTML = \`<span class="mem-badge \${wr.text !== '?' ? 'mem-ram' : 'mem-unk'}">\${wr.text}</span>\`;

        container.appendChild(addrEl);
        container.appendChild(rdEl);
        container.appendChild(wrEl);
    }
}

function hex4(n) { return '0x' + n.toString(16).toUpperCase().padStart(4, '0'); }

function applyState(state) {
    document.getElementById('errorMsg').style.display = 'none';
    renderPalette(state);
    renderBorder(state);
    renderFlags(state);
    renderMemMap(state);
}

document.getElementById('btnRefresh').addEventListener('click', () => {
    vscode.postMessage({ type: 'refresh' });
});

window.addEventListener('message', e => {
    const msg = e.data;
    if      (msg.type === 'gaState') applyState(msg.state);
    else if (msg.type === 'error') {
        document.getElementById('errorMsg').textContent = 'Error: ' + msg.message;
        document.getElementById('errorMsg').style.display = 'block';
    }
});

vscode.postMessage({ type: 'ready' });
</script>
</body>
</html>`;
    }
}
