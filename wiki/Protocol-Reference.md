# Protocol Reference

This page documents the JSON/TCP protocol spoken by SugarboxV2's debug server. Any emulator can implement this protocol and be used with the `amstrad-cpc-debug` extension.

## Overview

- **Transport:** TCP, one JSON object per line (`\n`-terminated)
- **Direction:** client (extension) sends a request; server (emulator) replies with one response
- **Async events:** the server may send event messages at any time (not in reply to a request)
- **Default port:** 1234 (configurable with `--ds <port>`)

### Request format

```json
{"cmd": "commandName", "field1": value1, "field2": value2}
```

### Response format

```json
{"status": "ok", "field1": value1}
```

On error:

```json
{"error": "description", "code": N}
```

---

## Command reference

### Execution

| Command | Extra fields | Response fields |
|---------|-------------|----------------|
| `step` | — | `status:"ok"` |
| `stepIn` | — | `status:"ok"` |
| `stepOut` | — | `status:"ok"` |
| `continue` | — | `status:"ok"` |
| `halt` | — | `status:"ok"` |
| `pause` | — | `status:"ok"` |
| `reset` | — | `status:"ok"` |
| `getState` | — | `running:"true"\|"false"`, `pc:N` |

### Registers

| Command | Extra fields | Response fields |
|---------|-------------|----------------|
| `readRegisters` | — | `AF,BC,DE,HL,IX,IY,SP,PC,AF2,BC2,DE2,HL2,I,R` (all integers) |
| `setRegisters` | any subset of register fields | `status:"ok"` |
| `setPC` | `address:N` | `status:"ok"` |
| `evaluate` | `expression:string` | `result:string` — hex value or `"?"` |

`evaluate` accepts: register names (`AF`, `PC`, …), memory reads (`(0x4000)`), label names (resolved from symbol table).

### Memory

| Command | Extra fields | Response fields |
|---------|-------------|----------------|
| `readMemory` / `getMemory` | `address:N`, `size:N` | `bytes:[…]` (array of integers 0–255) |
| `writeMemory` / `setMemory` | `address:N`, `bytes:[…]` | `status:"ok"` |
| `getMemBanks` | — | `banks:[{id,name,address,size}]` |

### Breakpoints

| Command | Extra fields | Response fields |
|---------|-------------|----------------|
| `setBreakpoint` | `address:N` | `status:"ok"` |
| `removeBreakpoint` | `address:N` | `status:"ok"` |
| `setBreakpoints` | `breakpoints:[{address:N},…]` | `status:"ok"` — **replaces all existing breakpoints** |

### Disassembly

| Command | Extra fields | Response fields |
|---------|-------------|----------------|
| `disassemble` | `address:N`, `count:N` | `instructions:[{address:N, hex:string, mnemonic:string}]` |

### Hardware state

| Command | Response fields |
|---------|----------------|
| `getCRTC` | `registers:[0..15]`, `type:N` |
| `getGA` / `getGateArray` | `palette:[0..15]`, `border:N`, `mode:N`, `romConfig:N`, `interruptCounter:N` |
| `getPSG` | `registers:[0..15]` |
| `getPPI` | `portA:N`, `portB:N`, `portC:N`, `control:N` |
| `getFDC` | `status:N`, `driveA:{track,sector,ready,motor}`, `driveB:{…}`, `track:[bytes]` |
| `getTape` | `motorOn:bool`, `counter:N`, `fileName:string`, `signal:[bytes]` |
| `subscribeScreen` | `status:"ok"` — server starts sending screen events |
| `unsubscribeScreen` | `status:"ok"` |

### Media

| Command | Extra fields | Response fields |
|---------|-------------|----------------|
| `insertDisk` | `path:string`, `drive:N` (0=A, 1=B) | `status:"ok"` or `error` |
| `insertTape` | `path:string` | `status:"ok"` or `error` |
| `loadSnapshot` | `path:string` | `status:"ok"` or `error` |
| `getSnapshot` | — | snapshot binary as base64 or path |

### Keyboard

| Command | Extra fields | Response fields |
|---------|-------------|----------------|
| `sendKey` | `line:N` (0–9), `bit:N` (0–7), `pressed:bool` | `status:"ok"` or `error:"invalid line/bit"` |

---

## Asynchronous events

The server sends these without a prior request. The client must handle them at any time.

```json
{"type": "event", "event": "break_", "pc": 16384}
```

| Event | Extra fields | Meaning |
|-------|-------------|---------|
| `break_` | `pc:N` | Emulator stopped (breakpoint, `ED FF`, or `halt`) |
| `mediaChanged` | `drive:N`, `path:string` | Disk inserted or ejected |

---

## Software breakpoint — `ED FF`

The Z80 opcode `ED FF` is not a standard instruction. SugarboxV2 intercepts it and immediately:

1. Pauses the CPU
2. Sends `{"type":"event","event":"break_","pc":N}` where N is the address of the `ED FF`

Use it in assembler source to insert unconditional breakpoints that work without the debugger having to set a hardware breakpoint:

```asm
    DB $ED, $FF    ; triggers break_ event
```

---

## Keyboard matrix

The CPC keyboard is a 10-row × 8-bit matrix. `line` selects the row (0–9), `bit` selects the column (0–7). Invalid values return `{"error":"invalid line"}` or `{"error":"invalid bit"}`.

---

## Conformance tests

A portable test suite is provided to verify any server implementation:

```bash
# Against a running server (no emulator needed):
python3 test_conformance.py --host 127.0.0.1 --port 1234

# Via pytest with SugarboxV2 launched automatically:
cd Sugarbox/debugers
pytest z80-debug-adapter/test_conformance.py -v --tb=short
```

To use the suite with another emulator, write a `conftest.py` that exposes a session-scoped `emulator` fixture yielding `[socket, socket.makefile("r")]`. See the source of `test_conformance.py` for details.
