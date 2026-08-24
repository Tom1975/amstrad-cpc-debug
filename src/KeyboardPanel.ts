import * as vscode from "vscode";
import { HardwarePanel } from "./HardwarePanel";
import { LAYOUTS } from "./layouts";

export class KeyboardPanel extends HardwarePanel {
    static currentPanel: KeyboardPanel | undefined;

    static createOrShow(): void {
        const column = vscode.window.activeTextEditor
            ? vscode.ViewColumn.Beside
            : vscode.ViewColumn.One;

        if (KeyboardPanel.currentPanel) {
            KeyboardPanel.currentPanel._panel.reveal(column);
            return;
        }

        const panel = vscode.window.createWebviewPanel(
            "cpcKeyboard",
            "CPC Keyboard",
            column,
            { enableScripts: true, retainContextWhenHidden: true }
        );

        KeyboardPanel.currentPanel = new KeyboardPanel(panel);
    }

    private constructor(panel: vscode.WebviewPanel) {
        super(panel);
        this._panel.webview.html = this._buildHtml();
        this._panel.webview.onDidReceiveMessage(async (msg: { type: string; line: number; bit: number }) => {
            if (msg.type !== "keyDown" && msg.type !== "keyUp") { return; }
            const session = vscode.debug.activeDebugSession;
            if (!session) { return; }
            try {
                await session.customRequest("keyboard", {
                    line: msg.line,
                    bit:  msg.bit,
                    pressed: msg.type === "keyDown",
                });
            } catch { /* session does not support keyboard */ }
        });
    }

    protected override onDispose(): void {
        KeyboardPanel.currentPanel = undefined;
    }

    async refresh(): Promise<void> {
        const active = !!vscode.debug.activeDebugSession;
        this._panel.webview.postMessage({ type: "sessionState", active });
    }

    private _buildHtml(): string {
        const cfg     = vscode.workspace.getConfiguration("z80debug");
        const locale  = (cfg.get<string>("keyboardLayout") ?? "EN").toUpperCase();
        const initial = LAYOUTS[locale] ? locale : "EN";
        const json    = JSON.stringify(LAYOUTS);

        return /* html */`<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy"
  content="default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline';">
<style>
${HardwarePanel.commonCss()}
body { user-select: none; -webkit-user-select: none; }

select {
  font-family: var(--font);
  font-size: var(--font-size);
  background: var(--btn-bg);
  color: var(--btn-fg);
  border: 1px solid var(--border);
  padding: 2px 6px;
  cursor: pointer;
}
button.active {
  background: var(--vscode-button-background, #0e639c);
  color: var(--vscode-button-foreground, #fff);
  border-color: var(--vscode-button-background, #0e639c);
}
#keyboard-wrap { overflow-x: auto; margin-top: 4px; }
#keyboard { position: relative; width: 700px; height: 252px; }

.key {
  position: absolute; box-sizing: border-box;
  border: 1px solid var(--border);
  background: var(--btn-bg);
  border-radius: 3px; cursor: pointer;
  display: flex; flex-direction: column;
  align-items: center; justify-content: center;
  overflow: hidden; transition: background 0.04s;
}
.key:hover:not(.pressed):not(.sticky-held) { background: var(--btn-hover); }
.key.pressed {
  background: var(--vscode-button-background, #0e639c);
  color: var(--vscode-button-foreground, #fff);
  border-color: var(--vscode-button-background, #0e639c);
}
.key.sticky-held { background: #b34700; color: #fff; border-color: #b34700; }
.key-top  { font-size: 9px;  opacity: 0.7; line-height: 1.2; }
.key-main { font-size: 11px; font-weight: bold; line-height: 1.3; }

#status { font-size: 0.85em; color: var(--fg-dim); margin-top: 6px; }
</style>
</head>
<body>

<div class="toolbar">
  <span class="badge">CPC Keyboard</span>
  <label>Layout:</label>
  <select id="locale-sel">
    <option value="EN">EN QWERTY</option>
    <option value="FR">FR AZERTY</option>
    <option value="DE">DE QWERTZ</option>
    <option value="ES">ES Spanish</option>
  </select>
  <button id="mode-btn">Normal</button>
  <button id="clear-btn">Release all</button>
</div>

<div id="keyboard-wrap"><div id="keyboard"></div></div>
<div id="status"></div>

<script>
(function () {
  const vscode = acquireVsCodeApi();
  const LAYOUTS = ${json};
  let locale = '${initial}';
  let sticky = false;
  const held = new Set();

  const kbEl     = document.getElementById('keyboard');
  const modeBtn  = document.getElementById('mode-btn');
  const clearBtn = document.getElementById('clear-btn');
  const localeSel = document.getElementById('locale-sel');
  const statusEl  = document.getElementById('status');

  localeSel.value = locale;

  function esc(s) {
    return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  function build(loc) {
    locale = loc;
    const keys = (LAYOUTS[loc] || LAYOUTS['EN']).keys;
    kbEl.innerHTML = '';
    held.clear();
    for (const k of keys) {
      const el = document.createElement('div');
      el.className = 'key';
      el.style.cssText = 'left:' + k.x + 'px;top:' + k.y + 'px;width:' + k.w + 'px;height:' + k.h + 'px';
      el.dataset.line = k.line;
      el.dataset.bit  = k.bit;
      const kid = k.line + '_' + k.bit;
      el.innerHTML =
        (k.label2 ? '<span class="key-top">' + esc(k.label2) + '</span>' : '') +
        '<span class="key-main">' + esc(k.label) + '</span>';

      el.addEventListener('mousedown', function (e) {
        e.preventDefault();
        if (!sticky) { press(k.line, k.bit, el, kid); }
      });
      el.addEventListener('mouseup', function () {
        if (!sticky) { release(k.line, k.bit, el, kid); }
      });
      el.addEventListener('mouseleave', function () {
        if (!sticky && held.has(kid)) { release(k.line, k.bit, el, kid); }
      });
      el.addEventListener('click', function () {
        if (sticky) {
          held.has(kid) ? release(k.line, k.bit, el, kid) : press(k.line, k.bit, el, kid);
        }
      });
      kbEl.appendChild(el);
    }
  }

  function press(line, bit, el, kid) {
    if (held.has(kid)) { return; }
    held.add(kid);
    el.classList.add(sticky ? 'sticky-held' : 'pressed');
    vscode.postMessage({ type: 'keyDown', line: line, bit: bit });
  }

  function release(line, bit, el, kid) {
    if (!held.has(kid)) { return; }
    held.delete(kid);
    el.classList.remove('pressed', 'sticky-held');
    vscode.postMessage({ type: 'keyUp', line: line, bit: bit });
  }

  function releaseAll() {
    kbEl.querySelectorAll('.pressed, .sticky-held').forEach(function (el) {
      release(+el.dataset.line, +el.dataset.bit, el, el.dataset.line + '_' + el.dataset.bit);
    });
  }

  modeBtn.addEventListener('click', function () {
    releaseAll();
    sticky = !sticky;
    modeBtn.textContent = sticky ? 'Sticky' : 'Normal';
    modeBtn.classList.toggle('active', sticky);
  });

  clearBtn.addEventListener('click', releaseAll);

  localeSel.addEventListener('change', function () {
    releaseAll();
    build(localeSel.value);
  });

  window.addEventListener('message', function (evt) {
    const m = evt.data;
    if (m.type === 'sessionState') {
      statusEl.textContent = m.active ? '' : 'Aucune session de debug active';
    }
  });

  build(locale);
}());
</script>
</body>
</html>`;
    }
}
