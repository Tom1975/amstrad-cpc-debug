# Getting Started

## Prerequisites

| Requirement | Details |
|-------------|---------|
| **SugarboxV2** | [Download](https://github.com/Tom1975/SugarboxV2/releases) or build from source |
| **VS Code** | 1.75 or later |
| **Extension** | `amstrad-cpc-debug` — install from VSIX (see below) |

## Install the extension

1. Download the latest `.vsix` from the [Releases](https://github.com/Tom1975/amstrad-cpc-debug/releases) page.
2. In VS Code, open the Command Palette (`Ctrl+Shift+P`) → **Extensions: Install from VSIX…**
3. Select the downloaded `.vsix` file.
4. Reload VS Code when prompted.

## First debug session

### Recommended folder structure

```
myproject/
├── .vscode/
│   └── launch.json
├── main.asm          ← your source
├── main.sna          ← snapshot to load (or use disk/tape)
└── game.dsk          ← optional disk image
```

### Minimal `launch.json`

```json
{
  "version": "0.2.0",
  "configurations": [
    {
      "type": "z80debug",
      "request": "launch",
      "name": "CPC Debug",
      "sugarbox": "/path/to/Sugarbox",
      "program": "${workspaceFolder}/main.sna"
    }
  ]
}
```

Replace `/path/to/Sugarbox` with the actual path to the `Sugarbox` binary (or `Sugarbox.exe` on Windows).

### Launch

Press **F5** (or **Run → Start Debugging**). SugarboxV2 starts, loads the snapshot, and pauses at the entry point. The Debug toolbar appears in VS Code.

See [Configuration](Configuration) for all available fields (disk images, tape, machine model, port…).
