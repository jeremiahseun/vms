/**
 * VWSStatusBar — Status bar item showing the active VWS session state.
 *
 * Displays "[VWS: workspace-name | N members]" in the bottom status bar.
 * Clicking it triggers the close session command.
 */

import * as vscode from 'vscode';
import type { VirtualRoot } from 'vws-engine';

export class VWSStatusBar implements vscode.Disposable {
    private readonly statusBarItem: vscode.StatusBarItem;

    constructor() {
        this.statusBarItem = vscode.window.createStatusBarItem(
            vscode.StatusBarAlignment.Left,
            100,
        );
        this.statusBarItem.command = 'vws.closeSession';
        this.statusBarItem.tooltip = 'Click to close the active VWS session';
        // Initially hidden — shown only when a session is active.
    }

    /** Update the status bar to reflect the current session state. */
    update(root: VirtualRoot | null): void {
        if (root) {
            const memberCount = root.members.length;
            this.statusBarItem.text = `$(link) VWS: ${root.id} | ${memberCount} member${memberCount !== 1 ? 's' : ''}`;
            this.statusBarItem.backgroundColor = undefined;
            this.statusBarItem.show();
        } else {
            this.statusBarItem.hide();
        }
    }

    dispose(): void {
        this.statusBarItem.dispose();
    }
}
