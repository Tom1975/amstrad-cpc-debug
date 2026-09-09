import * as vscode from "vscode";
import * as nodePath from "path";
import * as fs from "fs";
import * as zlib from "zlib";
import { ResourceIndex } from "./ResourceIndex";

// ── Palette hardware CPC (27 couleurs) ───────────────────────────────────────
const CPC_HW_COLORS: [number, number, number][] = [
    [0,0,0],[0,0,128],[0,0,255],[128,0,0],[128,0,128],[128,0,255],
    [255,0,0],[255,0,128],[255,0,255],[0,128,0],[0,128,128],[0,128,255],
    [128,128,0],[128,128,128],[128,128,255],[255,128,0],[255,128,128],
    [255,128,255],[0,255,0],[0,255,128],[0,255,255],[128,255,0],
    [128,255,128],[128,255,255],[255,255,0],[255,255,128],[255,255,255],
];

// Palette firmware mode 0 (index ink → index couleur hardware)
const FIRMWARE_PALETTE = [1, 24, 20, 6, 26, 0, 2, 8, 10, 12, 14, 16, 18, 22, 24, 13];

// ── Décodage SCR (formules exactes de GateArray.cpp) ─────────────────────────
function decodeMode0(b: number): [number, number] {
    const p0 = ((b & 0x80) ? 1 : 0) | ((b & 0x08) ? 2 : 0) | ((b & 0x20) ? 4 : 0) | ((b & 0x02) ? 8 : 0);
    const p1 = ((b & 0x40) ? 1 : 0) | ((b & 0x04) ? 2 : 0) | ((b & 0x10) ? 4 : 0) | ((b & 0x01) ? 8 : 0);
    return [p0, p1];
}
function decodeMode1(b: number): [number, number, number, number] {
    return [
        ((b & 0x80) ? 1 : 0) | ((b & 0x08) ? 2 : 0),
        ((b & 0x40) ? 1 : 0) | ((b & 0x04) ? 2 : 0),
        ((b & 0x20) ? 1 : 0) | ((b & 0x02) ? 2 : 0),
        ((b & 0x10) ? 1 : 0) | ((b & 0x01) ? 2 : 0),
    ];
}
function decodeMode2(b: number): number[] {
    return [(b>>7)&1,(b>>6)&1,(b>>5)&1,(b>>4)&1,(b>>3)&1,(b>>2)&1,(b>>1)&1,b&1];
}

// ── Miniature PNG (160×100) ───────────────────────────────────────────────────
// Rendu à demi-résolution : 1 pixel de sortie = 2×2 pixels CPC en mode 0/1

const THUMB_W = 160;
const THUMB_H = 100;

function crc32(buf: Buffer): number {
    let crc = 0xFFFFFFFF;
    for (const byte of buf) {
        crc ^= byte;
        for (let i = 0; i < 8; i++) {
            crc = (crc & 1) ? (0xEDB88320 ^ (crc >>> 1)) : (crc >>> 1);
        }
    }
    return (crc ^ 0xFFFFFFFF) >>> 0;
}

function pngChunk(type: string, data: Buffer): Buffer {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
    const typeB = Buffer.from(type, "ascii");
    const payload = Buffer.concat([typeB, data]);
    const crcB = Buffer.alloc(4); crcB.writeUInt32BE(crc32(payload));
    return Buffer.concat([len, typeB, data, crcB]);
}

function scrToPng(data: Buffer, mode: 0|1|2, palette: number[]): Buffer | null {
    if (data.length < 16000) return null;

    // Canvas logique (mode 0/1 → 320×200, mode 2 → 640×200)
    const canvasW = mode === 2 ? 640 : 320;

    // Pixel RGB de chaque colonne/ligne du canvas logique, sous-échantillonné → THUMB
    const scaleX = canvasW / THUMB_W;   // ex. mode 0: 320/160 = 2
    const scaleY = 200 / THUMB_H;       // 200/100 = 2

    // Buffer RGB scanlines pour PNG (format PNG : filter-byte | R G B ... par ligne)
    const raw = Buffer.alloc(THUMB_H * (1 + THUMB_W * 3));

    for (let ty = 0; ty < THUMB_H; ty++) {
        const y = Math.floor(ty * scaleY);                 // ligne SCR (0-199)
        const scrRowBase = (y & 7) * 0x800 + (y >> 3) * 80;

        raw[ty * (1 + THUMB_W * 3)] = 0;                  // filtre = None

        for (let tx = 0; tx < THUMB_W; tx++) {
            const cx = Math.floor(tx * scaleX);            // colonne canvas

            // Byte SCR et index de pixel dans ce byte
            let xb: number; let pi: number;
            if (mode === 0) {
                // 2 CPC pixels / byte, chacun 2 canvas px large → 4 canvas px / byte
                xb = Math.floor(cx / 4);
                pi = Math.floor((cx % 4) / 2);            // 0 ou 1
            } else if (mode === 1) {
                xb = Math.floor(cx / 4);
                pi = cx % 4;                               // 0-3
            } else {
                xb = Math.floor(cx / 8);
                pi = cx % 8;                               // 0-7
            }

            if (xb >= 80) { const di = ty*(1+THUMB_W*3)+1+tx*3; raw[di]=raw[di+1]=raw[di+2]=0; continue; }
            const b = data[scrRowBase + xb];

            let colorIdx: number;
            if (mode === 0)      { const [p0, p1] = decodeMode0(b); colorIdx = palette[pi === 0 ? p0 : p1] ?? 0; }
            else if (mode === 1) { colorIdx = palette[decodeMode1(b)[pi]] ?? 0; }
            else                 { colorIdx = palette[decodeMode2(b)[pi]] ?? 0; }

            const rgb = CPC_HW_COLORS[colorIdx] ?? [0, 0, 0];
            const di = ty * (1 + THUMB_W * 3) + 1 + tx * 3;
            raw[di] = rgb[0]; raw[di+1] = rgb[1]; raw[di+2] = rgb[2];
        }
    }

    const ihdr = Buffer.alloc(13);
    ihdr.writeUInt32BE(THUMB_W, 0); ihdr.writeUInt32BE(THUMB_H, 4);
    ihdr[8] = 8; ihdr[9] = 2; // 8bpp RGB

    const idat = zlib.deflateSync(raw);

    return Buffer.concat([
        Buffer.from([137,80,78,71,13,10,26,10]), // PNG signature
        pngChunk("IHDR", ihdr),
        pngChunk("IDAT", idat),
        pngChunk("IEND", Buffer.alloc(0)),
    ]);
}

// ── Regex INCBIN ──────────────────────────────────────────────────────────────
const INCBIN_RE = /^\s*INCBIN\s+(?:"([^"]+)"|'([^']+)'|(\S+))/i;

// ── Provider ──────────────────────────────────────────────────────────────────
export class AsmHoverProvider implements vscode.HoverProvider {

    constructor(private readonly index: ResourceIndex) {}

    static register(index: ResourceIndex): vscode.Disposable {
        return vscode.languages.registerHoverProvider(
            [{ language: "asm" }, { language: "z80-disasm" }],
            new AsmHoverProvider(index)
        );
    }

    provideHover(
        document: vscode.TextDocument,
        position: vscode.Position,
        _token: vscode.CancellationToken
    ): vscode.ProviderResult<vscode.Hover> {
        const line = document.lineAt(position.line).text;
        const m = INCBIN_RE.exec(line);
        if (!m) return;

        const rawPath = m[1] ?? m[2] ?? m[3];
        if (!rawPath) return;

        // Vérifier que le curseur est sur le nom de fichier (pas sur le mot-clé INCBIN)
        const pathStart = line.indexOf(rawPath, line.toUpperCase().indexOf("INCBIN") + 6);
        if (pathStart === -1) return;
        if (position.character < pathStart || position.character > pathStart + rawPath.length) return;

        const dir = nodePath.dirname(document.uri.fsPath);
        const resolved = nodePath.resolve(dir, rawPath);
        const uri = vscode.Uri.file(resolved);

        // Infos fichier
        let fileSize = -1;
        let fileExists = false;
        try {
            const stat = fs.statSync(resolved);
            fileSize = stat.size;
            fileExists = true;
        } catch { /* fichier absent */ }

        // Compte des références dans le workspace
        const refCount = this.index.entries.find(
            e => e.uri.fsPath.toLowerCase() === resolved.toLowerCase()
        )?.refs.length ?? 0;

        const ext = nodePath.extname(rawPath).toLowerCase();
        const md = new vscode.MarkdownString("", true);
        md.isTrusted = true;
        md.supportHtml = true;

        // Miniature pour les .scr
        if (ext === ".scr" && fileExists) {
            try {
                const data = fs.readFileSync(resolved);
                const png = scrToPng(data, 0, FIRMWARE_PALETTE);
                if (png) {
                    const b64 = png.toString("base64");
                    md.appendMarkdown(`![SCR Mode 0](data:image/png;base64,${b64})\n\n`);
                }
            } catch { /* ignore */ }
        }

        md.appendMarkdown(`**${nodePath.basename(rawPath)}**\n\n`);
        md.appendMarkdown(`\`${resolved}\`\n\n`);
        if (fileExists) {
            const kb = (fileSize / 1024).toFixed(1);
            md.appendMarkdown(`Taille : **${kb} Ko** (${fileSize} octets)\n\n`);
        } else {
            md.appendMarkdown(`⚠️ Fichier introuvable\n\n`);
        }
        if (refCount > 0) {
            md.appendMarkdown(`Référencé par **${refCount}** INCBIN dans le workspace\n\n`);
        }
        if (ext === ".scr") {
            md.appendMarkdown(`*Aperçu en Mode 0 — palette firmware par défaut*`);
        }

        const range = new vscode.Range(
            position.line, pathStart,
            position.line, pathStart + rawPath.length
        );
        return new vscode.Hover(md, range);
    }
}
