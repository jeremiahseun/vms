/**
 * `vws open [<name>] [--with <tool>]` — Create the virtual root and optionally launch a tool.
 */

import type { Command } from 'commander';
import { exec } from 'node:child_process';
import { registry, sessionManager, resolveAdapter, printSuccess, printInfo, exitWithError } from '../shared.js';

export function registerOpenCommand(program: Command): void {
    program
        .command('open [name]')
        .description('Create the virtual root and optionally launch a tool')
        .option('--with <tool>', 'Launch a tool against the virtual root (e.g. cursor, code, claude)')
        .option('--print-path', 'Print the virtual root path to stdout (for piping)')
        .option('--name <name>', 'Custom name for the virtual root directory')
        .action(async (name: string | undefined, options: { with?: string; printPath?: boolean; name?: string }) => {
            try {
                // Resolve workspace.
                const workspaces = registry.loadAll();

                if (workspaces.length === 0) {
                    exitWithError('No workspaces found. Run `vws init <name>` first.');
                }

                const workspace = name
                    ? registry.get(name)
                    : workspaces[workspaces.length - 1];

                if (!workspace) {
                    exitWithError(`Workspace "${name}" not found.`);
                }

                if (workspace.members.length === 0) {
                    exitWithError(`Workspace "${workspace.name}" has no members. Run \`vws add <path>\` first.`);
                }

                // Open the session.
                const createOptions = options.name ? { name: options.name } : undefined;
                const root = await sessionManager.open(workspace.name, workspace.members, createOptions);

                if (options.printPath) {
                    // Clean output for piping.
                    process.stdout.write(root.path);
                    return;
                }

                printSuccess(`Session opened: ${root.id}`);
                printInfo(`Virtual root: ${root.path}`);
                printInfo(`Members: ${root.members.length}`);

                // Launch tool if specified.
                const toolName = options.with ?? workspace.options?.launchWith;
                if (toolName) {
                    const adapter = resolveAdapter(toolName);
                    if (!adapter) {
                        exitWithError(
                            `Unknown tool adapter "${toolName}". Available: cursor, code, windsurf, claude, zed.`,
                        );
                    }

                    const command = adapter.command.replace('{path}', root.path);
                    printInfo(`Launching: ${command}`);

                    exec(command, (err) => {
                        if (err) {
                            console.error(`\x1b[33m⚠ Tool launch failed: ${err.message}\x1b[0m`);
                        }
                    });
                }
            } catch (err) {
                exitWithError((err as Error).message);
            }
        });
}
