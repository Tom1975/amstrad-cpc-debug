# Troubleshooting

## The emulator does not start

**Symptom:** F5 does nothing, or an error appears immediately in the Debug Console.

- Check that the `sugarbox` path in `launch.json` points to the actual binary. On Windows it ends in `.exe`.
- On macOS, the binary may need execute permission: `chmod +x /path/to/Sugarbox`.
- On Linux, verify that the required libraries are present: `ldd /path/to/Sugarbox | grep "not found"`.
- If `hideEmulator` is `false`, a window should appear briefly before VS Code connects. If it flashes and closes, run the binary manually from a terminal to see the error:
  ```bash
  /path/to/Sugarbox --hide -d --ds 1234
  ```

---

## "Connection refused" on the TCP port

**Symptom:** Debug Console shows `ECONNREFUSED 127.0.0.1:1234`.

- The emulator started but the debug server did not open in time. Increase startup timeout by adding `"timeout": 15000` (ms) to `launch.json` if the option is available, or check the emulator window/log for errors.
- Another process is using port 1234. Change the port in `launch.json` (`"port": 1235`) and restart.
- On Linux with xvfb (CI), the emulator needs a display: `xvfb-run -a ./Sugarbox …` — this is handled automatically by the CI workflow.

---

## Breakpoints set but never hit

- Verify that the address is within the code that actually runs (check the **Disassembly** view).
- If using label breakpoints, confirm the label exists in the symbol table (requires a `.rasm` super snapshot as `program`).
- `ED FF` breakpoints only fire when the CPU executes that address — not if you set a breakpoint there with F9.
- After inserting a disk and running a loader, the code at the target address may not be loaded yet. Set the breakpoint after the loader finishes.

---

## Screen panel shows a black image

- The screen panel requires `subscribeScreen` to be active. It is started automatically at session begin. If the panel was opened before a session, close and reopen it after F5.
- In `hideEmulator: true` mode, rendering still works but is computed headlessly — if the CPC is running a wait loop, no frame is produced. Step the CPU or use Continue.

---

<a name="sna-opens-as-text"></a>
## `.sna` file opens as a text editor, not the hex editor

VS Code only activates the custom editor when the extension is already active. If you open a `.sna` file before starting a debug session, the extension may not be active yet.

**Fix:** The extension registers `"onCustomEditor:z80debug.hexEditor"` as an activation event (v0.0.3+). If the issue persists after updating, manually trigger activation by pressing F5 once (even cancelling immediately), then reopen the file.

To set the hex editor as permanent default: right-click the `.sna` file → **Open With…** → select **Z80 Debug Hex Editor** → click **Configure Default Editor for '.sna'**.

---

## WSL / Remote-SSH

- The `sugarbox` path must be the path **inside** the remote environment (WSL or SSH host), not the Windows path.
- The extension runs inside the remote VS Code server, so `127.0.0.1:1234` refers to the remote host. No port forwarding is needed unless you run SugarboxV2 on the Windows side while VS Code is connected to WSL — in that case, use the Windows host IP (e.g. `172.x.x.x`) and set `"host": "172.x.x.x"` if the field is available, or use `localhost` with port forwarding configured in VS Code's **Ports** panel.
- On WSL, `git-credential-manager.exe` may fail when pushing. Use SSH remotes instead of HTTPS for the extension repository.

---

## macOS: "operation not permitted" on the binary

Gatekeeper may block the unsigned binary on first run.

```bash
xattr -d com.apple.quarantine /path/to/Sugarbox
chmod +x /path/to/Sugarbox
```

Or: open it once manually from Finder (right-click → Open → Open anyway), then use it from VS Code.
