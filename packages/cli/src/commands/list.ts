/**
 * `vws list` — List all workspaces and their member paths.
 */

import type { Command } from 'commander';
import { registry, printInfo, engine } from '../shared.js';

export function registerListCommand(program: Command): void {
    program
        .command('list')
        .description('List all workspaces and their member paths')
        .action(() => {
            const workspaces = registry.loadAll();

            if (workspaces.length === 0) {
                printInfo('No workspaces configured. Run `vws init <name>` to get started.');
                return;
            }

            for (const ws of workspaces) {
                console.log(`\n\x1b[1m${ws.name}\x1b[0m (${ws.members.length} member${ws.members.length !== 1 ? 's' : ''})`);

                if (ws.options?.launchWith) {
                    console.log(`  Launch with: ${ws.options.launchWith}`);
                }

                for (const member of ws.members) {
                    const alias = engine.resolveAlias(member);
                    const display = member.alias ? `${alias} → ${member.path}` : member.path;
                    console.log(`  • ${display}`);
                }
            }

            console.log('');
        });
}
