'use strict';

module.exports = {
    testEnvironment: 'node',
    rootDir: '.',
    testMatch: ['<rootDir>/test/**/*.test.ts'],
    moduleNameMapper: {
        '^vscode$': '<rootDir>/test/__mocks__/vscode.ts',
    },
    transform: {
        '^.+\\.tsx?$': ['ts-jest', {
            tsconfig: {
                target: 'ES2020',
                module: 'commonjs',
                strict: true,
                esModuleInterop: true,
                skipLibCheck: true,
                types: ['node', 'jest'],
            },
        }],
    },
};
