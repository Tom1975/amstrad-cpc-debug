# Amstrad CPC Debug — Emulator Interface Specification

This document describes the TCP JSON protocol that an emulator must implement to work with the **amstrad-cpc-debug** VS Code extension.

The reference implementation is [`DebugServer.cpp`](https://github.com/Tom1975/SugarboxV2) in SugarboxV2.

---

## Overview

The extension acts as a DAP (Debug Adapter Protocol) server toward VS Code, and as a TCP client toward the emulator. The emulator must run a TCP server that accepts connections from the extension.

```
VS Code  ←—— DAP ——→  amstrad-cpc-debug  ←—— TCP JSON ——→  Emulator
```

---

## Transport

- **Protocol**: TCP, plain text
- **Default port**: `1234` (configurable via `launch.json` → `port`)
- **Framing**: newline-delimited JSON (`\n` terminates each message)
- **Direction**: bidirectional
  - Extension → Emulator: **commands** (one at a time, serialised)
  - Emulator → Extension: **responses** (one per command) + **events** (unsolicited, at any time)

The extension serialises all commands through an internal queue: only one command is in-flight at a time. The emulator must reply to each command before the next one is sent. Timeout: **10 seconds** per command.

### Command format

```json
{ "cmd": "<command_name>", ... }
```

Fields beyond `cmd` are command-specific.

### Response format

A response is any JSON object that does **not** have `"type": "event"`. The extension reads it as the answer to the currently in-flight command.

Error response (optional convention):
```json
{ "error": "<human-readable message>" }
```

### Event format

```json
{ "type": "event", "event": "<event_name>", "body": { ... } }
```

Events can be sent at any time, independently of the command queue. The extension routes them to the appropriate handler without blocking pending commands.

---

## Launch sequence

When the extension starts a session (`launch` mode), the sequence is:

1. Extension spawns the emulator with arguments (see below).
2. Extension polls the TCP port until it accepts connections (up to 10 s).
3. Extension connects and sends `loadSnapshot` if a `.sna` file was specified.
4. Extension sends `configurationDone` after receiving `InitializedEvent` from VS Code.
5. Emulator fires `{ type: "event", event: "stopped", body: { reason: "entry" } }`.
6. Normal debug session starts.

In `attach` mode, steps 1–3 are skipped: the emulator must already be listening.

### Emulator command-line arguments (launch mode)

The extension spawns the emulator with the following arguments:

```
<emulator_binary> --debug --debug_server <port> [options]
```

| Argument | Description |
|---|---|
| `--debug` | Enable debug mode |
| `--debug_server <port>` | Start TCP debug server on this port |
| `--csl <file>` | CSL script to execute at startup (disk/tape insertion) |
| `--cart <file>` | Cartridge image (`.cpr`) to load |
| `--cfg <name>` | Machine configuration profile (e.g. `CPC464`, `CPC+`) |
| `--hide` | Hide the emulator window |

The emulator's working directory is set to its own directory (not the VS Code workspace), so it can find its data files relative to itself.

### CSL script format

When `disk`, `diskB`, or `tape` are specified in `launch.json`, the extension writes a temporary CSL script and passes it via `--csl`:

```
cslversion 2.0
disk_insert 0 '/path/to/disk.dsk'
disk_insert 1 '/path/to/diskB.dsk'
tape_insert '/path/to/tape.cdt'
```

---

## Commands

### Core commands

#### `getState`

Returns the current CPU state (registers + running flag).

**Request:**
```json
{ "cmd": "getState" }
```

**Response:**
```json
{
  "pc": 49152,
  "sp": 65408,
  "af": 4660, "bc": 1, "de": 2, "hl": 3,
  "af'": 0, "bc'": 0, "de'": 0, "hl'": 0,
  "ix": 0, "iy": 0, "i": 0, "r": 0,
  "running": false
}
```

All register values are unsigned integers. `running` is `true` when the CPU is executing, `false` when paused.

---

#### `readRegisters`

Returns all Z80 registers as a flat object. Used to populate the Variables panel.

**Request:**
```json
{ "cmd": "readRegisters" }
```

**Response:**
```json
{
  "AF": 4660, "BC": 1, "DE": 2, "HL": 3,
  "AF'": 0, "BC'": 0, "DE'": 0, "HL'": 0,
  "PC": 49152, "SP": 65408,
  "IX": 0, "IY": 0, "I": 0, "R": 0
}
```

Keys are case-insensitive (the extension lowercases them internally). 16-bit registers have `memoryReference` set in the VS Code panel.

---

#### `setRegisters`

Writes one or more register values.

**Request:**
```json
{ "cmd": "setRegisters", "hl": 16384, "pc": 49152 }
```

Register names are lowercase. Any subset of registers may be included.

**Response:**
```json
{ "status": "ok" }
```

---

#### `readMemory`

Reads a contiguous block of memory.

**Request:**
```json
{
  "cmd": "readMemory",
  "address": 16384,
  "size": 256,
  "memType": "read",
  "bank": -1
}
```

| Field | Type | Default | Description |
|---|---|---|---|
| `address` | number | — | Start address (0–65535) |
| `size` | number | — | Number of bytes to read |
| `memType` | string | `"read"` | Memory source: `"read"`, `"write"`, `"ram"`, `"rom"`, `"cart"` |
| `bank` | number | `-1` | Bank index (−1 = currently mapped bank) |

**Response:**
```json
{ "bytes": [0, 1, 2, 3, ...] }
```

`bytes` is an array of unsigned integers (0–255), length = `size`.

---

#### `writeMemory`

Writes a contiguous block of memory.

**Request:**
```json
{
  "cmd": "writeMemory",
  "address": 16384,
  "bytes": [0, 1, 2, 3]
}
```

**Response:**
```json
{ "status": "ok" }
```

---

#### `disassemble`

Disassembles instructions starting at a given address.

**Request:**
```json
{
  "cmd": "disassemble",
  "address": 49152,
  "count": 64,
  "memType": "read",
  "bank": -1
}
```

**Response:**
```json
{
  "instructions": [
    { "address": 49152, "instruction": "LD HL,0x5A00", "bytes": [33, 0, 90] },
    { "address": 49155, "instruction": "CALL 0xBB5A",  "bytes": [205, 90, 187] },
    { "address": 49158, "instruction": "JR -2",        "bytes": [24, 254] }
  ]
}
```

Each instruction object:

| Field | Type | Description |
|---|---|---|
| `address` | number | Instruction start address |
| `instruction` | string | Mnemonic string |
| `bytes` | number[] | Raw bytes (optional but recommended) |

The extension may request up to 2048 instructions in a single call. It also uses two-pass backward disassembly for the native Disassembly View: it calls `disassemble` with a smaller start address and filters results. All forward-only disassembly is safe.

---

#### `setBreakpoints`

Replaces the entire breakpoint list on the emulator. Called after every change to any breakpoint (add, remove, re-apply on session start).

**Request:**
```json
{
  "cmd": "setBreakpoints",
  "breakpoints": [
    { "address": 49152 },
    { "address": 48000 }
  ]
}
```

The extension merges all breakpoint sources (source BPs, label BPs, instruction BPs, direct address BPs) and sends the deduplicated list in a single call.

**Response:**
```json
{ "status": "ok" }
```

---

#### `continue`

Resume CPU execution.

**Request:** `{ "cmd": "continue" }`

**Response:** `{ "status": "ok" }`

The emulator sends a `stopped` event when execution halts again (breakpoint, error, etc.).

**Note:** `continue` is also called by the extension on `disconnectRequest` before closing the TCP connection, to leave the emulator running after the debug session ends.

---

#### `halt`

Pause CPU execution immediately.

**Request:** `{ "cmd": "halt" }`

**Response:** `{ "status": "ok" }`

The extension sends a `StoppedEvent("pause")` to VS Code immediately after this command, without waiting for an event from the emulator.

---

#### `step`

Execute one instruction (Step Over). Handles `CALL`, `RST`, and block instructions without stepping into them.

**Request:** `{ "cmd": "step" }`

**Response:** `{ "status": "ok" }`

The emulator sends a `stopped` event when the step completes.

---

#### `stepIn`

Execute one instruction (Step Into). Enters `CALL` and `RST`.

**Request:** `{ "cmd": "stepIn" }`

**Response:** `{ "status": "ok" }`

The emulator sends a `stopped` event when done.

---

#### `stepOut`

Run until the current subroutine returns. Typically implemented by placing a temporary breakpoint on the return address read from the stack.

**Request:** `{ "cmd": "stepOut" }`

**Response:** `{ "status": "ok" }`

The emulator sends a `stopped` event when done.

---

#### `reset`

Reset the CPU and machine to their initial state.

**Request:** `{ "cmd": "reset" }`

**Response:** `{ "status": "ok" }`

The extension clears its disassembly cache after this call and sends `StoppedEvent("entry")`.

---

#### `loadSnapshot`

Load a snapshot from base64-encoded data. This avoids path-resolution issues between the extension host and the emulator process (especially in Remote-WSL setups).

**Request:**
```json
{
  "cmd": "loadSnapshot",
  "data": "<base64-encoded .sna file content>"
}
```

**Response (success):**
```json
{ "status": "ok" }
```

**Response (failure):**
```json
{ "status": "error", "message": "Invalid snapshot format" }
```

---

#### `evaluate`

Evaluate an expression in the context of the current CPU state. Used by the VS Code Debug Console.

**Request:**
```json
{ "cmd": "evaluate", "expression": "hl" }
```

**Response:**
```json
{ "text": "0x4000" }
```

The expression format is emulator-defined. The SugarboxV2 implementation supports register names, memory read expressions (`read:0x4000`), and write expressions (`write:0x4000=0xFF`).

---

#### `getMemBanks`

Returns the list of addressable memory sources, used to let the user choose which bank to disassemble.

**Request:** `{ "cmd": "getMemBanks" }`

**Response:**
```json
{
  "sources": [
    { "type": "read",  "bank": -1, "label": "READ (mapped)"    },
    { "type": "ram",   "bank":  0, "label": "RAM bank 0"       },
    { "type": "ram",   "bank":  1, "label": "RAM bank 1"       },
    { "type": "rom",   "bank":  0, "label": "ROM bank 0 (BASIC)" },
    { "type": "cart",  "bank":  0, "label": "Cartridge bank 0" }
  ]
}
```

If the command is not supported, return `{ "error": "unknown command" }`. The extension falls back to `memType="read", bank=-1` silently.

---

#### `insertDisk`

Insert a disk image into a drive while the emulator is running. Used by the FDC panel.

**Request:**
```json
{ "cmd": "insertDisk", "drive": 0, "path": "/absolute/path/to/disk.dsk" }
```

| Field | Type | Description |
|---|---|---|
| `drive` | number | Drive index: `0` = A, `1` = B |
| `path` | string | Absolute path to the `.dsk` file |

**Response (success):** `{ "status": "ok" }`

**Response (failure):** `{ "error": "LoadDisk failed", "code": -1 }`

---

### Hardware state commands

These commands are used by the hardware panel views. They are all optional: if the emulator returns `{ "error": "unknown command" }`, the corresponding panel will show an empty state.

All hardware state commands follow the same pattern:

**Request:** `{ "cmd": "<commandName>" }`

**Response:** a flat or nested JSON object with the hardware state.

---

#### `getCrtcState`

Returns the state of the CRTC 6845 (or ASIC for CPC+).

**Response (CPC standard):**
```json
{
  "selectedRegister": 12,
  "registers": [63, 40, 46, 140, 38, 0, 25, 30, 0, 7, 0, 0, 48, 0, 192, 0, 0],
  "mode": "asic"
}
```

`registers`: array of 17 values (R0–R16).

**Response (CPC+ ASIC mode)** — additional fields:
```json
{
  "selectedRegister": 0,
  "registers": [...],
  "mode": "asic",
  "palette": [0, 1, 2, ...],
  "sprites": [
    {
      "x": 100, "y": 50, "zoom": 0,
      "pixels": [[0, 1, 2, ...], ...]
    }
  ],
  "dma": [
    { "prescaler": 0, "addr": 0, "pause": 0 },
    { "prescaler": 0, "addr": 0, "pause": 0 },
    { "prescaler": 0, "addr": 0, "pause": 0 }
  ]
}
```

---

#### `getGateArrayState`

Returns the state of the Gate Array (Amstrad PAL).

**Response:**
```json
{
  "mode": 1,
  "penSelected": 0,
  "palette": [20, 4, 21, 28, 24, 29, 12, 5, 20, 4, 21, 28, 24, 29, 12, 5, 0],
  "romHigh": true,
  "romLow": false,
  "interrupt": 0
}
```

`palette`: 17 entries (16 pens + border), firmware colour indices (0–26).

---

#### `getPsgState`

Returns the state of the PSG AY-3-8912.

**Response:**
```json
{
  "selectedRegister": 7,
  "registers": [0, 0, 0, 0, 0, 0, 0, 56, 0, 0, 0, 0, 0, 0, 0, 0]
}
```

`registers`: 16 values (R0–R15).

---

#### `getPpiState`

Returns the state of the PPI 8255.

**Response:**
```json
{
  "portA": 0,
  "portB": 94,
  "portC": 0,
  "control": 130
}
```

---

#### `getFdcState`

Returns the state of the FDC (floppy disk controller) and all loaded drives.

**Response:**
```json
{
  "drives": [
    {
      "present": true,
      "track": 0,
      "side": 0,
      "sectors": [
        {
          "track": 0, "side": 0, "sector": 1, "size": 2,
          "realSize": 512,
          "idamOffset": 64,
          "damOffset": 160,
          "deleted": false,
          "hdrCrc": true,
          "dataCrc": true
        }
      ],
      "rawTrack": null
    },
    { "present": false }
  ]
}
```

The `rawTrack` field is normally `null` in `getFdcState`; use `getTrackRaw` to fetch MFM track data.

---

#### `getTapeState`

Returns the state of the tape drive.

**Response:**
```json
{
  "present": true,
  "playing": false,
  "position": 1234,
  "length": 98765
}
```

---

#### `getAsicState`

Returns the state of the ASIC (CPC+ / GX4000 only). May overlap with `getCrtcState` for ASIC-specific fields.

**Response:** emulator-defined. Typically includes sprite, palette, and DMA data identical to the ASIC fields in `getCrtcState`.

---

#### `getTapeSignal`

Returns a sampled cassette signal suitable for waveform display.

**Request:** `{ "cmd": "getTapeSignal" }`

**Response:**
```json
{
  "samples": [0, 1, 0, 0, 1, 1, 0, ...],
  "sampleRate": 44100
}
```

`samples`: array of 0/1 values (square wave). `sampleRate`: samples per second.

---

#### `getTrackRaw`

Returns the raw MFM bitfield for a track, used by the FDC panel's hex and bitmap views.

**Request:**
```json
{ "cmd": "getTrackRaw", "drive": 0, "track": 0, "side": 0 }
```

**Response:**
```json
{
  "bits": [0, 1, 0, 1, ...],
  "size": 6250,
  "bitSize": 1,
  "bitOff": 0,
  "indexEnd": 6000,
  "sectors": [
    {
      "track": 0, "side": 0, "sector": 1, "size": 2,
      "realSize": 512,
      "idamOffset": 64,
      "damOffset": 160,
      "deleted": false
    }
  ]
}
```

| Field | Type | Description |
|---|---|---|
| `bits` | number[] | One entry per MFM bit. Values: `0` = bit 0, `1` = bit 1, `2` = weak bit (uncertain), `4` = MFM clock violation |
| `size` | number | Total number of bits |
| `bitSize` | number | Bits per decoded byte (always 16 for MFM) |
| `bitOff` | number | Bit offset of track start (usually 0) |
| `indexEnd` | number | Bit offset of the index hole (end of one revolution) |
| `sectors` | object[] | Sector descriptors with bit offsets |

Sector descriptor fields:

| Field | Type | Description |
|---|---|---|
| `track` | number | Track number (from IDAM) |
| `side` | number | Side number (from IDAM) |
| `sector` | number | Sector number (from IDAM) |
| `size` | number | Sector size code (0=128, 1=256, 2=512, 3=1024 bytes) |
| `realSize` | number | Actual data bytes in this sector |
| `idamOffset` | number | Bit offset of the first sync byte before the IDAM |
| `damOffset` | number | Bit offset of the first sync byte before the DAM |
| `deleted` | boolean | `true` if the DAM is F8 (deleted data) |

---

## Events

Events are sent by the emulator at any time, without an in-flight command. They use the format:

```json
{ "type": "event", "event": "<name>", "body": { ... } }
```

---

### `stopped`

The CPU has halted execution (breakpoint hit, step complete, pause, or initial entry).

```json
{
  "type": "event",
  "event": "stopped",
  "body": { "reason": "breakpoint" }
}
```

`reason` values: `"breakpoint"`, `"step"`, `"pause"`, `"entry"`, or any emulator-defined string. VS Code displays the reason in the debug toolbar.

---

### `mediaChanged`

A disk or tape was inserted or ejected while the emulator is running.

```json
{
  "type": "event",
  "event": "mediaChanged",
  "body": { "drive": 0 }
}
```

The FDC panel refreshes automatically when this event is received.

---

## Implementation notes

### Minimal implementation

A minimal emulator needs only these commands to support core debugging:

| Command | Purpose |
|---|---|
| `getState` | Stack trace + PC + state |
| `readRegisters` | Variables panel |
| `readMemory` | Stack view, memory view, breakpoint resolution |
| `disassemble` | Disassembly view |
| `setBreakpoints` | Breakpoints |
| `continue` | F5 |
| `halt` | F6 (pause) |
| `step` | F10 (step over) |
| `stepIn` | F11 |
| `stepOut` | Shift+F11 |
| `reset` | Restart |
| `stopped` event | Notify VS Code when paused |

All other commands are optional and degrade gracefully.

### Unknown commands

Return `{ "error": "unknown command" }` for any unrecognised `cmd`. The extension checks for `result?.error` and handles it without throwing.

### Concurrency

The extension sends one command at a time. The emulator does not need to handle concurrent requests. However, events (`stopped`, `mediaChanged`) may arrive while a command response is being written — this is safe because the extension dispatches events independently from the command queue.
