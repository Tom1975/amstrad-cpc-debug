/* Minimal vscode mock for Jest — covers what HexDocument and the language
   providers need. */

class Position {
    constructor(public readonly line: number, public readonly character: number) {}
}

class Range {
    constructor(
        public readonly startLine: number,
        public readonly startCharacter: number,
        public readonly endLine: number,
        public readonly endCharacter: number,
    ) {}
}

class EvaluatableExpression {
    constructor(public readonly range: Range, public readonly expression: string) {}
}

const readFileMock = jest.fn().mockResolvedValue(new Uint8Array(0));

const vscode = {
    Position,
    Range,
    EvaluatableExpression,
    languages: {
        registerEvaluatableExpressionProvider: jest.fn(),
        registerHoverProvider: jest.fn(),
        registerDocumentSymbolProvider: jest.fn(),
    },
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
