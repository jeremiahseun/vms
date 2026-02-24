/**
 * `vws init <name>` — Create a new named workspace.
 */

import type { Command } from 'commander';
import { registry, printSuccess, exitWithError } from '../shared.js';

export function registerInitCommand(program: Command): void {
    program
        .command('init <name>')
        .description('Create a new named workspace')
        .action((name: string) => {
            try {
                registry.create(name);
                printSuccess(`Workspace "${name}" created.`);
            } catch (err) {
                exitWithError((err as Error).message);
            }
        });
}
