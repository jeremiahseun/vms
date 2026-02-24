/**
 * `vws status` — Show the active session's virtual root path and members.
 */

import type { Command } from 'commander';
import { sessionManager, engine, printInfo } from '../shared.js';

export function registerStatusCommand(program: Command): void {
    program
        .command('status')
        .description("Show the active session's virtual root path and members")
        .action(() => {
            const session = sessionManager.getActiveSession();

            if (!session) {
                printInfo('No active session.');
                return;
            }

            console.log('');
            console.log(`\x1b[1mActive Session\x1b[0m`);
            console.log(`  Session ID : ${session.id}`);
            console.log(`  Workspace  : ${session.workspaceName}`);
            console.log(`  Root       : ${session.virtualRootPath}`);
            console.log(`  Members    : ${session.members.length}`);
            console.log(`  Daemon PID : ${session.daemonPid}`);
            console.log(`  Created    : ${session.createdAt}`);

            console.log('');
            console.log('\x1b[1mMembers:\x1b[0m');
            for (const member of session.members) {
                const alias = engine.resolveAlias(member);
                console.log(`  • ${alias} → ${member.path}`);
            }

            console.log('');
        });
}
