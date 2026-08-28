# Configuration

## `launch.json` reference

All fields go under a configuration of type `"z80debug"`.

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `type` | string | — | Must be `"z80debug"` |
| `request` | string | — | Must be `"launch"` |
| `name` | string | — | Label shown in the debug dropdown |
| `sugarbox` | string | — | **Required.** Path to the SugarboxV2 binary |
| `program` | string | `""` | Snapshot (`.sna`) to load at startup |
| `disk` | string[] | `[]` | Disk images to insert; index 0 = drive A, index 1 = drive B |
| `tape` | string | `""` | Tape file (`.cdt`, `.wav`) to insert |
| `cfg` | string | `"CPC6128FR"` | Machine configuration name (see list below) |
| `hideEmulator` | boolean | `false` | Hide the emulator window (headless mode) |
| `port` | number | `1234` | TCP port of the debug server |

### Full example

```json
{
  "version": "0.2.0",
  "configurations": [
    {
      "type": "z80debug",
      "request": "launch",
      "name": "CPC 6128 — Game",
      "sugarbox": "${env:HOME}/bin/Sugarbox",
      "program": "${workspaceFolder}/build/game.sna",
      "disk": ["${workspaceFolder}/build/game.dsk"],
      "cfg": "CPC6128FR",
      "hideEmulator": false,
      "port": 1234
    }
  ]
}
```

## Machine configurations

The `cfg` field selects which CPC hardware model to emulate. Available values (filename without `.cfg`):

| Value | Model |
|-------|-------|
| `CPC464FR` | CPC 464 — French keyboard |
| `CPC464UK` | CPC 464 — UK keyboard |
| `CPC464DE` | CPC 464 — German keyboard |
| `CPC464SP` | CPC 464 — Spanish keyboard |
| `CPC464FRDDI1` | CPC 464 FR + DDI-1 disk drive |
| `CPC464FRDDI1128KO` | CPC 464 FR + DDI-1 + 128 KB RAM |
| `CPC6128FR` | CPC 6128 — French keyboard |
| `CPC6128UK` | CPC 6128 — UK keyboard |
| `CPC6128DE` | CPC 6128 — German keyboard |
| `CPC6128FRCRTC0` | CPC 6128 FR with CRTC type 0 |
| `CPC6128FRCRTC1` | CPC 6128 FR with CRTC type 1 |
| `CPC6128FRBONNYDOS` | CPC 6128 FR with Bonny DOS ROM |

Additional configurations (`.cfg` files) are shipped with SugarboxV2 in its `CONF/` directory and can be used directly by name.

## Quick Launch

Quick Launch lets you start a debug session without a `launch.json`.

1. Open the Command Palette (`Ctrl+Shift+P`) → **CPC: Quick Launch**.
2. Fill in the snapshot/disk/tape paths in the panel that opens.
3. Click **Launch** — the session starts immediately.

Settings are persisted in VS Code workspace state and reused on the next launch.
