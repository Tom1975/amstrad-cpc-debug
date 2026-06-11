import * as vscode from "vscode";
import * as fs     from "fs";
import * as path   from "path";
import { CpcConfig, CpcProjectConfig } from "./CpcConfig";

// Popular CPC configurations bundled in Sugarbox CONF/
const BUILTIN_CONFIGS: Array<{ label: string; value: string }> = [
    { label: "CPC 6128 FR",            value: "CPC6128FR"        },
    { label: "CPC 6128 UK",            value: "CPC6128UK"        },
    { label: "CPC 6128 FR + 128K RAM", value: "CPC6128FRXMEM"    },
    { label: "CPC 464 FR",             value: "CPC464FR"         },
    { label: "CPC 464 UK",             value: "CPC464UK"         },
    { label: "CPC 464 FR + DDI1",      value: "CPC464FRDDI1"     },
    { label: "CPC 464 UK + DDI1",      value: "CPC464UKDDI1"     },
    { label: "CPC 464 FR + DDI1 + 128K", value: "CPC464FRDDI1128KO" },
    { label: "CPC 664 UK",             value: "CPC664UK"         },
    { label: "CPC 6128 Plus EN",       value: "CPC6128PLUSEN"    },
    { label: "CPC 6128 Plus FR",       value: "CPC6128PLUSFR"    },
];

export class ProjectPanel {
    static readonly viewType = "z80debug.project";
    private static _current: ProjectPanel | undefined;

    private readonly _panel: vscode.WebviewPanel;
    private readonly _context: vscode.ExtensionContext;
    private _disposables: vscode.Disposable[] = [];

    static createOrShow(context: vscode.ExtensionContext): void {
        if (ProjectPanel._current) {
            ProjectPanel._current._panel.reveal();
            return;
        }
        const panel = vscode.window.createWebviewPanel(
            ProjectPanel.viewType,
            "CPC Project — Configuration",
            vscode.ViewColumn.Active,
            { enableScripts: true, retainContextWhenHidden: true }
        );
        ProjectPanel._current = new ProjectPanel(panel, context);
    }

    private constructor(panel: vscode.WebviewPanel, context: vscode.ExtensionContext) {
        this._panel   = panel;
        this._context = context;

        this._panel.webview.html = this._getHtml();
        this._panel.onDidDispose(() => this._dispose(), null, this._disposables);

        this._panel.webview.onDidReceiveMessage(async (msg) => {
            switch (msg.type) {
                case "ready":
                    this._sendCurrentConfig();
                    break;

                case "browse": {
                    const filters: Record<string, string[]> =
                        msg.field === "disk"   || msg.field === "diskB"   ? { "Disk images": ["dsk", "DSK"] } :
                        msg.field === "tape"                               ? { "Tapes": ["cdt", "tzx", "wav"] } :
                        msg.field === "snapshot"                           ? { "Snapshots": ["sna", "SNA"] } :
                        msg.field === "cartridge"                          ? { "Cartridges": ["cpr", "CPR"] } :
                        msg.field === "symbolFile"                         ? { "Symbol files": ["rasm"], "All": ["*"] } :
                                                                             { "All files": ["*"] };
                    const picked = await vscode.window.showOpenDialog({
                        title: `Select ${msg.field}`,
                        canSelectMany: false,
                        filters,
                    });
                    if (picked) {
                        this._panel.webview.postMessage({
                            type: "setPath", field: msg.field, value: picked[0].fsPath
                        });
                    }
                    break;
                }

                case "save": {
                    const folder = vscode.workspace.workspaceFolders?.[0];
                    if (!folder) {
                        vscode.window.showErrorMessage("No workspace folder open.");
                        return;
                    }
                    const lt = msg.launchType as string;
                    const cfg: CpcProjectConfig = {
                        configuration: msg.configuration || undefined,
                        launch: {
                            type:       lt,
                            disk:       lt === "disk"      ? msg.disk      || undefined : undefined,
                            diskB:      lt === "disk"      ? msg.diskB     || undefined : undefined,
                            tape:       lt === "tape"      ? msg.tape      || undefined : undefined,
                            snapshot:   lt === "snapshot"  ? msg.snapshot  || undefined : undefined,
                            cartridge:  lt === "cartridge" ? msg.cartridge || undefined : undefined,
                            symbolFile: msg.symbolFile || undefined,
                            port:       Number(msg.port) || 1234,
                        },
                    };
                    CpcConfig.write(folder.uri.fsPath, cfg);
                    vscode.window.showInformationMessage("cpc.json saved.");
                    this._panel.dispose();
                    break;
                }

                case "cancel":
                    this._panel.dispose();
                    break;
            }
        }, null, this._disposables);
    }

    private _sendCurrentConfig(): void {
        const folder = vscode.workspace.workspaceFolders?.[0];
        const existing = folder ? CpcConfig.read(folder.uri.fsPath) : null;

        // Enumerate CONF/ directory from Sugarbox path for extra configs
        const sugarboxPath = vscode.workspace.getConfiguration("z80debug").get<string>("sugarbox", "");
        let extraConfigs: Array<{ label: string; value: string }> = [];
        if (sugarboxPath && fs.existsSync(sugarboxPath)) {
            const confDir = path.join(path.dirname(sugarboxPath), "CONF");
            if (fs.existsSync(confDir)) {
                extraConfigs = fs.readdirSync(confDir)
                    .filter(f => f.endsWith(".cfg") || f.endsWith(".CFG"))
                    .map(f => {
                        const value = path.basename(f, path.extname(f));
                        return { label: value, value };
                    })
                    .filter(e => !BUILTIN_CONFIGS.some(b => b.value === e.value));
            }
        }

        this._panel.webview.postMessage({
            type:          "init",
            configuration: existing?.configuration ?? "CPC6128FR",
            launchType:    existing?.launch?.type ?? "disk",
            disk:          existing?.launch?.disk       ?? `build/\${buildName}.dsk`,
            diskB:         existing?.launch?.diskB      ?? "",
            tape:          existing?.launch?.tape       ?? "",
            snapshot:      existing?.launch?.snapshot   ?? "",
            cartridge:     existing?.launch?.cartridge  ?? "",
            symbolFile:    existing?.launch?.symbolFile ?? `build/\${buildName}.rasm`,
            port:          existing?.launch?.port       ?? 1234,
            builtinConfigs: BUILTIN_CONFIGS,
            extraConfigs,
        });
    }

    private _dispose(): void {
        ProjectPanel._current = undefined;
        this._panel.dispose();
        this._disposables.forEach(d => d.dispose());
        this._disposables = [];
    }

    private _getHtml(): string {
        return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy"
      content="default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline';">
<style>
  :root {
    --bg:       var(--vscode-editor-background);
    --fg:       var(--vscode-editor-foreground);
    --fg-dim:   var(--vscode-descriptionForeground);
    --border:   var(--vscode-panel-border, #444);
    --input-bg: var(--vscode-input-background);
    --input-fg: var(--vscode-input-foreground);
    --input-br: var(--vscode-input-border, #555);
    --btn-bg:   var(--vscode-button-background);
    --btn-fg:   var(--vscode-button-foreground);
    --btn-hov:  var(--vscode-button-hoverBackground);
    --sel-bg:   var(--vscode-dropdown-background, #3c3c3c);
    --font:     var(--vscode-editor-font-family, monospace);
  }
  * { box-sizing: border-box; }
  body {
    background: var(--bg); color: var(--fg);
    font-family: var(--vscode-font-family, sans-serif);
    font-size: var(--vscode-font-size, 13px);
    margin: 0; padding: 24px 32px; max-width: 680px;
  }
  h2 { font-size: 1.1em; font-weight: 600; margin: 0 0 4px; }
  .subtitle { color: var(--fg-dim); font-size:.82em; margin-bottom:24px; }
  h3 { font-size:.9em; font-weight:600; color:var(--fg-dim);
       text-transform:uppercase; letter-spacing:.06em;
       margin:24px 0 10px; border-bottom:1px solid var(--border); padding-bottom:4px; }
  label { display:block; color:var(--fg-dim); font-size:.83em; margin-bottom:4px; }
  select, input[type=text], input[type=number] {
    width:100%; background:var(--input-bg); color:var(--input-fg);
    border:1px solid var(--input-br); padding:5px 8px;
    font-family:var(--font); font-size:.9em; border-radius:2px; outline:none;
  }
  select { background:var(--sel-bg); }
  input:focus, select:focus { border-color:var(--vscode-focusBorder,#007acc); }
  .path-row { display:flex; gap:6px; align-items:center; }
  .path-row input { flex:1; }
  .field { margin-bottom:12px; }
  .hint { font-size:.75em; color:var(--fg-dim); margin-top:3px; }
  .launch-types { display:flex; gap:8px; flex-wrap:wrap; margin-bottom:4px; }
  .launch-types label {
    display:flex; align-items:center; gap:5px; cursor:pointer;
    color:var(--fg); font-size:.9em; padding:5px 10px;
    border:1px solid var(--border); border-radius:3px;
  }
  .launch-types input[type=radio] { accent-color:var(--btn-bg); }
  .launch-types label:has(input:checked) { border-color:var(--btn-bg); background:color-mix(in srgb, var(--btn-bg) 15%, transparent); }
  button {
    background:var(--btn-bg); color:var(--btn-fg);
    border:none; padding:6px 14px; cursor:pointer; border-radius:2px; font-size:.85em;
  }
  button:hover { background:var(--btn-hov); }
  button.secondary {
    background:transparent; color:var(--fg-dim); border:1px solid var(--border);
  }
  button.secondary:hover { color:var(--fg); border-color:var(--fg-dim); }
  .browse-btn { white-space:nowrap; padding:5px 10px; font-size:.82em; flex-shrink:0; }
  .actions { display:flex; gap:8px; margin-top:28px; }
  .section-files { }
  .file-field { display:none; }
  .file-field.visible { display:block; }
</style>
</head>
<body>
<h2>&#128187; CPC Project Configuration</h2>
<div class="subtitle">Saved as <code>cpc.json</code> at the project root — committed in git.</div>

<h3>CPC Model</h3>
<div class="field">
  <label for="configuration">Hardware configuration</label>
  <select id="configuration" onchange="onCfgChange()"></select>
  <div class="hint">Maps to the <code>--cfg</code> argument of Sugarbox. Determines CPU speed, RAM, disk controller, ROM.</div>
</div>
<div class="field" id="custom-cfg-field" style="display:none">
  <label for="custom-cfg">Custom configuration name</label>
  <input type="text" id="custom-cfg" placeholder="e.g. CPC6128FRCRTC1" spellcheck="false">
</div>

<h3>Debug Launch</h3>
<div class="field">
  <label>Launch type</label>
  <div class="launch-types">
    <label><input type="radio" name="launchType" value="disk"      onchange="onTypeChange()"> Disk</label>
    <label><input type="radio" name="launchType" value="snapshot"  onchange="onTypeChange()"> Snapshot</label>
    <label><input type="radio" name="launchType" value="tape"      onchange="onTypeChange()"> Tape</label>
    <label><input type="radio" name="launchType" value="cartridge" onchange="onTypeChange()"> Cartridge</label>
    <label><input type="radio" name="launchType" value="plain"     onchange="onTypeChange()"> Plain (no media)</label>
  </div>
</div>

<div class="section-files">
  <div class="file-field" id="field-disk">
    <div class="field">
      <label for="disk">Disk A (.dsk)</label>
      <div class="path-row">
        <input type="text" id="disk" spellcheck="false" placeholder="build/\${buildName}.dsk">
        <button class="browse-btn" onclick="browse('disk')">Browse…</button>
      </div>
    </div>
    <div class="field">
      <label for="diskB">Disk B (.dsk) — optional</label>
      <div class="path-row">
        <input type="text" id="diskB" spellcheck="false" placeholder="">
        <button class="browse-btn" onclick="browse('diskB')">Browse…</button>
      </div>
    </div>
  </div>
  <div class="file-field" id="field-snapshot">
    <div class="field">
      <label for="snapshot">Snapshot (.sna)</label>
      <div class="path-row">
        <input type="text" id="snapshot" spellcheck="false" placeholder="build/\${buildName}.sna">
        <button class="browse-btn" onclick="browse('snapshot')">Browse…</button>
      </div>
    </div>
  </div>
  <div class="file-field" id="field-tape">
    <div class="field">
      <label for="tape">Tape (.cdt / .tzx / .wav)</label>
      <div class="path-row">
        <input type="text" id="tape" spellcheck="false" placeholder="build/\${buildName}.cdt">
        <button class="browse-btn" onclick="browse('tape')">Browse…</button>
      </div>
    </div>
  </div>
  <div class="file-field" id="field-cartridge">
    <div class="field">
      <label for="cartridge">Cartridge (.cpr)</label>
      <div class="path-row">
        <input type="text" id="cartridge" spellcheck="false" placeholder="build/\${buildName}.cpr">
        <button class="browse-btn" onclick="browse('cartridge')">Browse…</button>
      </div>
    </div>
  </div>
</div>

<div class="field">
  <label for="symbolFile">Symbol file (.rasm) — optional</label>
  <div class="path-row">
    <input type="text" id="symbolFile" spellcheck="false" placeholder="build/\${buildName}.rasm">
    <button class="browse-btn" onclick="browse('symbolFile')">Browse…</button>
  </div>
  <div class="hint">Generated by RASM with <code>-s</code>. Used for label resolution in the debugger.</div>
</div>

<h3>Advanced</h3>
<div class="field" style="max-width:160px">
  <label for="port">Debug server TCP port</label>
  <input type="number" id="port" min="1024" max="65535" value="1234">
</div>

<div class="actions">
  <button onclick="save()">&#10003; Save cpc.json</button>
  <button class="secondary" onclick="cancel()">Cancel</button>
</div>

<script>
const vscode = acquireVsCodeApi();
const CUSTOM_VALUE = '__custom__';
let allConfigs = [];

window.addEventListener('message', e => {
  const msg = e.data;
  if (msg.type !== 'init') return;

  // Build config dropdown
  allConfigs = [...(msg.builtinConfigs || [])];
  if (msg.extraConfigs && msg.extraConfigs.length) {
    allConfigs.push({ label: '── From Sugarbox CONF/ ──', value: '__sep__', disabled: true });
    allConfigs.push(...msg.extraConfigs);
  }
  allConfigs.push({ label: 'Custom…', value: CUSTOM_VALUE });

  const sel = document.getElementById('configuration');
  allConfigs.forEach(c => {
    const opt = document.createElement('option');
    opt.value = c.value;
    opt.textContent = c.label;
    if (c.disabled) opt.disabled = true;
    sel.appendChild(opt);
  });

  // Set current values
  const knownVal = allConfigs.find(c => c.value === msg.configuration && c.value !== CUSTOM_VALUE);
  if (knownVal) {
    sel.value = msg.configuration;
  } else {
    sel.value = CUSTOM_VALUE;
    document.getElementById('custom-cfg').value = msg.configuration || '';
    document.getElementById('custom-cfg-field').style.display = 'block';
  }

  document.querySelectorAll('input[name=launchType]').forEach(r => {
    r.checked = r.value === msg.launchType;
  });

  document.getElementById('disk').value       = msg.disk       || '';
  document.getElementById('diskB').value      = msg.diskB      || '';
  document.getElementById('tape').value       = msg.tape       || '';
  document.getElementById('snapshot').value   = msg.snapshot   || '';
  document.getElementById('cartridge').value  = msg.cartridge  || '';
  document.getElementById('symbolFile').value = msg.symbolFile || '';
  document.getElementById('port').value       = msg.port       || 1234;

  onTypeChange();
});

function onCfgChange() {
  const v = document.getElementById('configuration').value;
  document.getElementById('custom-cfg-field').style.display = v === CUSTOM_VALUE ? 'block' : 'none';
}

function onTypeChange() {
  const t = document.querySelector('input[name=launchType]:checked')?.value;
  ['disk','snapshot','tape','cartridge'].forEach(k => {
    document.getElementById('field-' + k).classList.toggle('visible', k === t);
  });
}

function browse(field) { vscode.postMessage({ type: 'browse', field }); }

function getConfiguration() {
  const v = document.getElementById('configuration').value;
  return v === CUSTOM_VALUE ? document.getElementById('custom-cfg').value.trim() : v;
}

function save() {
  const t = document.querySelector('input[name=launchType]:checked')?.value || 'disk';
  vscode.postMessage({
    type:          'save',
    configuration: getConfiguration(),
    launchType:    t,
    disk:          document.getElementById('disk').value.trim(),
    diskB:         document.getElementById('diskB').value.trim(),
    tape:          document.getElementById('tape').value.trim(),
    snapshot:      document.getElementById('snapshot').value.trim(),
    cartridge:     document.getElementById('cartridge').value.trim(),
    symbolFile:    document.getElementById('symbolFile').value.trim(),
    port:          document.getElementById('port').value,
  });
}
function cancel() { vscode.postMessage({ type: 'cancel' }); }

function setPath(field, value) { document.getElementById(field).value = value; }
window.addEventListener('message', e => {
  if (e.data.type === 'setPath') setPath(e.data.field, e.data.value);
});

vscode.postMessage({ type: 'ready' });
</script>
</body>
</html>`;
    }
}
