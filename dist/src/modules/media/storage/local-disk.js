/**
 * Local filesystem storage: the only `StorageProvider` that exists today.
 *
 * Everything in this file exists because an image path is attacker-influenced
 * twice over — it comes from a database row, and that row can be patched by the
 * business that owns it. So no path is ever used as given:
 *
 *   * the upload root is resolved and, when it exists, passed through
 *     `realpath`, so a symlinked temp directory (macOS `/tmp` is one) compares
 *     equal to its target;
 *   * every candidate path is resolved and then proven to sit inside the root
 *     before it is opened, created, or unlinked;
 *   * `removeByStoredValue` additionally proves the file sits inside
 *     `<root>/<businessId>/`, so a business can never delete another
 *     business's image by writing a crafted URL into its own row.
 *
 * The re-check after `mkdir` is what makes the check meaningful: `resolve`
 * alone is defeated by a symlink that already exists inside the tree.
 */
import { randomBytes } from 'node:crypto';
import { mkdir, realpath, rename, unlink, writeFile } from 'node:fs/promises';
import { existsSync, realpathSync } from 'node:fs';
import { basename, dirname, isAbsolute, join, resolve, sep } from 'node:path';
import { config } from '../../../config.js';
import { UPLOADS_URL_PREFIX } from './types.js';
function assertInside(root, candidate, what) {
    const prefix = root.endsWith(sep) ? root : root + sep;
    if (candidate !== root && !candidate.startsWith(prefix)) {
        // Nothing here contains anything from the request, so the message can be
        // precise without leaking a path.
        throw new Error(`Refusing to touch ${what}: resolved outside the upload directory`);
    }
    return candidate;
}
/** Resolves `relative` under `root` and proves the result stays inside it. */
function resolveInside(root, relative, what) {
    if (isAbsolute(relative) || relative.includes('..')) {
        throw new Error(`Refusing to touch ${what}: not a relative path`);
    }
    return assertInside(root, resolve(root, relative), what);
}
/**
 * The absolute upload root, canonicalised.
 *
 * Resolved once per process: resolving on every request would stat the
 * filesystem for a value that cannot change while the process runs, and
 * `tests/uploads.test.ts` sets `UPLOAD_DIR` before the first call precisely so
 * this is read once.
 *
 * `realpath` matters even more than the caching. `express.static` is mounted
 * from this same value, so a symlinked upload root (macOS `/tmp` is one, and
 * most CI temp directories are) resolves to the same canonical path on both
 * sides. If the static mount and the writer disagreed about where the root is, a
 * file could be written somewhere the reader never looks.
 *
 * Nothing is created here. `createApp()` mounts the static handler from this and
 * must not leave a folder behind just because a process started; the directory
 * is created by `put`, which is the only thing that writes into it. When the
 * folder does not exist yet the resolved path is used as-is, and `put` refuses
 * to write if the canonical path turns out to be somewhere else — that would mean
 * something other than this process created the root.
 *
 * Synchronous because `createApp()` is synchronous and has to mount the static
 * handler with the same root.
 */
let root = null;
export function uploadRoot() {
    if (root === null) {
        const absolute = resolve(process.cwd(), config.UPLOAD_DIR);
        root = existsSync(absolute) ? realpathSync(absolute) : absolute;
    }
    return root;
}
/** Test-only: forgets the cached root so a new UPLOAD_DIR is picked up. */
export function resetUploadRootCache() {
    root = null;
}
/**
 * The root, guaranteed to exist and to be canonical.
 *
 * `put` calls this instead of `uploadRoot()` so that creating the directory and
 * proving where it really is are the same step.
 */
async function writableRoot() {
    const root = uploadRoot();
    await mkdir(root, { recursive: true });
    const real = await realpath(root);
    if (real !== root) {
        throw new Error('Refusing to write: UPLOAD_DIR does not resolve to the directory it names');
    }
    return real;
}
export class LocalDiskStorage {
    publicUrl(key) {
        return UPLOADS_URL_PREFIX + key;
    }
    async put(key, body, contentType, metadata) {
        const root = await writableRoot();
        const target = resolveInside(root, key, 'upload target');
        const folder = dirname(target);
        await mkdir(folder, { recursive: true });
        // Re-prove containment after creating the tree, and write through the
        // canonical folder: `resolve` on a path that runs through a symlink
        // already present inside the tree would happily return a location
        // outside the root, and `mkdir -p` follows symlinks while creating.
        const realFolder = await realpath(folder);
        const realTarget = assertInside(root, join(realFolder, basename(target)), 'upload target');
        // A temporary name in the same folder, so the rename is atomic instead
        // of a copy that a concurrent reader could observe half-written.
        const temporary = join(realFolder, `.upload-${randomBytes(8).toString('hex')}.tmp`);
        try {
            await writeFile(temporary, body, { flag: 'wx' });
            await rename(temporary, realTarget);
        }
        catch (error) {
            await unlink(temporary).catch(() => undefined);
            throw error;
        }
        return {
            key,
            url: this.publicUrl(key),
            bytes: body.byteLength,
            contentType,
            width: metadata?.width ?? 0,
            height: metadata?.height ?? 0,
        };
    }
    async remove(key) {
        const root = uploadRoot();
        const target = resolveInside(root, key, 'stored file');
        await unlink(target).catch((error) => {
            // ENOENT means it is already gone, which is the state the caller
            // asked for. Anything else is a real failure worth surfacing.
            if (error.code !== 'ENOENT')
                throw error;
        });
    }
    async removeByStoredValue(stored, businessId) {
        if (!stored || !stored.startsWith(UPLOADS_URL_PREFIX)) {
            // An external URL, or nothing at all. There is no file here to
            // delete and, more importantly, nothing this API owns.
            return;
        }
        const relative = stored.slice(UPLOADS_URL_PREFIX.length);
        const ownerPrefix = `${businessId}/`;
        if (!relative.startsWith(ownerPrefix)) {
            // A managed path, but under a different business's folder. The
            // column it came from is this business's own row, so this is either
            // a bug or a crafted value; neither is a reason to delete anything.
            return;
        }
        await this.remove(relative);
    }
}
/**
 * Builds a storage key from a business, a slot, and a random name.
 *
 * 32 hexadecimal characters is 16 bytes from the CSPRNG, so a name cannot be
 * guessed and cannot be enumerated by walking the folder. The original file
 * name never appears: it is attacker-controlled, may hold a path, and would
 * make the URL say something about the uploader's disk.
 */
export function buildImageKey(businessId, slot) {
    return `${businessId}/${slot}/${randomBytes(16).toString('hex')}.webp`;
}
//# sourceMappingURL=local-disk.js.map