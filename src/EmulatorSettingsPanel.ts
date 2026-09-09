import * as vscode from "vscode";
import { HardwarePanel } from "./HardwarePanel";

export class EmulatorSettingsPanel extends HardwarePanel {
    static readonly viewType = "z80debug.emulatorSettings";
    private static _current: EmulatorSettingsPanel | undefined;

    static createOrShow(): void {
        const column = vscode.window.activeTextEditor
            ? vscode.ViewColumn.Beside
            : vscode.ViewColumn.One;

        if (EmulatorSettingsPanel._current) {
            EmulatorSettingsPanel._current._panel.reveal(column);
            return;
        }
        const panel = vscode.window.createWebviewPanel(
            EmulatorSettingsPanel.viewType,
            "Réglages émulateur",
            column,
            { enableScripts: true, retainContextWhenHidden: true }
        );
        EmulatorSettingsPanel._current = new EmulatorSettingsPanel(panel);
    }

    private constructor(panel: vscode.WebviewPanel) {
        super(panel);
        this._panel.webview.html = this._buildShell();

        this._panel.webview.onDidReceiveMessage(async (msg) => {
            switch (msg.type) {
                case "ready":
                case "refresh":
                    await this.refresh();
                    break;
                case "setSetting": {
                    const session = vscode.debug.activeDebugSession;
                    if (!session) break;
                    try {
                        await session.customRequest("setEmulatorSetting", {
                            variableReglage: msg.variableReglage,
                            valeur:          msg.valeur
                        });
                        // Re-lire la valeur réelle (le setter peut la corriger)
                        const r = await session.customRequest("getEmulatorSetting", {
                            variableReglage: msg.variableReglage
                        });
                        if (!r?.error) {
                            this._panel.webview.postMessage({
                                type:            "ack",
                                variableReglage: msg.variableReglage,
                                valeur:          r.valeur
                            });
                        }
                    } catch { /* session fermée */ }
                    break;
                }
            }
        });
    }

    protected onDispose(): void {
        EmulatorSettingsPanel._current = undefined;
    }

    async refresh(): Promise<void> {
        const session = vscode.debug.activeDebugSession;
        if (!session) {
            this._panel.webview.postMessage({ type: "settings", settings: [], error: "Pas de session de debug active" });
            return;
        }
        try {
            const result = await session.customRequest("getEmulatorSettings", {});
            if (result?.error) {
                this._panel.webview.postMessage({ type: "settings", settings: [], error: result.error });
            } else {
                this._panel.webview.postMessage({ type: "settings", settings: result.settings ?? [] });
            }
        } catch (e) {
            this._panel.webview.postMessage({ type: "settings", settings: [], error: String(e) });
        }
    }

    private _buildShell(): string {
        return `<!DOCTYPE html>
<html lang="fr">
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy"
      content="default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline';">
<style>
${HardwarePanel.commonCss()}
h2 { font-size:1.05em; font-weight:600; margin:0 0 16px; }
.error-msg { color: var(--vscode-errorForeground, #f48771); font-size:.9em; padding:8px 0; }
.settings-list { display:flex; flex-direction:column; gap:12px; }
.setting-row {
  display:grid;
  grid-template-columns: 1fr auto;
  align-items:center;
  gap:8px 12px;
  padding:10px 12px;
  background: var(--vscode-sideBar-background, #252526);
  border:1px solid var(--border);
  border-radius:3px;
}
.setting-label { font-weight:600; font-size:.9em; }
.setting-desc  { color:var(--fg-dim); font-size:.8em; grid-column:1; }
.setting-control { grid-row:1 / span 2; display:flex; align-items:center; gap:6px; }
input[type=range] {
  -webkit-appearance:none;
  width:120px; height:4px;
  background:var(--border);
  border-radius:2px;
  outline:none;
}
input[type=range]::-webkit-slider-thumb {
  -webkit-appearance:none;
  width:14px; height:14px;
  border-radius:50%;
  background:var(--vscode-button-background, #007acc);
  cursor:pointer;
}
input[type=number] {
  width:52px;
  background:var(--bg-input); color:var(--fg);
  border:1px solid var(--border); border-radius:2px;
  padding:3px 5px; font-family:var(--font); font-size:.9em;
  text-align:right;
}
input[type=checkbox] { width:16px; height:16px; accent-color:var(--vscode-button-background, #007acc); cursor:pointer; }
input[type=text] {
  background:var(--bg-input); color:var(--fg);
  border:1px solid var(--border); border-radius:2px;
  padding:4px 8px; font-family:var(--font); font-size:.9em;
  width:200px;
}
.toolbar button { font-size:.8em; }
</style>
</head>
<body>
<div class="toolbar">
  <h2>&#9881; Réglages émulateur</h2>
  <button onclick="requestRefresh()">&#8635; Rafraîchir</button>
</div>
<div id="error" class="error-msg" hidden></div>
<div id="list"  class="settings-list"></div>

<script>
const vscode = acquireVsCodeApi();

function requestRefresh() { vscode.postMessage({ type: 'refresh' }); }

window.addEventListener('message', e => {
  const msg = e.data;
  if (msg.type === 'settings') {
    render(msg.settings, msg.error);
  } else if (msg.type === 'ack') {
    applyAck(msg.variableReglage, msg.valeur);
  }
});

function applyAck(key, val) {
  const el = document.getElementById('ctrl-' + key);
  if (!el) return;
  if (el.type === 'checkbox') el.checked = (val === 'true');
  else if (el.type === 'range') { el.value = val; updateNum(key, val); }
  else el.value = val;
}

function updateNum(key, val) {
  const n = document.getElementById('num-' + key);
  if (n) n.value = val;
}

function send(key, val) {
  vscode.postMessage({ type: 'setSetting', variableReglage: key, valeur: String(val) });
}

function render(settings, error) {
  const errDiv = document.getElementById('error');
  const list   = document.getElementById('list');
  if (error) { errDiv.textContent = error; errDiv.hidden = false; }
  else { errDiv.hidden = true; }

  list.innerHTML = '';
  for (const s of settings) {
    const row = document.createElement('div');
    row.className = 'setting-row';

    const label = document.createElement('div');
    label.className = 'setting-label';
    label.textContent = s.nomCourt;

    const desc = document.createElement('div');
    desc.className = 'setting-desc';
    desc.textContent = s.nomLong;

    const ctrl = document.createElement('div');
    ctrl.className = 'setting-control';

    if (s.type === 'BOOL') {
      const cb = document.createElement('input');
      cb.type = 'checkbox';
      cb.id   = 'ctrl-' + s.variableReglage;
      cb.checked = (s.valeur === 'true');
      cb.addEventListener('change', () => send(s.variableReglage, cb.checked ? 'true' : 'false'));
      ctrl.appendChild(cb);
    } else if (s.type === 'INT') {
      const min = s.min ?? 0, max = s.max ?? 100;
      const slider = document.createElement('input');
      slider.type = 'range'; slider.min = min; slider.max = max;
      slider.value = s.valeur;
      slider.id = 'ctrl-' + s.variableReglage;

      const num = document.createElement('input');
      num.type = 'number'; num.min = min; num.max = max;
      num.value = s.valeur;
      num.id = 'num-' + s.variableReglage;

      slider.addEventListener('input', () => { num.value = slider.value; });
      slider.addEventListener('change', () => send(s.variableReglage, slider.value));
      num.addEventListener('change', () => {
        let v = parseInt(num.value, 10);
        if (isNaN(v)) v = parseInt(s.valeur, 10) || 0;
        if (v < min) v = min; if (v > max) v = max;
        slider.value = v; num.value = v;
        send(s.variableReglage, String(v));
      });

      ctrl.appendChild(slider);
      ctrl.appendChild(num);
    } else {
      const inp = document.createElement('input');
      inp.type = 'text'; inp.value = s.valeur;
      inp.id = 'ctrl-' + s.variableReglage;
      inp.addEventListener('change', () => send(s.variableReglage, inp.value));
      ctrl.appendChild(inp);
    }

    row.appendChild(label);
    row.appendChild(ctrl);
    row.appendChild(desc);
    list.appendChild(row);
  }
}

vscode.postMessage({ type: 'ready' });
</script>
</body>
</html>`;
    }
}
