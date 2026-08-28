# Hex Editor

The built-in hex editor displays any binary file with a format-aware overlay that annotates known structures in colour.

## Supported file types

| Extension | Format |
|-----------|--------|
| `.sna` | Amstrad CPC snapshot |
| `.dsk` | Disk image (standard and extended) |
| `.cdt` | Tape image |
| `.cpr` | Cartridge ROM |
| Any binary | Plain hex view (no overlay) |

## Opening a file

**Default:** double-clicking a `.sna`, `.dsk`, `.cdt`, or `.cpr` file in the VS Code Explorer opens it directly in the hex editor.

**Manual:** right-click any file → **Open With…** → **Z80 Debug Hex Editor**.

If the file opens in a text editor instead of the hex editor, check that the `onCustomEditor:z80debug.hexEditor` activation event is present (it is, in v0.0.3+). See [Troubleshooting](Troubleshooting#sna-opens-as-text).

## Layout

The view is divided into three columns:

```
Offset   Hex bytes (16 per row)                   ASCII
00000000 3F 00 00 00 AF 00 BC DE  HL 00 IX 00 00  ?..............
```

Click any byte to select it. The status bar shows the offset, decimal value, and the overlay annotation for that byte if one exists.

## Format overlays

Overlays highlight regions of the file with named colours and a legend at the bottom of the panel.

### `.sna` — Snapshot

| Colour | Region |
|--------|--------|
| Blue | Z80 registers (AF, BC, DE, HL, IX, IY, SP, PC, …) |
| Green | Memory dump (64 KB) |
| Orange | Interrupt mode, IFF flags |

### `.dsk` — Disk image

| Colour | Region |
|--------|--------|
| Purple | Disk Information Block header |
| Blue | Track Information Block headers |
| Green | Sector data |
| Red | GAP / fill bytes |

### `.cdt` — Tape image

| Colour | Region |
|--------|--------|
| Blue | Block header (ID, length) |
| Green | Program/data payload |
| Orange | Checksum bytes |

### `.cpr` — Cartridge

| Colour | Region |
|--------|--------|
| Blue | ROM block headers |
| Green | ROM data pages |

## Search

Press `Ctrl+F` inside the hex editor to open the search bar. Three modes:

| Mode | Input format | Example |
|------|-------------|---------|
| **Hex** | Space-separated hex bytes | `3A 00 40` |
| **ASCII** | Plain text | `HELLO` |
| **Text** | Case-insensitive ASCII | `hello` |

Results are highlighted in yellow. Use `Enter` / `Shift+Enter` to navigate between matches.
