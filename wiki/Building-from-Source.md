# Building from Source

## Prerequisites

| Tool | Minimum version |
|------|----------------|
| Node.js | 18 |
| npm | 9 |
| TypeScript | 5 (installed by `npm install`) |
| Python | 3.9 |
| vsce | latest (installed by `npm install`) |

## Clone

```bash
git clone https://github.com/Tom1975/amstrad-cpc-debug.git
cd amstrad-cpc-debug
```

If working inside SugarboxV2 as a submodule:

```bash
git clone https://github.com/Tom1975/SugarboxV2.git
cd SugarboxV2
git submodule update --init --recursive
cd Sugarbox/debugers/z80-debug-adapter
```

## Install dependencies

```bash
npm install
```

## Compile TypeScript

```bash
npm run compile
```

Output goes to `out/`. Errors appear inline — fix them before proceeding.

Watch mode (recompiles on save):

```bash
npm run watch
```

## Package the extension

```bash
python make_vsix.py
```

This script:
1. Runs webpack to bundle `out/main.js` → `dist/main.js`
2. Calls `vsce package` to produce `amstrad-cpc-debug-x.x.x.vsix`

The generated `.vsix` can be installed in VS Code via **Extensions: Install from VSIX…**

## Run unit tests (Jest)

```bash
npm test
```

Tests are in `test/` and cover `EmulatorClient` and the mock debug server. Jest is configured to exit after all tests even if TCP handles are still open (`--forceExit`).

## Run protocol conformance tests (pytest)

These tests start SugarboxV2, connect to the debug server, and verify the protocol.

```bash
pip install pytest

# From the SugarboxV2 root:
cd Sugarbox/debugers
SUGARBOX_BINARY=../../build/Sugarbox/Sugarbox \
pytest test_protocol.py z80-debug-adapter/test_conformance.py -v --tb=short
```

On Windows:

```powershell
$env:SUGARBOX_BINARY = "..\..\build\Sugarbox\Release\Sugarbox.exe"
python -m pytest test_protocol.py z80-debug-adapter/test_conformance.py -v --tb=short
```

The conformance tests can also run against any other server without SugarboxV2:

```bash
python3 z80-debug-adapter/test_conformance.py --host 127.0.0.1 --port 1234
```
