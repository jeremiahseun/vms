#!/usr/bin/env node

/**
 * VWS CLI — Entry point.
 *
 * `vws <command> [flags]`
 */

import { Command } from 'commander';
import { registerInitCommand } from './commands/init.js';
import { registerAddCommand } from './commands/add.js';
import { registerRemoveCommand } from './commands/remove.js';
import { registerListCommand } from './commands/list.js';
import { registerOpenCommand } from './commands/open.js';
import { registerCloseCommand } from './commands/close.js';
import { registerStatusCommand } from './commands/status.js';
import { registerImportCommand } from './commands/import.js';
import { registerExportCommand } from './commands/export.js';
import { registerDeleteCommand } from './commands/delete.js';

const program = new Command();

program
    .name('vws')
    .version('1.0.0')
    .description('VWS — Virtual Workspace Aggregator. Unified ephemeral project views for AI coding tools and IDEs.');

registerInitCommand(program);
registerAddCommand(program);
registerRemoveCommand(program);
registerListCommand(program);
registerOpenCommand(program);
registerCloseCommand(program);
registerStatusCommand(program);
registerImportCommand(program);
registerExportCommand(program);
registerDeleteCommand(program);

program.parse(process.argv);
