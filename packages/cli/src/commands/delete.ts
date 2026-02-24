/**
 * Implement the `vws delete <name>` command.
 */

import { Command } from 'commander';
import { registry, exitWithError, printSuccess } from '../shared.js';

export function registerDeleteCommand(program: Command) {
    program
        .command('delete <name>')
        .description('Delete a workspace entirely')
        .action((name: string) => {
            try {
                registry.delete(name);
                printSuccess(`Workspace "${name}" has been deleted.`);
            } catch (err) {
                exitWithError((err as Error).message);
            }
        });
}
