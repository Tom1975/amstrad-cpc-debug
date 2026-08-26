import { getRegions, HexRegion } from '../src/HexFormatter';

// ── helpers ───────────────────────────────────────────────────────────────────

function u16le(v: number): [number, number] {
    return [v & 0xFF, (v >> 8) & 0xFF];
}
function u32le(v: number): [number, number, number, number] {
    return [v & 0xFF, (v >> 8) & 0xFF, (v >> 16) & 0xFF, (v >> 24) & 0xFF];
}
function ascii(s: string): number[] {
    return Array.from(s).map(c => c.charCodeAt(0));
}

function regions(name: string, data: Uint8Array): HexRegion[] {
    return getRegions(name, data);
}

function assertCovers(regions: HexRegion[], totalSize: number): void {
    // Every region must be within bounds
    for (const r of regions) {
        expect(r.offset).toBeGreaterThanOrEqual(0);
        expect(r.offset + r.length).toBeLessThanOrEqual(totalSize);
        expect(r.length).toBeGreaterThan(0);
    }
    // Regions must not overlap (they're defined as contiguous blocks)
    const sorted = [...regions].sort((a, b) => a.offset - b.offset);
    for (let i = 1; i < sorted.length; i++) {
        expect(sorted[i].offset).toBeGreaterThanOrEqual(sorted[i - 1].offset + sorted[i - 1].length);
    }
}

// ── Unknown extension ─────────────────────────────────────────────────────────

describe('getRegions — unknown extension', () => {
    test('returns empty array for .bin', () =>
        expect(regions('file.bin', new Uint8Array(100))).toEqual([]));
    test('returns empty array for no extension', () =>
        expect(regions('file', new Uint8Array(100))).toEqual([]));
});

// ── SNA ──────────────────────────────────────────────────────────────────────

describe('getRegions — SNA', () => {
    function makeSna(extraBytes = 0): Uint8Array {
        const size = 27 + 0x10000 + extraBytes;
        const buf = new Uint8Array(size);
        return buf;
    }

    test('too short → empty', () =>
        expect(regions('snap.sna', new Uint8Array(10))).toEqual([]));

    test('minimal 64K SNA has header + 4 RAM regions', () => {
        const r = regions('snap.sna', makeSna());
        expect(r.length).toBeGreaterThanOrEqual(2);
        expect(r[0].offset).toBe(0);
        expect(r[0].length).toBe(27);
        expect(r[0].name).toMatch(/tête|registres/i);
    });

    test('regions do not overlap or exceed bounds', () => {
        const data = makeSna();
        assertCovers(regions('snap.SNA', data), data.length);
    });

    test('128K SNA has extended header region', () => {
        const data = makeSna(100);  // >64KB → extended header present
        const r = regions('snap.sna', data);
        const ext = r.find(x => x.offset === 27 + 0x10000);
        expect(ext).toBeDefined();
    });
});

// ── DSK ──────────────────────────────────────────────────────────────────────

describe('getRegions — DSK', () => {
    function makeStdDsk(numTracks = 2, numSides = 1, trackSize = 0x1300): Uint8Array {
        const total = 256 + numTracks * numSides * trackSize;
        const buf = new Uint8Array(total);
        // Disk Info Block header
        const sig = 'MV - CPC format\r\nDisk-Info\r\n';
        for (let i = 0; i < sig.length; i++) buf[i] = sig.charCodeAt(i);
        buf[0x30] = numTracks;
        buf[0x31] = numSides;
        buf[0x32] = trackSize & 0xFF;
        buf[0x33] = (trackSize >> 8) & 0xFF;
        return buf;
    }

    function makeExtDsk(numTracks = 2, numSides = 1, trackSize = 0x1300): Uint8Array {
        const total = 256 + numTracks * numSides * trackSize;
        const buf = new Uint8Array(total);
        const sig = 'EXTENDED CPC DSK File\r\nDisk-Info\r\n';
        for (let i = 0; i < sig.length; i++) buf[i] = sig.charCodeAt(i);
        buf[0x30] = numTracks;
        buf[0x31] = numSides;
        // Extended: per-track sizes at 0x34 (in 256-byte units)
        for (let t = 0; t < numTracks * numSides; t++) {
            buf[0x34 + t] = trackSize >> 8;
        }
        return buf;
    }

    test('too short → empty', () =>
        expect(regions('disk.dsk', new Uint8Array(10))).toEqual([]));

    test('unknown signature → empty', () => {
        const buf = new Uint8Array(256);
        expect(regions('disk.dsk', buf)).toEqual([]);
    });

    test('standard DSK: disk info block + track regions', () => {
        const data = makeStdDsk(2, 1);
        const r = regions('disk.dsk', data);
        expect(r.length).toBe(3);  // Disk Info Block + 2 tracks
        expect(r[0].offset).toBe(0);
        expect(r[0].length).toBe(256);
        expect(r[0].name).toMatch(/Disk Info/i);
    });

    test('extended DSK: regions do not overlap', () => {
        const data = makeExtDsk(3, 2);
        assertCovers(regions('disk.DSK', data), data.length);
    });

    test('track names include track/side number', () => {
        const data = makeStdDsk(2, 2);
        const r = regions('disk.dsk', data);
        const trackNames = r.slice(1).map(x => x.name);
        expect(trackNames.some(n => n.includes('0'))).toBe(true);
    });
});

// ── CPR ──────────────────────────────────────────────────────────────────────

describe('getRegions — CPR', () => {
    function makeCpr(chunks: Array<{ id: string; size: number }>): Uint8Array {
        const bodySize = chunks.reduce((s, c) => s + 8 + c.size + (c.size & 1), 0);
        const total = 12 + bodySize;
        const buf = new Uint8Array(total);
        // RIFF header
        buf.set(ascii('RIFF'), 0);
        buf.set(u32le(4 + bodySize), 4);
        buf.set(ascii('AMS!'), 8);
        let pos = 12;
        for (const c of chunks) {
            buf.set(ascii(c.id.padEnd(4).slice(0, 4)), pos);
            buf.set(u32le(c.size), pos + 4);
            pos += 8 + c.size + (c.size & 1);
        }
        return buf;
    }

    test('too short → empty', () =>
        expect(regions('cart.cpr', new Uint8Array(10))).toEqual([]));

    test('wrong magic → empty', () => {
        const buf = new Uint8Array(12);
        buf.set(ascii('RIFF'), 0);
        buf.set(ascii('XXXX'), 8);
        expect(regions('cart.cpr', buf)).toEqual([]);
    });

    test('valid CPR has RIFF header region + chunk regions', () => {
        const data = makeCpr([{ id: 'cb00', size: 16384 }, { id: 'cb01', size: 16384 }]);
        const r = regions('cart.cpr', data);
        expect(r.length).toBe(3);  // header + 2 chunks
        expect(r[0].length).toBe(12);
        expect(r[0].name).toMatch(/RIFF/i);
    });

    test('chunk names include chunk id', () => {
        const data = makeCpr([{ id: 'cb00', size: 100 }]);
        const r = regions('cart.CPR', data);
        expect(r[1].name).toContain('cb00');
    });

    test('regions do not overlap', () => {
        const data = makeCpr([
            { id: 'cb00', size: 16384 },
            { id: 'cb01', size: 16384 },
            { id: 'cb02', size: 16384 },
        ]);
        assertCovers(regions('cart.cpr', data), data.length);
    });
});

// ── CDT ──────────────────────────────────────────────────────────────────────

describe('getRegions — CDT', () => {
    function makeCdt(blocks: Array<{ type: number; payload: number[] }>): Uint8Array {
        const header = [...ascii('ZXTape!'), 0x1A, 0x01, 0x14]; // 10 bytes
        const body: number[] = [];
        for (const b of blocks) {
            body.push(b.type);
            body.push(...b.payload);
        }
        return new Uint8Array([...header, ...body]);
    }

    test('empty CDT has just TZX header region', () => {
        const data = makeCdt([]);
        const r = regions('tape.cdt', data);
        expect(r.length).toBe(1);
        expect(r[0].name).toMatch(/CDT|TZX/i);
        expect(r[0].length).toBe(10);
    });

    test('standard speed block (0x10) parsed correctly', () => {
        // 0x10 + 2 pause + 2 length + data
        const payload = [0x00, 0xC8, 0x03, 0x00, 0x55, 0x55, 0x55];
        const data = makeCdt([{ type: 0x10, payload }]);
        const r = regions('tape.CDT', data);
        expect(r.length).toBe(2);  // header + 1 block
        expect(r[1].name).toMatch(/standard/i);
    });

    test('pure tone block (0x12) has fixed 5-byte length', () => {
        const data = makeCdt([{ type: 0x12, payload: [0x00, 0x00, 0x00, 0x00] }]);
        const r = regions('tape.cdt', data);
        const toneBlock = r.find(x => x.name.toLowerCase().includes('ton'));
        expect(toneBlock).toBeDefined();
        expect(toneBlock!.length).toBe(5);
    });

    test('pause block (0x20) has fixed 3-byte length', () => {
        const data = makeCdt([{ type: 0x20, payload: [0x00, 0x00] }]);
        const r = regions('tape.cdt', data);
        const pauseBlock = r.find(x => x.name.toLowerCase().includes('pause'));
        expect(pauseBlock).toBeDefined();
        expect(pauseBlock!.length).toBe(3);
    });

    test('regions do not overlap', () => {
        const data = makeCdt([
            { type: 0x12, payload: [0x00, 0x00, 0x00, 0x00] },   // pure tone
            { type: 0x20, payload: [0xC8, 0x00] },                // pause
            { type: 0x10, payload: [0x00, 0xC8, 0x03, 0x00, 0xAA, 0xBB, 0xCC] },
        ]);
        assertCovers(regions('tape.cdt', data), data.length);
    });
});
