import { defineConfig } from 'vitest/config';

export default defineConfig({
    test: {
        globals: true,
        include: ['packages/*/src/**/*.test.ts'],
        exclude: ['packages/vscode-extension/**'],
        coverage: {
            provider: 'v8',
            include: ['packages/*/src/**/*.ts'],
            exclude: ['**/*.test.ts', '**/*.d.ts'],
        },
    },
});
