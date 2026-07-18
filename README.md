# Amstrad CPC Debug — VS Code Extension

> 🇫🇷 [Version française disponible](README.fr.md)

A VS Code debugging extension for **Amstrad CPC** Z80 development (CPC 464 / 664 / 6128 / CPC+).

The extension acts as a Debug Adapter Protocol (DAP) bridge between VS Code and a CPC emulator. It connects to the emulator over a JSON/TCP protocol documented in [`EMULATOR_INTERFACE.md`](EMULATOR_INTERFACE.md), making it compatible with any emulator that implements this protocol.

The reference emulator is **[SugarboxV2](https://github.com/Tom1975/SugarboxV2)**.

---

## Requirements

- [VS Code](https://code.visualstudio.com/) 1.108+
- A CPC emulator supporting the TCP debug protocol (see [`EMULATOR_INTERFACE.md`](EMULATOR_INTERFACE.md))
- [RASM](http://www.rasm.assemble.tf/) (recommended Z80 assembler)
- Node.js 18+ and npm (only needed to build the extension from source)
- Python 3 (only needed to package the `.vsix` via `make_vsix.py` — stdlib only, no pip packages required)

---

## Installation

### From VSIX

```bash
code --install-extension amstrad-cpc-debug-0.0.3.vsix
```

### Installing the build tools

<details>
<summary><strong>Windows</strong></summary>

```powershell
winget install OpenJS.NodeJS.LTS
winget install Python.Python.3.12
winget install Microsoft.VisualStudioCode
```

On Windows the Python launcher is usually `python`, not `python3` — use `python make_vsix.py` in the build step below (see [Build from source](#build-from-source)).

`RASM` has no Windows package — download `rasm.exe` from [rasm.assemble.tf](http://www.rasm.assemble.tf/) and either add its folder to `PATH` or point the `z80debug.rasm` setting / `RASM` environment variable to it.

</details>

<details>
<summary><strong>Linux (Debian/Ubuntu)</strong></summary>

```bash
sudo apt update
sudo apt install nodejs npm python3
```

The Node.js version shipped by `apt` can be old; if `node --version` is below 18, install a current one via [nvm](https://github.com/nvm-sh/nvm) instead:

```bash
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.1/install.sh | bash
nvm install --lts
```

Install VS Code from the [official `.deb`/apt repository](https://code.visualstudio.com/docs/setup/linux) or via `snap install code --classic`.

`RASM` has no apt package — download the Linux binary from [rasm.assemble.tf](http://www.rasm.assemble.tf/), `chmod +x` it, and put it on your `PATH` (or set the `RASM` environment variable / `z80debug.rasm` setting to its path).

</details>

<details>
<summary><strong>macOS</strong></summary>

```bash
brew install node python3
brew install --cask visual-studio-code
```

`RASM` has no Homebrew formula — download the macOS binary from [rasm.assemble.tf](http://www.rasm.assemble.tf/), `chmod +x` it, and put it on your `PATH` (or set the `RASM` environment variable / `z80debug.rasm` setting to its path). You may need to clear the Gatekeeper quarantine flag: `xattr -d com.apple.quarantine rasm`.

</details>

### Build from source

```bash
npm install
npm run bundle          # compile TypeScript + webpack → dist/main.js
python3 make_vsix.py    # produces amstrad-cpc-debug-0.0.3.vsix — use "python make_vsix.py" on Windows
code --install-extension amstrad-cpc-debug-0.0.3.vsix
```

All three commands (`npm install`, `npm run bundle`, `make_vsix.py`) are cross-platform and run the same way on Windows, Linux and macOS once the prerequisites above are installed.

---

## Quick start

### 1. Configure paths

Open the command palette (`Ctrl+Shift+P`) → **Z80 Debug: Configure** and set:
- the path to the emulator (SugarboxV2 or other)
- the path to RASM

### 2. Create a project

Palette → **Z80 Debug: New CPC Project...** — the wizard creates a folder with `src/main.asm`, the `.vscode/` files (tasks, launch, settings), and an assembler template ready to build.

### 3. Start debugging

Press **F5** or use **Z80 Debug: Launch CPC...** for the interactive quick launch.

---

## launch.json configuration

### Launch mode (recommended)

The extension starts the emulator, loads the media, and attaches the debugger.

```json
{
  "version": "0.2.0",
  "configurations": [
    {
      "type": "z80",
      "request": "launch",
      "name": "Amstrad CPC - Debug",
      "emulator": "/path/to/Sugarbox",
      "snapshot": "${workspaceFolder}/build/mygame.sna",
      "symbolFile": "${workspaceFolder}/build/mygame.rasm",
      "port": 1234,
      "preLaunchTask": "RASM: assemble"
    }
  ]
}
```

### Attach mode

Attach the debugger to an already-running emulator.

```bash
./Sugarbox --debug --debug_server 1234
```

```json
{
  "type": "z80",
  "request": "attach",
  "name": "Amstrad CPC - Attach",
  "port": 1234,
  "symbolFile": "${workspaceFolder}/build/mygame.rasm"
}
```

### Configuration properties

#### `launch` mode

| Property | Type | Default | Description |
|---|---|---|---|
| `emulator` | string | *(required)* | Path to the emulator binary |
| `port` | number | `1234` | TCP port of the debug server |
| `snapshot` | string | — | `.sna` snapshot file to load |
| `disk` | string | — | `.dsk` disk image — drive A |
| `diskB` | string | — | `.dsk` disk image — drive B |
| `tape` | string | — | `.cdt` / `.wav` / `.tzx` tape image |
| `cartridge` | string | — | `.cpr` cartridge (CPC+/GX4000) |
| `configuration` | string | — | Machine profile (e.g. `CPC464`, `CPC+`) |
| `symbolFile` | string | — | RASM symbol file (`.rasm`) |
| `sourceFile` | string | — | Main `.asm` source file (enriches disassembly) |
| `hideEmulator` | boolean | `false` | Hide the emulator window |
| `preLaunchTask` | string | — | VS Code task to run before launch |

#### `attach` mode

| Property | Type | Default | Description |
|---|---|---|---|
| `port` | number | `1234` | TCP port of the debug server |
| `symbolFile` | string | — | RASM symbol file (`.rasm`) |
| `sourceFile` | string | — | Main `.asm` source file |

---

## Features

### Execution control

| Action | Shortcut |
|---|---|
| Continue | F5 |
| Pause | F6 |
| Step Over | F10 |
| Step Into | F11 |
| Step Out | Shift+F11 |
| Restart | Ctrl+Shift+F5 |
| Stop | Shift+F5 |

**Step Over** intelligently handles `CALL`, `RST`, `DJNZ`, and block instructions (`LDIR`, `LDDR`, etc.).

**Step Out** reads the return address from the stack and places a temporary breakpoint on it.

### Virtual disassembly

The extension automatically opens a disassembly view at the current PC address. If a RASM symbol file is provided, labels are interleaved in the text:

```
GAME_LOOP:
0x5A00  LD A,(0x5C00)    ; A6 00 5C  ...
0x5A03  CP #FF           ; FE FF     ..
0x5A05  JR Z,GAME_OVER  ; 28 00     (.

GAME_OVER:
0x5A07  HALT             ; 76        v
```

Shortcuts:
- `Ctrl+Alt+D` — open disassembly at an address
- `Ctrl+Alt+M` — open memory view at an address

### Breakpoints

Three breakpoint types coexist and are merged into a single `setBreakpoints` call sent to the emulator:

- **Disassembly breakpoints** — click in the gutter or press `F9` on an instruction line
- **Label breakpoints** — VS Code *Breakpoints > Function Breakpoints* panel: enter a RASM label or an address (`0xBB5A`, `BB5A`, `47962`)
- **Instruction breakpoints** — from VS Code's native Disassembly View

Direct breakpoints (F9) are **persistent**: they survive session restarts and are automatically re-applied on each `configurationDone`.

### Registers and stack

The **Variables** panel exposes:
- **Registers**: all Z80 registers (AF, BC, DE, HL, SP, PC, IX, IY, AF', BC', DE', HL', I, R) — editable by double-clicking
- **Stack**: top 16 words on the stack with their addresses

16-bit registers offer *Open Memory View* and *Open Disassembly View* in their context menu.

### Memory

Right-click a register → *Open Memory View* — inspect and edit memory.

If the emulator supports `getMemBanks`, a bank selector is shown when opening a disassembly window.

### Hardware panels

A **Z80 Debug** activity bar entry gives access to hardware panels:

| Panel | Content |
|---|---|
| CRTC / ASIC | CRTC 6845 registers, ASIC sprites (CPC+), palette, DMA |
| Gate Array | Video mode, 17-colour palette, interrupt state |
| PSG (AY-3-8912) | Registers for all 3 sound channels |
| PPI (8255) | Ports A/B/C, mode, keyboard |
| FDC | Drive state, sectors, MFM track hex view, disk insertion |
| Tape | Counter, state, square-wave signal |

Panels refresh automatically on every CPU stop.

### Quick Launch

**Z80 Debug: Launch CPC...** (`Ctrl+Shift+P`) — interactive wizard to choose media and machine configuration. The last parameters are remembered and offered at the top of the list for instant relaunch.

### Project creation

**Z80 Debug: New CPC Project...** — generates a complete project with:
- `src/main.asm` (Hello World template or empty skeleton)
- `.vscode/tasks.json` (RASM build task)
- `.vscode/launch.json` (launch + attach configurations)
- `.vscode/settings.json` (project settings)
- `.gitignore`

---

## Architecture

```
VS Code (DAP client)
    ↕  DAP inline (stdio)
Z80DebugSession.ts  (debug adapter)
    ↕  JSON/TCP port 1234
CPC Emulator (e.g. SugarboxV2 DebugServer.cpp)
    ↕  direct calls
Z80 CPU / hardware
```

In `launch` mode, the adapter:
1. Writes a temporary CSL script if media is provided
2. Spawns the emulator: `<emulator> --debug --debug_server <port> [--csl <file>] [--cfg <name>] [--hide]`
3. Polls the TCP port until it opens (retry every 250 ms, 10 s timeout)
4. Connects, sends `loadSnapshot` if a `.sna` is specified
5. Sends `InitializedEvent` → VS Code sends `configurationDone` → emulator breaks on `entry`

---

## Emulator compatibility

The extension works with any emulator that implements the TCP JSON protocol described in [`EMULATOR_INTERFACE.md`](EMULATOR_INTERFACE.md). Hardware commands (CRTC, FDC panels, etc.) are optional: the extension degrades gracefully if they are not supported.

---

## Known limitations

- Breakpoints on real `.asm` source files are not supported (only on virtual disassembly and via labels).
- A single Z80 thread is exposed.
- Emulator response timeout: 10 s per command.
