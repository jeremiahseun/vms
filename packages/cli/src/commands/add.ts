/**
 * `vws add <path>` — Add a project path to the current or named workspace.
 */

import type { Command } from 'commander';
import { registry, printSuccess, exitWithError } from '../shared.js';

export function registerAddCommand(program: Command): void {
    program
        .command('add <path>')
        .description('Add a project path to a workspace')
        .option('--alias <alias>', 'Override the directory name in the virtual root')
        .option('-w, --workspace <name>', 'Target workspace name (uses the most recent if omitted)')
        .action((projectPath: string, options: { alias?: string; workspace?: string }) => {
            try {
                const workspaceName = resolveWorkspaceName(options.workspace);

                registry.addMember(workspaceName, {
                    path: projectPath,
                    alias: options.alias,
                });

                const displayAlias = options.alias ?? projectPath.split('/').pop() ?? projectPath;
                printSuccess(`Added "${displayAlias}" to workspace "${workspaceName}".`);
            } catch (err) {
                exitWithError((err as Error).message);
            }
        });
}

function resolveWorkspaceName(explicitName?: string): string {
    if (explicitName) return explicitName;

    const all = registry.loadAll();
    if (all.length === 0) {
        exitWithError('No workspaces found. Run `vws init <name>` first.');
    }
    return all[all.length - 1].name;
}
