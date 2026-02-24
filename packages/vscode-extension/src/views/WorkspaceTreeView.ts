/**
 * WorkspaceTreeView — Sidebar tree data provider for VWS.
 *
 * Displays the members of the active virtual workspace in the sidebar.
 */

import * as vscode from 'vscode';
import * as path from 'node:path';
import type { Member } from 'vws-engine';

export class WorkspaceTreeProvider implements vscode.TreeDataProvider<MemberTreeItem> {
    private _onDidChangeTreeData = new vscode.EventEmitter<MemberTreeItem | undefined>();
    readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

    private members: Member[] = [];

    /** Update the member list displayed in the tree. */
    setMembers(members: Member[]): void {
        this.members = members;
    }

    /** Trigger a tree refresh. */
    refresh(): void {
        this._onDidChangeTreeData.fire(undefined);
    }

    getTreeItem(element: MemberTreeItem): vscode.TreeItem {
        return element;
    }

    getChildren(): MemberTreeItem[] {
        if (this.members.length === 0) {
            return [
                new MemberTreeItem(
                    'No active workspace',
                    '',
                    vscode.TreeItemCollapsibleState.None,
                    true,
                ),
            ];
        }

        return this.members.map((member) => {
            const alias = member.alias ?? path.basename(member.path);
            return new MemberTreeItem(
                alias,
                member.path,
                vscode.TreeItemCollapsibleState.None,
                false,
            );
        });
    }
}

class MemberTreeItem extends vscode.TreeItem {
    constructor(
        public readonly label: string,
        public readonly projectPath: string,
        public readonly collapsibleState: vscode.TreeItemCollapsibleState,
        public readonly isPlaceholder: boolean,
    ) {
        super(label, collapsibleState);

        if (isPlaceholder) {
            this.description = 'Run VWS: Open Workspace';
            this.iconPath = new vscode.ThemeIcon('info');
        } else {
            this.description = projectPath;
            this.tooltip = `${label} → ${projectPath}`;
            this.iconPath = new vscode.ThemeIcon('folder');
            this.contextValue = 'vwsMember';

            // Click to reveal the folder in the file explorer.
            this.command = {
                command: 'revealFileInOS',
                title: 'Reveal in Finder',
                arguments: [vscode.Uri.file(projectPath)],
            };
        }
    }
}
