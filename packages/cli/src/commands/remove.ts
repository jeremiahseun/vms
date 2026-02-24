/**
 * `vws remove <path|alias>` — Remove a project from a workspace.
 */

import type { Command } from 'commander';
import { registry, printSuccess, exitWithError } from '../shared.js';

export function registerRemoveCommand(program: Command): void {
    program
        .command('remove <pathOrAlias>')
        .description('Remove a project from a workspace')
        .option('-w, --workspace <name>', 'Target workspace name (uses the most recent if omitted)')
        .action((pathOrAlias: string, options: { workspace?: string }) => {
            try {
                const workspaceName = resolveWorkspaceName(options.workspace);
                registry.removeMember(workspaceName, pathOrAlias);
                printSuccess(`Removed "${pathOrAlias}" from workspace "${workspaceName}".`);
            } catch (err) {
                exitWithError((err as Error).message);
            }
        });
}

function resolveWorkspaceName(explicitName?: string): string {
    if (explicitName) return explicitName;

    const all = registry.loadAll();
    if (all.length === 0) {
        exitWithError('No workspaces found.');
    }
    return all[all.length - 1].name;
}
