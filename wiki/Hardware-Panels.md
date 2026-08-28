# Hardware Panels

Each panel opens as a VS Code webview and refreshes automatically when the emulator is paused (after a step or breakpoint). Use the **Refresh** button inside any panel to update while running.

Open panels from the **CPC Hardware** sidebar (activity bar icon) or via the Command Palette (`Ctrl+Shift+P` → `CPC: Show …`).

---

## CRTC / ASIC

**Command:** `CPC: Show CRTC Panel`

Displays the 6845 CRTC registers (R0–R15) and derived timing values (horizontal/vertical total, sync widths, display start address).

### CPC+ / ASIC mode

When a CPC+ configuration is loaded, the panel switches to ASIC mode and adds:

- **Sprites** — 16 hardware sprites (16×16 px each), rendered on a canvas with their current pixel data and (x, y) positions
- **Palette** — 32-colour ASIC palette (vs 16 colours on standard CPC), shown as colour swatches with index and hex value
- **DMA channels** — 3 DMA channels with address, prescaler, loop count, and pause registers
- **Soft scroll** — split-screen register and fine-scroll values

---

## Gate Array

**Command:** `CPC: Show Gate Array Panel`

| Section | Content |
|---------|---------|
| Mode | Current screen mode (0 / 1 / 2) |
| Palette | 16 pen colours + border, shown as swatches with hardware colour index |
| ROM banking | Upper ROM select, lower ROM enable |
| Interrupt | Interrupt counter and line counter |

---

## PSG — AY-3-8912

**Command:** `CPC: Show PSG Panel`

All 16 AY-3-8912 registers in a table: tone period (A/B/C), noise period, mixer flags, amplitude (A/B/C), envelope period, and envelope shape. Channel output levels are shown as a simple bar meter.

---

## PPI — 8255

**Command:** `CPC: Show PPI Panel`

Ports A, B, and C with their current byte values in hex and binary, plus the control word. Port A carries the PSG data bus; port B carries the keyboard row, cassette input, and printer busy; port C selects the keyboard line and controls sound/cassette motor.

---

## FDC — µPD765

**Command:** `CPC: Show FDC Panel`

- Drive status for drives A and B (motor, ready, track, sector)
- FDC main status register
- **Raw Track Viewer** — MFM bit stream of the current track rendered as a hex dump with sector header and data block annotations. Useful for copy-protection analysis.

When no disk is inserted, the Raw Track Viewer shows a "No disk" placeholder.

---

## Tape

**Command:** `CPC: Show Tape Panel`

- Tape file name and format
- Motor state (on/off) and tape counter (position in seconds)
- Block list with type, name, and length for `.cdt` files
- **Signal viewer** — oscilloscope-style rendering of the tape signal waveform around the current read head position (square wave approximation)
