export interface HexRegion {
    offset: number;
    length: number;
    name:   string;
    color:  string;
}

// Semi-transparent palette — works on both light and dark VS Code themes
const P = [
    "rgba(66,165,245,0.22)",   // blue
    "rgba(102,187,106,0.22)",  // green
    "rgba(255,167,38,0.22)",   // orange
    "rgba(236,64,122,0.22)",   // pink
    "rgba(171,71,188,0.22)",   // purple
    "rgba(38,198,218,0.22)",   // cyan
    "rgba(255,238,88,0.22)",   // yellow
    "rgba(239,83,80,0.22)",    // red
];

export function getRegions(filename: string, data: Uint8Array): HexRegion[] {
    const ext = filename.toLowerCase().split(".").pop() ?? "";
    try {
        switch (ext) {
            case "sna": return parseSna(data);
            case "dsk": return parseDsk(data);
            case "cpr": return parseCpr(data);
            case "cdt": return parseCdt(data);
        }
    } catch { /* malformed file — return empty */ }
    return [];
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function u16le(d: Uint8Array, o: number): number {
    return d[o] | (d[o + 1] << 8);
}
function u32le(d: Uint8Array, o: number): number {
    return (d[o] | (d[o+1]<<8) | (d[o+2]<<16) | (d[o+3]<<24)) >>> 0;
}
function str(d: Uint8Array, o: number, n: number): string {
    return String.fromCharCode(...d.slice(o, o + n));
}

// ── SNA ───────────────────────────────────────────────────────────────────────

function parseSna(data: Uint8Array): HexRegion[] {
    if (data.length < 27) return [];
    const regions: HexRegion[] = [
        { offset: 0, length: 27, name: "En-tête Z80 (registres)", color: P[0] }
    ];
    const banks = [
        "RAM 0x0000–0x3FFF", "RAM 0x4000–0x7FFF",
        "RAM 0x8000–0xBFFF", "RAM 0xC000–0xFFFF"
    ];
    for (let i = 0; i < 4; i++) {
        const off = 27 + i * 0x4000;
        if (off >= data.length) break;
        regions.push({
            offset: off,
            length: Math.min(0x4000, data.length - off),
            name:   banks[i],
            color:  P[1 + (i % 2)]
        });
    }
    // Extended header / extra RAM (128K SNA)
    const extOff = 27 + 0x10000;
    if (data.length > extOff) {
        regions.push({
            offset: extOff,
            length: data.length - extOff,
            name:   "En-tête étendu / RAM sup.",
            color:  P[3]
        });
    }
    return regions;
}

// ── DSK ───────────────────────────────────────────────────────────────────────

function parseDsk(data: Uint8Array): HexRegion[] {
    if (data.length < 256) return [];
    const sig = str(data, 0, 8);
    const isExt = sig.startsWith("EXTENDED");
    const isStd = sig.startsWith("MV - CPC") || sig.startsWith("DISK");
    if (!isStd && !isExt) return [];

    const regions: HexRegion[] = [
        { offset: 0, length: 256, name: "Disk Info Block", color: P[0] }
    ];
    const numTracks = data[0x30];
    const numSides  = data[0x31];
    const stdSize   = isStd ? u16le(data, 0x32) : 0;

    let pos = 256;
    for (let t = 0; t < numTracks * numSides && pos < data.length; t++) {
        const trackSize = isExt ? data[0x34 + t] * 256 : stdSize;
        if (trackSize === 0) continue;
        const len = Math.min(trackSize, data.length - pos);
        regions.push({
            offset: pos,
            length: len,
            name:   `Piste ${Math.floor(t / numSides)} / Côté ${t % numSides}`,
            color:  P[1 + (t % (P.length - 1))]
        });
        pos += trackSize;
    }
    return regions;
}

// ── CPR ───────────────────────────────────────────────────────────────────────

function parseCpr(data: Uint8Array): HexRegion[] {
    if (data.length < 12) return [];
    if (str(data, 0, 4) !== "RIFF" || str(data, 8, 4) !== "AMS!") return [];

    const regions: HexRegion[] = [
        { offset: 0, length: 12, name: "En-tête RIFF (AMS!)", color: P[0] }
    ];
    let pos = 12, ci = 1;
    while (pos + 8 <= data.length) {
        const id    = str(data, pos, 4);
        const size  = u32le(data, pos + 4);
        const total = 8 + size + (size & 1); // pad to even
        if (total === 0) break;
        regions.push({
            offset: pos,
            length: Math.min(total, data.length - pos),
            name:   `Chunk "${id}" (${size} octets)`,
            color:  P[ci % P.length]
        });
        ci++;
        pos += total;
    }
    return regions;
}

// ── CDT ───────────────────────────────────────────────────────────────────────

function parseCdt(data: Uint8Array): HexRegion[] {
    const regions: HexRegion[] = [];
    let pos = 0;

    // Optional TZX/CDT header
    if (data.length >= 10 && str(data, 0, 7) === "ZXTape!") {
        regions.push({ offset: 0, length: 10, name: "En-tête CDT/TZX", color: P[0] });
        pos = 10;
    }

    let bi = 0;
    while (pos < data.length) {
        const id = data[pos];
        let len = 0;
        let name = `Bloc 0x${id.toString(16).toUpperCase().padStart(2, "0")}`;

        switch (id) {
            case 0x10: // Standard Speed Data
                if (pos + 5 > data.length) { pos++; continue; }
                len = 5 + u16le(data, pos + 3);
                name = "Données standard";
                break;
            case 0x11: // Turbo Speed Data
                if (pos + 19 > data.length) { pos++; continue; }
                len = 19 + (data[pos+16] | (data[pos+17]<<8) | (data[pos+18]<<16));
                name = "Données turbo";
                break;
            case 0x12: len = 5;  name = "Ton pur"; break;
            case 0x13: // Pulse Sequence
                if (pos + 2 > data.length) { pos++; continue; }
                len = 2 + data[pos+1] * 2;
                name = "Séquence impulsions";
                break;
            case 0x14: // Pure Data
                if (pos + 11 > data.length) { pos++; continue; }
                len = 11 + (data[pos+8] | (data[pos+9]<<8) | (data[pos+10]<<16));
                name = "Données pures";
                break;
            case 0x20: len = 3; name = "Pause"; break;
            case 0x21: // Group Start
                if (pos + 2 > data.length) { pos++; continue; }
                len = 2 + data[pos+1];
                name = "Début groupe";
                break;
            case 0x22: len = 1; name = "Fin groupe"; break;
            case 0x30: // Text Description
                if (pos + 2 > data.length) { pos++; continue; }
                len = 2 + data[pos+1];
                name = "Description";
                break;
            case 0x32: // Archive Info
                if (pos + 3 > data.length) { pos++; continue; }
                len = 3 + u16le(data, pos + 1);
                name = "Infos archive";
                break;
            case 0x35: // Custom Info
                if (pos + 21 > data.length) { pos++; continue; }
                len = 21 + u32le(data, pos + 17);
                name = "Infos personnalisées";
                break;
            case 0x5A: len = 10; name = "Bloc colle (Glue)"; break;
            default:   len = 1; break; // unknown — advance 1 byte
        }

        if (len <= 0) { pos++; continue; }
        regions.push({
            offset: pos,
            length: Math.min(len, data.length - pos),
            name,
            color: P[(bi + 1) % P.length]
        });
        bi++;
        pos += len;
    }
    return regions;
}
