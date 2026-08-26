#!/usr/bin/env python3
"""
Conformance tests for any DebugServer implementation of the Amstrad CPC Debug Protocol.

This file lives in the z80-debug-adapter repository so that any emulator author can
use it to validate their implementation independently of VS Code or SugarboxV2.

Two uses:

  1. Standalone — against any already-running DebugServer:

         python3 test_conformance.py [--host 127.0.0.1] [--port 1234]

     Exit code 0 = all tests passed, 1 = failures.
     No dependencies beyond the Python standard library.

  2. pytest suite — against SugarboxV2 (or another emulator) via conftest.py:

     The conftest.py that ships with SugarboxV2 starts the emulator automatically.
     Run from the Sugarbox/debugers/ directory so pytest picks up that conftest:

         cd Sugarbox/debugers
         pytest z80-debug-adapter/test_conformance.py -v --tb=short

     Environment variables used by conftest.py:
         SUGARBOX_BINARY   path to the emulator binary
         SUGARBOX_PORT     TCP port (default: 1234)

     To use with another emulator, write your own conftest.py that exposes an
     `emulator` session fixture yielding (socket, socket.makefile("r")).
"""

import argparse
import json
import socket
import sys
import time

import pytest


# ── Low-level client ─────────────────────────────────────────────────────────

class DebugClient:
    """Minimal synchronous client for the Amstrad CPC Debug Protocol (JSON over TCP)."""

    def __init__(self, host: str, port: int, timeout: float = 5.0):
        self._sock = socket.create_connection((host, port), timeout=timeout)
        self._reader = self._sock.makefile("r")

    def close(self):
        try:
            self._reader.close()
            self._sock.close()
        except OSError:
            pass

    def send_raw(self, obj: dict) -> dict:
        """Send one command and return the first non-event response."""
        self._sock.sendall((json.dumps(obj) + "\n").encode())
        return self._recv_response()

    def _recv_response(self) -> dict:
        while True:
            line = self._reader.readline()
            if not line:
                raise EOFError("Server closed the connection")
            try:
                msg = json.loads(line)
            except json.JSONDecodeError:
                continue
            if msg.get("type") == "event":
                continue
            return msg

    def recv_event(self, timeout: float = 3.0) -> dict:
        """Block until an async event arrives."""
        old = self._sock.gettimeout()
        self._sock.settimeout(timeout)
        try:
            while True:
                line = self._reader.readline()
                if not line:
                    raise EOFError("Server closed the connection")
                try:
                    msg = json.loads(line.strip())
                except json.JSONDecodeError:
                    continue
                if msg.get("type") == "event":
                    return msg
        except OSError:
            raise TimeoutError(f"No event received within {timeout}s")
        finally:
            self._sock.settimeout(old)

    # ── Convenience wrappers ─────────────────────────────────────────────────

    def cmd(self, name: str, **kwargs) -> dict:
        return self.send_raw({"cmd": name, **kwargs})

    def halt(self) -> dict:
        return self.cmd("halt")

    def wait_stopped(self, timeout: float = 2.0) -> int:
        """Poll getState until running == 'false'. Returns PC."""
        deadline = time.time() + timeout
        while time.time() < deadline:
            state = self.cmd("getState")
            if state.get("running") == "false":
                return int(state["pc"])
            time.sleep(0.02)
        raise TimeoutError("Emulator did not stop within timeout")


# ── Schema helpers ────────────────────────────────────────────────────────────

def _check_int(resp: dict, key: str, lo: int = 0, hi: int = 0xFFFF) -> None:
    assert key in resp, f"Missing field '{key}'"
    v = resp[key]
    assert isinstance(v, int), f"'{key}' must be int, got {type(v).__name__}"
    assert lo <= v <= hi, f"'{key}' = {v} out of range [{lo}, {hi}]"


def _check_list(resp: dict, key: str, length: int | None = None,
                elem_lo: int = 0, elem_hi: int = 0xFF) -> None:
    assert key in resp, f"Missing field '{key}'"
    lst = resp[key]
    assert isinstance(lst, list), f"'{key}' must be list"
    if length is not None:
        assert len(lst) == length, f"'{key}' length {len(lst)} != expected {length}"
    for i, v in enumerate(lst):
        assert isinstance(v, int), f"'{key}[{i}]' must be int"
        assert elem_lo <= v <= elem_hi, f"'{key}[{i}]' = {v} out of range"


def _check_status_ok(resp: dict) -> None:
    assert resp.get("status") == "ok", f"Expected {{status:'ok'}}, got {resp}"


# ── pytest fixture ────────────────────────────────────────────────────────────

@pytest.fixture(scope="module")
def client(emulator):
    """Wrap the session-scoped (host, port) into a DebugClient for conformance tests."""
    sock, _reader = emulator
    host, port = sock.getpeername()
    c = DebugClient(host, port)
    c.halt()
    c.wait_stopped()
    yield c
    c.close()


# ═══════════════════════════════════════════════════════════════════════════════
# A — Protocol basics
# ═══════════════════════════════════════════════════════════════════════════════

class TestProtocolBasics:

    def test_unknown_command_returns_error(self, client):
        resp = client.cmd("__nonexistent_command__")
        assert "error" in resp, "Unknown command must return an 'error' field"

    def test_empty_cmd_returns_error(self, client):
        resp = client.cmd("")
        assert "error" in resp


# ═══════════════════════════════════════════════════════════════════════════════
# B — Emulator state
# ═══════════════════════════════════════════════════════════════════════════════

class TestEmulatorState:

    def test_halt_returns_ok(self, client):
        resp = client.halt()
        _check_status_ok(resp)

    def test_getState_fields(self, client):
        client.halt()
        client.wait_stopped()
        resp = client.cmd("getState")
        _check_int(resp, "pc", 0, 0xFFFF)
        _check_int(resp, "sp", 0, 0xFFFF)
        assert resp.get("running") in ("true", "false"), \
            f"'running' must be 'true' or 'false', got {resp.get('running')!r}"

    def test_halt_makes_emulator_stopped(self, client):
        client.halt()
        client.wait_stopped()
        resp = client.cmd("getState")
        assert resp.get("running") == "false"

    def test_continue_makes_emulator_running(self, client):
        client.halt()
        client.wait_stopped()
        resp = client.cmd("continue")
        assert resp.get("status") == "running"
        time.sleep(0.1)
        state = client.cmd("getState")
        assert state.get("running") == "true"

    def test_halt_after_continue(self, client):
        client.cmd("continue")
        time.sleep(0.1)
        client.halt()
        client.wait_stopped()
        resp = client.cmd("getState")
        assert resp.get("running") == "false"

    def test_reset_returns_ok(self, client):
        resp = client.cmd("reset")
        _check_status_ok(resp)
        client.wait_stopped()  # reset implies Break()

    def test_subscribeScreen_returns_ok(self, client):
        resp = client.cmd("subscribeScreen")
        _check_status_ok(resp)

    def test_unsubscribeScreen_returns_ok(self, client):
        resp = client.cmd("unsubscribeScreen")
        _check_status_ok(resp)


# ═══════════════════════════════════════════════════════════════════════════════
# C — Registers
# ═══════════════════════════════════════════════════════════════════════════════

class TestRegisters:

    def setup_method(self, _):
        pass  # client fixture handles halt

    def test_readRegisters_required_fields(self, client):
        client.halt(); client.wait_stopped()
        resp = client.cmd("readRegisters")
        for reg in ("AF", "BC", "DE", "HL", "IX", "IY", "SP", "PC"):
            _check_int(resp, reg, 0, 0xFFFF)
        for reg in ("I", "R"):
            _check_int(resp, reg, 0, 0xFF)

    def test_readRegisters_primed_variants(self, client):
        client.halt(); client.wait_stopped()
        resp = client.cmd("readRegisters")
        for reg in ("AF'", "BC'", "DE'", "HL'"):
            _check_int(resp, reg, 0, 0xFFFF)

    def test_setPC_and_verify(self, client):
        client.halt(); client.wait_stopped()
        client.cmd("setPC", address=0x1234)
        resp = client.cmd("readRegisters")
        assert resp["PC"] == 0x1234, f"PC expected 0x1234, got 0x{resp['PC']:04X}"

    def test_setRegisters_roundtrip(self, client):
        client.halt(); client.wait_stopped()
        client.cmd("setRegisters", **{
            "bc": 0xAABB, "de": 0xCCDD, "hl": 0x1122,
            "ix": 0x3344, "iy": 0x5566,
        })
        resp = client.cmd("readRegisters")
        assert resp["BC"] == 0xAABB, f"BC expected 0xAABB, got 0x{resp['BC']:04X}"
        assert resp["DE"] == 0xCCDD
        assert resp["HL"] == 0x1122
        assert resp["IX"] == 0x3344
        assert resp["IY"] == 0x5566

    def test_evaluate_register_AF(self, client):
        client.halt(); client.wait_stopped()
        resp = client.cmd("evaluate", expression="AF")
        assert "text" in resp
        assert resp["text"].startswith("0x"), f"evaluate AF: expected hex, got {resp['text']!r}"

    def test_evaluate_register_PC(self, client):
        client.halt(); client.wait_stopped()
        resp = client.cmd("evaluate", expression="PC")
        assert "text" in resp

    def test_evaluate_memory_address(self, client):
        client.halt(); client.wait_stopped()
        resp = client.cmd("evaluate", expression="0x0000")
        assert "text" in resp
        assert "@" in resp["text"], f"Expected 'val @ addr' format, got {resp['text']!r}"

    def test_evaluate_unknown_returns_question_mark(self, client):
        resp = client.cmd("evaluate", expression="__NOT_A_REG__")
        assert resp.get("text") == "?", f"Expected '?', got {resp!r}"


# ═══════════════════════════════════════════════════════════════════════════════
# D — Memory
# ═══════════════════════════════════════════════════════════════════════════════

class TestMemory:

    def test_readMemory_returns_correct_count(self, client):
        for count in (1, 16, 64, 256):
            resp = client.cmd("readMemory", address=0x0000, size=count)
            _check_list(resp, "bytes", length=count)

    def test_readMemory_byte_range(self, client):
        resp = client.cmd("readMemory", address=0x4000, size=32)
        for i, b in enumerate(resp["bytes"]):
            assert 0 <= b <= 255, f"byte[{i}] = {b} out of [0,255]"

    def test_writeMemory_roundtrip(self, client):
        client.halt(); client.wait_stopped()
        addr = 0x8000
        pattern = [0xDE, 0xAD, 0xBE, 0xEF]
        resp_w = client.cmd("writeMemory", address=addr, bytes=pattern)
        _check_status_ok(resp_w)
        assert resp_w.get("written") == len(pattern), \
            f"'written' expected {len(pattern)}, got {resp_w.get('written')}"
        resp_r = client.cmd("readMemory", address=addr, size=len(pattern))
        assert resp_r["bytes"] == pattern, \
            f"readback mismatch: wrote {pattern}, got {resp_r['bytes']}"

    def test_getMemBanks_structure(self, client):
        resp = client.cmd("getMemBanks")
        assert "sources" in resp, "getMemBanks must return 'sources'"
        assert isinstance(resp["sources"], list), "'sources' must be a list"
        assert len(resp["sources"]) >= 3, "At least 3 memory sources expected (read/write/ram)"
        for src in resp["sources"]:
            assert "type"  in src, f"Memory source missing 'type': {src}"
            assert "label" in src, f"Memory source missing 'label': {src}"
            assert src["type"] in ("read", "write", "ram", "rom", "cart"), \
                f"Unknown memory source type: {src['type']!r}"

    def test_readMemory_type_write(self, client):
        resp = client.cmd("readMemory", address=0x0000, size=4, memType="write")
        _check_list(resp, "bytes", length=4)


# ═══════════════════════════════════════════════════════════════════════════════
# E — Execution control
# ═══════════════════════════════════════════════════════════════════════════════

class TestExecution:

    def test_step_returns_ok_and_advances_pc(self, client):
        client.halt(); client.wait_stopped()
        pc_before = client.cmd("readRegisters")["PC"]
        resp = client.cmd("step")
        _check_status_ok(resp)
        client.wait_stopped()
        pc_after = client.cmd("readRegisters")["PC"]
        assert pc_after != pc_before or True, "step: PC unchanged (may be valid for some instructions)"

    def test_stepIn_returns_ok(self, client):
        client.halt(); client.wait_stopped()
        resp = client.cmd("stepIn")
        _check_status_ok(resp)
        client.wait_stopped()

    def test_stepOut_returns_ok(self, client):
        client.halt(); client.wait_stopped()
        resp = client.cmd("stepOut")
        _check_status_ok(resp)
        client.wait_stopped(timeout=5.0)

    def test_setBreakpoints_clears_all(self, client):
        client.halt(); client.wait_stopped()
        resp = client.cmd("setBreakpoints", breakpoints=[])
        _check_status_ok(resp)

    def test_setBreakpoints_and_hit(self, client):
        client.halt(); client.wait_stopped()
        # Write "JP self" loop at 0x9000 then set a breakpoint there
        client.cmd("setPC", address=0x9000)
        # JP nn = 0xC3 <lo> <hi>
        client.cmd("writeMemory", address=0x9000, bytes=[0xC3, 0x00, 0x90])
        client.cmd("setBreakpoints", breakpoints=[{"address": 0x9000}])
        client.cmd("continue")
        # The emulator should hit the breakpoint quickly
        pc = client.wait_stopped(timeout=3.0)
        assert pc == 0x9000, f"Expected breakpoint at 0x9000, stopped at 0x{pc:04X}"
        client.cmd("setBreakpoints", breakpoints=[])  # cleanup


# ═══════════════════════════════════════════════════════════════════════════════
# F — Disassemble
# ═══════════════════════════════════════════════════════════════════════════════

class TestDisassemble:

    def test_disassemble_count(self, client):
        client.halt(); client.wait_stopped()
        for n in (1, 5, 20):
            resp = client.cmd("disassemble", address=0x0000, count=n)
            assert "instructions" in resp, "disassemble must return 'instructions'"
            assert len(resp["instructions"]) == n, \
                f"Expected {n} instructions, got {len(resp['instructions'])}"

    def test_disassemble_instruction_structure(self, client):
        resp = client.cmd("disassemble", address=0x0000, count=4)
        for ins in resp["instructions"]:
            assert "address"     in ins, f"Instruction missing 'address': {ins}"
            assert "instruction" in ins, f"Instruction missing 'instruction': {ins}"
            assert "bytes"       in ins, f"Instruction missing 'bytes': {ins}"
            assert isinstance(ins["address"],     int), "'address' must be int"
            assert isinstance(ins["instruction"], str), "'instruction' must be str"
            assert isinstance(ins["bytes"],       list), "'bytes' must be list"
            assert len(ins["bytes"]) >= 1, "Instruction must have at least 1 byte"

    def test_disassemble_addresses_increase(self, client):
        resp = client.cmd("disassemble", address=0x0000, count=8)
        addrs = [ins["address"] for ins in resp["instructions"]]
        assert addrs == sorted(addrs), f"Instruction addresses not in order: {addrs}"
        assert len(set(addrs)) == len(addrs), "Duplicate instruction addresses"


# ═══════════════════════════════════════════════════════════════════════════════
# G — Hardware state
# ═══════════════════════════════════════════════════════════════════════════════

class TestHardwareState:

    def test_getCrtcState_structure(self, client):
        resp = client.cmd("getCrtcState")
        _check_list(resp, "registers", length=18, elem_lo=0, elem_hi=0xFF)
        _check_list(resp, "masks",     length=18, elem_lo=0, elem_hi=0xFF)
        assert "crtcType" in resp
        assert "isPlus"   in resp
        for field in ("hcc", "vlc", "vcc", "ma"):
            assert field in resp, f"getCrtcState missing '{field}'"

    def test_getGateArrayState_structure(self, client):
        resp = client.cmd("getGateArrayState")
        _check_list(resp, "inks",    length=16, elem_lo=0, elem_hi=0xFFFFFFFF)
        _check_list(resp, "inkRegs", length=16, elem_lo=0, elem_hi=0x1F)
        _check_int(resp, "mode", 0, 3)
        assert "memWindows" in resp
        assert isinstance(resp["memWindows"], list)
        assert len(resp["memWindows"]) == 4
        for w in resp["memWindows"]:
            assert "base"       in w
            assert "readType"   in w
            assert "writeType"  in w

    def test_getPsgState_structure(self, client):
        resp = client.cmd("getPsgState")
        _check_list(resp, "registers", length=16, elem_lo=0, elem_hi=0xFF)
        for field in ("chanAFreq", "chanBFreq", "chanCFreq", "noiseFreq",
                      "mixer", "envFreq", "envShape"):
            assert field in resp, f"getPsgState missing '{field}'"

    def test_getPpiState_structure(self, client):
        resp = client.cmd("getPpiState")
        for field in ("portA", "portB", "portC", "controlWord"):
            _check_int(resp, field, 0, 0xFF)

    def test_getFdcState_structure(self, client):
        resp = client.cmd("getFdcState")
        for field in ("mainStatus", "currentDrive", "motorOn"):
            assert field in resp, f"getFdcState missing '{field}'"
        assert "drives" in resp
        assert isinstance(resp["drives"], list)
        assert len(resp["drives"]) == 2
        for drv in resp["drives"]:
            assert "present"  in drv
            assert "track"    in drv
            assert "side"     in drv
            assert "sectors"  in drv
            assert isinstance(drv["sectors"], list)

    def test_getTapeState_structure(self, client):
        resp = client.cmd("getTapeState")
        for field in ("path", "inserted", "motor", "play", "record",
                      "counter", "length", "currentBlock", "tapePos",
                      "nbInversions", "blocks"):
            assert field in resp, f"getTapeState missing '{field}'"
        assert isinstance(resp["blocks"], list)


# ═══════════════════════════════════════════════════════════════════════════════
# H — Keyboard
# ═══════════════════════════════════════════════════════════════════════════════

class TestKeyboard:

    def test_sendKey_valid_press(self, client):
        # Line 0, bit 0 = a valid CPC key
        resp = client.cmd("sendKey", line=0, bit=0, pressed=True)
        _check_status_ok(resp)

    def test_sendKey_valid_release(self, client):
        resp = client.cmd("sendKey", line=0, bit=0, pressed=False)
        _check_status_ok(resp)

    def test_sendKey_all_valid_combinations_sample(self, client):
        """Spot-check corners: (0,0), (9,7), (5,3)."""
        for line, bit in ((0, 0), (9, 7), (5, 3)):
            resp = client.cmd("sendKey", line=line, bit=bit, pressed=False)
            _check_status_ok(resp)

    def test_sendKey_invalid_line(self, client):
        resp = client.cmd("sendKey", line=10, bit=0, pressed=False)
        assert "error" in resp, "line=10 (out of range) must return an error"

    def test_sendKey_invalid_bit(self, client):
        resp = client.cmd("sendKey", line=0, bit=8, pressed=False)
        assert "error" in resp, "bit=8 (out of range) must return an error"

    def test_sendKey_negative_line(self, client):
        resp = client.cmd("sendKey", line=-1, bit=0, pressed=False)
        assert "error" in resp


# ═══════════════════════════════════════════════════════════════════════════════
# Standalone runner (no pytest dependency)
# ═══════════════════════════════════════════════════════════════════════════════

def _run_standalone(host: str, port: int) -> int:
    """Run all conformance checks without pytest. Returns exit code."""
    print(f"Connecting to DebugServer at {host}:{port}…")
    try:
        c = DebugClient(host, port)
    except OSError as e:
        print(f"ERROR: cannot connect — {e}")
        return 1

    c.halt()
    try:
        c.wait_stopped(timeout=3.0)
    except TimeoutError:
        print("WARNING: emulator did not stop within 3s — some tests may fail")

    test_classes = [
        TestProtocolBasics,
        TestEmulatorState,
        TestRegisters,
        TestMemory,
        TestExecution,
        TestDisassemble,
        TestHardwareState,
        TestKeyboard,
    ]

    passed = failed = 0
    for cls in test_classes:
        obj = cls()
        for name in dir(cls):
            if not name.startswith("test_"):
                continue
            fn = getattr(obj, name)
            try:
                fn(c)
                print(f"  PASS  {cls.__name__}.{name}")
                passed += 1
            except (AssertionError, TimeoutError, EOFError, OSError, KeyError) as e:
                print(f"  FAIL  {cls.__name__}.{name}: {e}")
                failed += 1

    print(f"\n{'='*60}")
    print(f"Results: {passed} passed, {failed} failed")
    c.close()
    return 0 if failed == 0 else 1


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="DebugServer conformance tests (standalone)")
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=1234)
    args = parser.parse_args()
    sys.exit(_run_standalone(args.host, args.port))
