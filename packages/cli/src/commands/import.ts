/**
 * `vws import <.vworkspace.json>` — Import a workspace config from a file.
 */

import type { Command } from 'commander';
import { registry, printSuccess, exitWithError } from '../shared.js';

export function registerImportCommand(program: Command): void {
    program
        .command('import <file>')
        .description('Import a workspace config from a .vworkspace.json file')
        .action((file: string) => {
            try {
                const workspace = registry.importFromFile(file);
                printSuccess(`Imported workspace "${workspace.name}" with ${workspace.members.length} member(s).`);
            } catch (err) {
                exitWithError((err as Error).message);
            }
        });
}
