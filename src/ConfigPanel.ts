import * as vscode from "vscode";

// ─── Settings schema ───────────────────────────────────────────────────────────
// Pour ajouter un réglage : une seule ligne ici + déclarer la clé dans package.json.
interface VsSetting {
    key:         string;
    label:       string;
    description: string;
    type:        "BOOL" | "TEXT" | "FILE";
    default:     string | boolean;
    fileTitle?:  string;   // FILE only — titre de la boîte de dialogue
}

const VS_SETTINGS: VsSetting[] = [
    {
        key:         "sugarbox",
        label:       "Émulateur Sugarbox",
        description: "Exécutable de l'émulateur SugarboxV2",
        type:        "FILE",
        default:     "",
        fileTitle:   "Sélectionner l'exécutable Sugarbox",
    },
    {
        key:         "rasm",
        label:       "Assembleur RASM",
        description: "Laissez rasm si l'assembleur est dans le PATH",
        type:        "FILE",
        default:     "rasm",
        fileTitle:   "Sélectionner l'exécutable RASM",
    },
    {
        key:         "hideEmulator",
        label:       "Masquer l'émulateur au lancement",
        description: "L'émulateur tourne en arrière-plan sans fenêtre visible",
        type:        "BOOL",
        default:     false,
    },
];

// ─── Panel ────────────────────────────────────────────────────────────────────
export class ConfigPanel {
    static readonly viewType = "z80debug.config";
    private static _current: ConfigPanel | undefined;

    private readonly _panel: vscode.WebviewPanel;
    private readonly _context: vscode.ExtensionContext;
    private _disposables: vscode.Disposable[] = [];

    static createOrShow(context: vscode.ExtensionContext): void {
        if (ConfigPanel._current) {
            ConfigPanel._current._panel.reveal();
            return;
        }
        const panel = vscode.window.createWebviewPanel(
            ConfigPanel.viewType,
            "Z80 Debug — Configuration",
            vscode.ViewColumn.Active,
            { enableScripts: true, retainContextWhenHidden: true }
        );
        ConfigPanel._current = new ConfigPanel(panel, context);
    }

    private constructor(panel: vscode.WebviewPanel, context: vscode.ExtensionContext) {
        this._panel   = panel;
        this._context = context;

        this._panel.webview.html = this._buildHtml();
        this._panel.onDidDispose(() => this._dispose(), null, this._disposables);

        this._panel.webview.onDidReceiveMessage(async (msg) => {
            switch (msg.type) {
                case "ready":
                    this._sendCurrentValues();
                    break;

                case "browse": {
                    const def = VS_SETTINGS.find(s => s.key === msg.key);
                    if (!def || def.type !== "FILE") break;
                    const isRemote = !!vscode.env.remoteName;
                    const isWin    = process.platform === "win32";
                    const current  = vscode.workspace.getConfiguration("z80debug").get<string>(def.key, "");

                    if (isRemote) {
                        const entered = await vscode.window.showInputBox({
                            title:           def.fileTitle ?? def.label,
                            prompt:          "Chemin absolu vers l'exécutable",
                            value:           current,
                            ignoreFocusOut:  true,
                        });
                        if (entered !== undefined) {
                            this._panel.webview.postMessage({ type: "setField", key: def.key, value: entered });
                        }
                    } else {
                        const picked = await vscode.window.showOpenDialog({
                            title:             def.fileTitle ?? def.label,
                            canSelectFiles:    true,
                            canSelectFolders:  false,
                            canSelectMany:     false,
                            filters:           isWin ? { "Exécutables": ["exe"] } : { "Tous les fichiers": ["*"] },
                        });
                        if (picked) {
                            this._panel.webview.postMessage({ type: "setField", key: def.key, value: picked[0].fsPath });
                        }
                    }
                    break;
                }

                case "save": {
                    const cfg = vscode.workspace.getConfiguration("z80debug");
                    const target = vscode.workspace.workspaceFolders
                        ? vscode.ConfigurationTarget.Workspace
                        : vscode.ConfigurationTarget.Global;
                    for (const def of VS_SETTINGS) {
                        const raw = msg.values[def.key];
                        const value = def.type === "BOOL" ? !!raw : (raw ?? def.default);
                        await cfg.update(def.key, value, target);
                    }
                    vscode.window.showInformationMessage("Configuration sauvegardée.");
                    this._panel.dispose();
                    break;
                }

                case "cancel":
                    this._panel.dispose();
                    break;
            }
        }, null, this._disposables);
    }

    private _sendCurrentValues(): void {
        const cfg = vscode.workspace.getConfiguration("z80debug");
        const values: Record<string, any> = {};
        for (const def of VS_SETTINGS) {
            values[def.key] = cfg.get(def.key, def.default);
        }
        this._panel.webview.postMessage({ type: "init", values });
    }

    private _dispose(): void {
        ConfigPanel._current = undefined;
        this._panel.dispose();
        this._disposables.forEach(d => d.dispose());
        this._disposables = [];
    }

    // ── HTML généré depuis VS_SETTINGS ────────────────────────────────────────
    private _buildHtml(): string {
        const fieldsHtml = VS_SETTINGS.map(def => this._buildField(def)).join("\n");

        // Script d'init généré depuis le schéma
        const initJs = VS_SETTINGS.map(def => {
            if (def.type === "BOOL") {
                return `document.getElementById('field-${def.key}').checked = !!v['${def.key}'];`;
            } else {
                return `document.getElementById('field-${def.key}').value = v['${def.key}'] ?? '';`;
            }
        }).join("\n        ");

        // Collecte des valeurs pour le save
        const collectJs = VS_SETTINGS.map(def => {
            if (def.type === "BOOL") {
                return `'${def.key}': document.getElementById('field-${def.key}').checked`;
            } else {
                return `'${def.key}': document.getElementById('field-${def.key}').value.trim()`;
            }
        }).join(",\n            ");

        return `<!DOCTYPE html>
<html lang="fr">
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
    --font:     var(--vscode-editor-font-family, monospace);
  }
  * { box-sizing: border-box; }
  body {
    background: var(--bg); color: var(--fg);
    font-family: var(--vscode-font-family, sans-serif);
    font-size: var(--vscode-font-size, 13px);
    margin: 0; padding: 24px 32px; max-width: 640px;
  }
  h2 { font-size:1.1em; font-weight:600; margin:0 0 20px; }
  .section { margin-bottom:16px; }
  label.field-label { display:block; color:var(--fg-dim); font-size:.85em; margin-bottom:5px; }
  .path-row { display:flex; gap:6px; align-items:center; }
  .path-row input, input[type=text] {
    flex:1; background:var(--input-bg); color:var(--input-fg);
    border:1px solid var(--input-br); padding:5px 8px;
    font-family:var(--font); font-size:.9em; border-radius:2px; outline:none;
  }
  .path-row input:focus, input[type=text]:focus { border-color:var(--vscode-focusBorder,#007acc); }
  .field-hint { font-size:.75em; color:var(--fg-dim); margin-top:4px; }
  .toggle-row {
    display:flex; align-items:center; gap:10px;
    padding:10px 0; border-top:1px solid var(--border); border-bottom:1px solid var(--border);
    margin-bottom:8px;
  }
  .toggle-row span  { font-size:.9em; }
  .toggle-row small { color:var(--fg-dim); font-size:.8em; display:block; }
  input[type=checkbox] { width:16px; height:16px; accent-color:var(--btn-bg); cursor:pointer; }
  button {
    background:var(--btn-bg); color:var(--btn-fg);
    border:none; padding:6px 14px; cursor:pointer; border-radius:2px; font-size:.85em;
  }
  button:hover { background:var(--btn-hov); }
  button.secondary {
    background:transparent; color:var(--fg-dim); border:1px solid var(--border);
  }
  button.secondary:hover { color:var(--fg); border-color:var(--fg-dim); }
  .actions { display:flex; gap:8px; margin-top:24px; }
</style>
</head>
<body>
<h2>&#9881; Z80 Debug — Configuration</h2>
${fieldsHtml}
<div class="actions">
  <button onclick="save()">&#10003; Sauvegarder</button>
  <button class="secondary" onclick="cancel()">Annuler</button>
</div>

<script>
const vscode = acquireVsCodeApi();

window.addEventListener('message', e => {
  const msg = e.data;
  if (msg.type === 'init') {
    const v = msg.values;
    ${initJs}
  } else if (msg.type === 'setField') {
    const el = document.getElementById('field-' + msg.key);
    if (el) el.value = msg.value;
  }
});

function save() {
  vscode.postMessage({
    type: 'save',
    values: {
            ${collectJs}
    }
  });
}
function cancel() { vscode.postMessage({ type: 'cancel' }); }

vscode.postMessage({ type: 'ready' });
</script>
</body>
</html>`;
    }

    private _buildField(def: VsSetting): string {
        if (def.type === "BOOL") {
            return `
<div class="toggle-row">
  <input type="checkbox" id="field-${def.key}">
  <div>
    <span>${def.label}</span>
    <small>${def.description}</small>
  </div>
</div>`;
        }

        if (def.type === "FILE") {
            return `
<div class="section">
  <label class="field-label" for="field-${def.key}">${def.label}</label>
  <div class="path-row">
    <input type="text" id="field-${def.key}" spellcheck="false">
    <button onclick="vscode.postMessage({type:'browse',key:'${def.key}'})">Parcourir…</button>
  </div>
  <div class="field-hint">${def.description}</div>
</div>`;
        }

        // TEXT
        return `
<div class="section">
  <label class="field-label" for="field-${def.key}">${def.label}</label>
  <input type="text" id="field-${def.key}" spellcheck="false">
  <div class="field-hint">${def.description}</div>
</div>`;
    }
}
