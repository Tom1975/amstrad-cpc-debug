# Virtual Keyboard

The virtual keyboard panel lets you send key presses to the CPC directly from VS Code, without clicking on the emulator window.

## Opening the panel

Command Palette (`Ctrl+Shift+P`) → **CPC: Show Keyboard Panel**

Or click the keyboard icon in the **CPC Hardware** sidebar.

## Modes

### Normal mode

- **Mouse down** on a key → key pressed
- **Mouse up / mouse leave** → key released

Use this mode to type normally or send brief key presses.

### Sticky mode

- **Click** a key → key held down (highlighted in orange)
- **Click again** → key released

Use this to hold modifier keys (Shift, Ctrl, …) while clicking other keys, or to keep a key pressed while returning to the source editor.

The **Release All** button releases all currently held keys at once.

## Keyboard layouts

Select the layout from the dropdown in the panel header:

| Value | Layout |
|-------|--------|
| `EN` | QWERTY (UK CPC 464/6128) |
| `FR` | AZERTY (French CPC) |
| `DE` | QWERTZ (German CPC) |
| `ES` | Spanish CPC |

Change the default layout in VS Code settings: **File → Preferences → Settings** → search `z80debug.keyboardLayout`.

## CPC keyboard matrix — reference

The CPC keyboard is a 10×8 matrix. Each key is identified by `(line, bit)`.

| Key | Line | Bit |
|-----|------|-----|
| Enter | 2 | 2 |
| Space | 5 | 7 |
| A | 5 | 0 |
| Z | 8 | 0 |
| 0 | 0 | 0 |
| 1 | 0 | 1 |
| Cursor Up | 0 | 0 |
| Cursor Down | 0 | 2 |
| Cursor Left | 1 | 0 |
| Cursor Right | 0 | 1 |
| Shift | 2 | 5 |
| Control | 2 | 4 |
| Del | 2 | 0 |
| Escape | 6 | 6 |
| Joy 1 Fire | 9 | 4 |

The full matrix (73 keys) is defined in `src/layouts.ts` in the extension source.

## Sending keys programmatically

Via the debug protocol, keys can also be sent with the `sendKey` command — see [Protocol Reference](Protocol-Reference#keyboard).
