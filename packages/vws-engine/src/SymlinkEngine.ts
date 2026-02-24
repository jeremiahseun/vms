/**
 * SymlinkEngine — Creates and destroys symlinks for the virtual workspace root.
 *
 * Platform-aware: uses `fs.symlink` on POSIX, directory junctions on Windows.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { execSync } from 'node:child_process';
import { v4 as uuidv4 } from 'uuid';
import type { Member, VirtualRoot, CreateOptions } from './types.js';

export class SymlinkEngine {
    private readonly platform: NodeJS.Platform;

    constructor(platform?: NodeJS.Platform) {
        this.platform = platform ?? process.platform;
    }

    /**
     * Create a virtual root directory populated with symlinks to each member.
     *
     * @param members - Project members to link into the virtual root.
     * @param options - Optional overrides for temp directory location.
     * @returns The created VirtualRoot metadata.
     */
    async create(members: Member[], options?: CreateOptions): Promise<VirtualRoot> {
        const id = uuidv4().slice(0, 8);
        const tempBase = options?.tempDir ?? os.tmpdir();
        const rootPath = path.join(tempBase, `vws-${id}`);

        // Create the virtual root with owner-only permissions (0o700) on POSIX.
        fs.mkdirSync(rootPath, { recursive: true, mode: 0o700 });

        for (const member of members) {
            await this.createSymlink(rootPath, member);
        }

        return {
            id,
            path: rootPath,
            members: [...members],
            pid: 0, // Will be set by SessionManager after daemon spawn
            parentPid: process.pid,
            createdAt: new Date().toISOString(),
        };
    }

    /**
     * Destroy a virtual root by removing all symlinks and the directory itself.
     */
    async destroy(root: VirtualRoot): Promise<void> {
        await this.removeDirectory(root.path);
    }

    /**
     * Add a single member symlink to an existing virtual root.
     */
    async addMember(root: VirtualRoot, member: Member): Promise<void> {
        this.validateMemberPath(member.path);
        await this.createSymlink(root.path, member);
        root.members.push(member);
    }

    /**
     * Remove a single member symlink from an existing virtual root.
     */
    async removeMember(root: VirtualRoot, alias: string): Promise<void> {
        const linkPath = path.join(root.path, alias);

        if (!fs.existsSync(linkPath)) {
            throw new Error(`Member "${alias}" not found in virtual root at ${root.path}`);
        }

        // On Windows, junctions are directories, so we use rmdir. On POSIX, unlink.
        if (this.platform === 'win32') {
            fs.rmdirSync(linkPath);
        } else {
            fs.unlinkSync(linkPath);
        }

        root.members = root.members.filter((m) => this.resolveAlias(m) !== alias);
    }

    /**
     * Create a single symlink in the virtual root for a member.
     */
    private async createSymlink(rootPath: string, member: Member): Promise<void> {
        const resolvedPath = this.resolvePath(member.path);
        this.validateMemberPath(resolvedPath);

        const alias = this.resolveAlias(member);
        const linkPath = path.join(rootPath, alias);

        if (fs.existsSync(linkPath)) {
            throw new Error(
                `Alias "${alias}" already exists in virtual root. Use a unique alias for each member.`,
            );
        }

        if (this.platform === 'win32') {
            await this.createWindowsJunction(resolvedPath, linkPath);
        } else {
            fs.symlinkSync(resolvedPath, linkPath, 'dir');
        }
    }

    /**
     * Create a Windows directory junction.
     * Falls back to fs.symlink with 'junction' type if mklink fails.
     */
    private async createWindowsJunction(target: string, linkPath: string): Promise<void> {
        try {
            // Try native junction first (no elevation required on NTFS).
            execSync(`mklink /J "${linkPath}" "${target}"`, { stdio: 'ignore', shell: 'cmd.exe' });
        } catch {
            // Fallback to Node.js fs.symlink with junction type.
            fs.symlinkSync(target, linkPath, 'junction');
        }
    }

    /**
     * Remove a directory (the virtual root) and all its contents.
     * Symlinks are removed individually first to avoid following them.
     */
    private async removeDirectory(dirPath: string): Promise<void> {
        if (!fs.existsSync(dirPath)) {
            return;
        }

        const entries = fs.readdirSync(dirPath, { withFileTypes: true });
        for (const entry of entries) {
            const entryPath = path.join(dirPath, entry.name);
            const stats = fs.lstatSync(entryPath);

            if (stats.isSymbolicLink()) {
                fs.unlinkSync(entryPath);
            } else if (this.platform === 'win32' && stats.isDirectory()) {
                // On Windows, junctions appear as directories. Check if it's a reparse point.
                try {
                    fs.readlinkSync(entryPath);
                    // If readlink succeeds, it's a junction/symlink — remove it.
                    fs.rmdirSync(entryPath);
                } catch {
                    // Not a junction; remove recursively.
                    fs.rmSync(entryPath, { recursive: true, force: true });
                }
            } else {
                fs.rmSync(entryPath, { recursive: true, force: true });
            }
        }

        fs.rmdirSync(dirPath);
    }

    /**
     * Resolve a member's display alias.
     * Uses the alias if provided, otherwise the basename of the path.
     */
    resolveAlias(member: Member): string {
        return member.alias ?? path.basename(member.path);
    }

    /**
     * Resolve `~` to the home directory and normalize the path.
     */
    resolvePath(inputPath: string): string {
        let resolved = inputPath;
        if (resolved.startsWith('~')) {
            resolved = path.join(os.homedir(), resolved.slice(1));
        }
        return path.resolve(resolved);
    }

    /**
     * Validate that a member path exists and is a directory.
     */
    private validateMemberPath(resolvedPath: string): void {
        if (!fs.existsSync(resolvedPath)) {
            throw new Error(`Member path does not exist: ${resolvedPath}`);
        }

        const stats = fs.statSync(resolvedPath);
        if (!stats.isDirectory()) {
            throw new Error(`Member path is not a directory: ${resolvedPath}`);
        }
    }
}
