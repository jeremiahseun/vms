import * as fs from 'node:fs';

/** Create a directory link. Windows uses junctions (no admin / Developer Mode needed). */
export function createLink(target: string, linkPath: string, platform = process.platform): void {
  fs.symlinkSync(target, linkPath, platform === 'win32' ? 'junction' : 'dir');
}

export function isLink(p: string): boolean {
  try {
    return fs.lstatSync(p).isSymbolicLink();
  } catch {
    return false;
  }
}

export function exists(p: string): boolean {
  try {
    fs.lstatSync(p);
    return true;
  } catch {
    return false;
  }
}

export function linkTarget(p: string): string | null {
  try {
    return fs.realpathSync(p);
  } catch {
    return null;
  }
}

/** Remove a link itself, never what it points to. Throws if p is not a link. */
export function removeLink(p: string, platform = process.platform): void {
  if (!isLink(p)) throw new Error(`Refusing to remove ${p}: not a link`);
  if (platform === 'win32') {
    try {
      fs.rmdirSync(p);
      return;
    } catch {
      /* file symlink: fall through */
    }
  }
  fs.unlinkSync(p);
}
