/* Minimal vscode mock for Jest — covers what HexDocument needs. */

const readFileMock = jest.fn().mockResolvedValue(new Uint8Array(0));

const vscode = {
    Uri: {
        file:  (path: string) => ({ fsPath: path, toString: () => `file://${path}` }),
        parse: (s:    string) => ({ fsPath: s,    toString: () => s }),
    },
    workspace: {
        fs: {
            readFile:  readFileMock,
            writeFile: jest.fn().mockResolvedValue(undefined),
        },
    },
    // Expose the mock so tests can control the return value
    __setReadFileData: (data: Uint8Array) => readFileMock.mockResolvedValue(data),
};

export = vscode;
