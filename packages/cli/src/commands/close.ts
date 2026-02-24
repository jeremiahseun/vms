/**
 * `vws close` — Destroy the active virtual root and end the session.
 */

import type { Command } from 'commander';
import { sessionManager, printSuccess, printInfo, exitWithError } from '../shared.js';

export function registerCloseCommand(program: Command): void {
    program
        .command('close')
        .description('Destroy the active virtual root and end the session')
        .option('--session <id>', 'Close a specific session by ID')
        .action(async (options: { session?: string }) => {
            try {
                const session = options.session
                    ? sessionManager.getSession(options.session)
                    : sessionManager.getActiveSession();

                if (!session) {
                    printInfo('No active session to close.');
                    return;
                }

                await sessionManager.close(session.id);
                printSuccess(`Session "${session.id}" closed. Virtual root removed.`);
            } catch (err) {
                exitWithError((err as Error).message);
            }
        });
}
