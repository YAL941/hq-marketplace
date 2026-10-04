/**
 * Storage selection.
 *
 * One place decides which `StorageProvider` the process uses, so a route asks
 * for "the storage" and never branches on a driver name. Adding S3 or
 * Cloudflare R2 is a new class in this folder plus one line in the switch; the
 * `STORAGE_DRIVER` value in the environment selects between them and the
 * configuration schema in `src/config.ts` is what keeps the list honest.
 */

import { config } from '../../../config.js';
import { LocalDiskStorage, resetUploadRootCache } from './local-disk.js';
import type { StorageProvider } from './types.js';

let provider: StorageProvider | null = null;

export function getStorage(): StorageProvider {
    if (provider) return provider;
    switch (config.STORAGE_DRIVER) {
        case 'local':
            provider = new LocalDiskStorage();
            return provider;
        default: {
            // Unreachable while the enum only has one member, and kept so a
            // driver added later without a case fails loudly instead of
            // silently falling back to local disk.
            const exhaustive: never = config.STORAGE_DRIVER;
            throw new Error(`No storage provider for driver: ${String(exhaustive)}`);
        }
    }
}

/** Test-only: drops the cached provider and the cached upload root. */
export function resetStorageForTests(): void {
    provider = null;
    resetUploadRootCache();
}

export { LocalDiskStorage, buildImageKey } from './local-disk.js';
export { UPLOADS_URL_PREFIX, type StorageProvider, type StoredObject, type ImageSlot } from './types.js';
