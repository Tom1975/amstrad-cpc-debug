/**
 * Pure logic functions shared between the webview (inlined in HexEditorProvider.ts)
 * and the test suite (imported directly by Jest).
 *
 * No DOM, no vscode, no Node-only APIs — safe to run in any JS environment.
 * searchMode: 0 = AUTO, 1 = HEX (forced), 2 = TXT (forced)
 */

export function isHexDigit(ch: string): boolean {
    return (ch >= '0' && ch <= '9') || (ch >= 'a' && ch <= 'f') || (ch >= 'A' && ch <= 'F');
}

export function stripWS(s: string): string {
    let out = '';
    for (let i = 0; i < s.length; i++) {
        const code = s.charCodeAt(i);
        if (code !== 32 && code !== 9 && code !== 13 && code !== 10) out += s[i];
    }
    return out;
}

export function hexCompact(trimmed: string): string | null {
    const c = stripWS(trimmed);
    if (c.length < 2 || c.length % 2 !== 0) return null;
    for (let i = 0; i < c.length; i++) { if (!isHexDigit(c[i])) return null; }
    return c;
}

export function parseSearchInput(raw: string, searchMode: number): { pattern: number[] } | null {
    const noWS = stripWS(raw);
    if (!noWS) return null;

    if (searchMode === 1) {
        if (noWS.length === 0 || noWS.length % 2 !== 0) return null;
        for (let i = 0; i < noWS.length; i++) { if (!isHexDigit(noWS[i])) return null; }
        const pattern: number[] = [];
        for (let i = 0; i < noWS.length; i += 2) pattern.push(parseInt(noWS.slice(i, i + 2), 16));
        return pattern.length > 0 ? { pattern } : null;
    }

    if (searchMode === 2) {
        const full = raw.trim();
        return full ? { pattern: Array.from(full).map(ch => ch.charCodeAt(0)) } : null;
    }

    // AUTO: hex si ça ressemble à des octets hex complets, sinon texte
    const c = hexCompact(raw.trim());
    if (c) {
        const pattern: number[] = [];
        for (let i = 0; i < c.length; i += 2) pattern.push(parseInt(c.slice(i, i + 2), 16));
        return { pattern };
    }
    const full = raw.trim();
    return full ? { pattern: Array.from(full).map(ch => ch.charCodeAt(0)) } : null;
}

export function getHexError(raw: string): string | null {
    const c = stripWS(raw);
    if (!c) return null;
    for (let i = 0; i < c.length; i++) {
        if (!isHexDigit(c[i])) return 'Caractères non hex : ' + c[i];
    }
    if (c.length % 2 !== 0) return 'Chiffre(s) manquant(s)';
    return null;
}
