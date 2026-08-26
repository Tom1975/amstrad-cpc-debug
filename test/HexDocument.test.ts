jest.mock('vscode');

import * as vscode from 'vscode';
import { HexDocument } from '../src/HexDocument';

const mock = vscode as any;

async function makeDoc(bytes: number[]): Promise<HexDocument> {
    mock.__setReadFileData(new Uint8Array(bytes));
    const uri = vscode.Uri.file('/test/file.bin');
    return HexDocument.create(uri as any);
}

// ── search ────────────────────────────────────────────────────────────────────

describe('HexDocument.search', () => {
    test('finds single occurrence', async () => {
        const doc = await makeDoc([0x00, 0xCD, 0x3E, 0x00]);
        expect(doc.search([0xCD, 0x3E])).toEqual([1]);
    });

    test('finds multiple occurrences', async () => {
        const doc = await makeDoc([0xFF, 0xAA, 0xFF, 0xAA, 0xFF]);
        expect(doc.search([0xFF, 0xAA])).toEqual([0, 2]);
    });

    test('returns empty when not found', async () => {
        const doc = await makeDoc([0x01, 0x02, 0x03]);
        expect(doc.search([0xDE, 0xAD])).toEqual([]);
    });

    test('empty pattern returns empty', async () => {
        const doc = await makeDoc([0x01, 0x02]);
        expect(doc.search([])).toEqual([]);
    });

    test('pattern longer than data returns empty', async () => {
        const doc = await makeDoc([0x01]);
        expect(doc.search([0x01, 0x02, 0x03])).toEqual([]);
    });

    test('full data match at offset 0', async () => {
        const doc = await makeDoc([0xDE, 0xAD, 0xBE, 0xEF]);
        expect(doc.search([0xDE, 0xAD, 0xBE, 0xEF])).toEqual([0]);
    });

    test('single-byte pattern', async () => {
        const doc = await makeDoc([0x42, 0x00, 0x42, 0x00]);
        expect(doc.search([0x42])).toEqual([0, 2]);
    });

    test('overlapping patterns', async () => {
        // AABAA — searching AA finds at 0 and 3
        const doc = await makeDoc([0xAA, 0xAA, 0xBB, 0xAA, 0xAA]);
        expect(doc.search([0xAA, 0xAA])).toEqual([0, 3]);
    });
});

// ── getBytes ──────────────────────────────────────────────────────────────────

describe('HexDocument.getBytes', () => {
    test('returns correct slice', async () => {
        const doc = await makeDoc([0x01, 0x02, 0x03, 0x04]);
        expect(doc.getBytes(1, 2)).toEqual([0x02, 0x03]);
    });

    test('clips at end of file', async () => {
        const doc = await makeDoc([0x01, 0x02]);
        expect(doc.getBytes(1, 10)).toEqual([0x02]);
    });
});

// ── setByte / dirty tracking ──────────────────────────────────────────────────

describe('HexDocument dirty tracking', () => {
    test('setByte makes doc dirty', async () => {
        const doc = await makeDoc([0x00, 0x00]);
        expect(doc.isDirty).toBe(false);
        doc.setByte(0, 0xFF);
        expect(doc.isDirty).toBe(true);
    });

    test('setByte to same value clears dirty', async () => {
        const doc = await makeDoc([0xAA, 0x00]);
        doc.setByte(0, 0xBB);
        expect(doc.isDirty).toBe(true);
        doc.setByte(0, 0xAA);  // restore original
        expect(doc.isDirty).toBe(false);
    });

    test('search uses dirty bytes', async () => {
        const doc = await makeDoc([0x00, 0x00, 0x00]);
        doc.setByte(0, 0xDE);
        doc.setByte(1, 0xAD);
        expect(doc.search([0xDE, 0xAD])).toEqual([0]);
    });

    test('revert clears all dirty bytes', async () => {
        const doc = await makeDoc([0x01, 0x02]);
        doc.setByte(0, 0xFF);
        doc.revert();
        expect(doc.isDirty).toBe(false);
        expect(doc.getBytes(0, 1)).toEqual([0x01]);
    });
});
