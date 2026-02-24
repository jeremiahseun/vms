/**
 * `vws export <name>` — Export a workspace config to .vworkspace.json.
 */

import * as path from 'node:path';
import type { Command } from 'commander';
import { registry, printSuccess, exitWithError } from '../shared.js';

export function registerExportCommand(program: Command): void {
    program
        .command('export <name>')
        .description('Export a workspace config to a .vworkspace.json file')
        .option('-o, --output <path>', 'Output file path', '.vworkspace.json')
        .action((name: string, options: { output: string }) => {
            try {
                const outputPath = path.resolve(options.output);
                registry.exportToFile(name, outputPath);
                printSuccess(`Exported workspace "${name}" to ${outputPath}`);
            } catch (err) {
                exitWithError((err as Error).message);
            }
        });
}
