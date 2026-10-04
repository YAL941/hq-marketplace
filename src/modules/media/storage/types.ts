/**
 * The storage contract every backend has to satisfy, and the only thing a route
 * is allowed to know about where a file ends up.
 *
 * The reason it exists is not elegance, it is migration. Images are stored on
 * the local disk today, which is right for development and wrong for a deployed
 * API: a container filesystem is ephemeral, and several instances would not see
 * each other's files. When that day comes the answer is a new implementation of
 * this interface (S3, Cloudflare R2) selected by `config.STORAGE_DRIVER`, with
 * no change to a route, to a validation rule, or to a database row.
 *
 * Two rules are part of the contract rather than of the local implementation,
 * because a different driver must honour them too:
 *
 *   1. `url` is what goes into `businesses.logo_url` / `cover_image_url` /
 *      `products.image_url`, and it is a path under `/uploads/`, never an
 *      absolute filesystem path and never a `file://` URL. A row therefore
 *      survives the storage driver changing, and a stored URL can be resolved
 *      by the frontend without knowing which driver wrote it.
 *   2. `removeByStoredValue` takes the owning business id and may only ever
 *      delete a file inside that business's own folder. Anything else — an
 *      external URL, another business's file, a path outside the upload root —
 *      is ignored rather than attempted.
 */

export interface StoredObjectMetadata {
    width: number;
    height: number;
}

export interface StoredObject {
    /** Storage key: `<businessId>/<slot>/<name>`. An identifier, not a path to serve. */
    key: string;
    /** The value to persist in the `*_url` column, always `/uploads/<key>`. */
    url: string;
    /** Size of the stored object in bytes. */
    bytes: number;
    /** MIME type of the stored object. The pipeline always produces WebP. */
    contentType: string;
    width: number;
    height: number;
}

export interface StorageProvider {
    /**
     * Writes `body` under `key`, creating intermediate folders as needed.
     *
     * `metadata` carries what the image pipeline measured, so a store that wants
     * to record dimensions or a content hash can without the route knowing
     * anything about the file beyond its bytes.
     *
     * The write is atomic from a reader's point of view: content goes to a
     * temporary name inside the same folder and is renamed into place, so a
     * request that reads `/uploads/...` mid-upload sees either nothing or the
     * complete file, never a half-written one.
     */
    put(key: string, body: Buffer, contentType: string, metadata?: StoredObjectMetadata): Promise<StoredObject>;

    /** Deletes one key. Missing file is a success, not an error. */
    remove(key: string): Promise<void>;

    /** The public URL for a key. */
    publicUrl(key: string): string;

    /**
     * Deletes the file a stored column value points at, and only if it belongs
     * to `businessId`. Anything else is a silent no-op.
     */
    removeByStoredValue(stored: string | null | undefined, businessId: number): Promise<void>;
}

/** Public URL prefix. Chosen so `express.static` can mount it unchanged. */
export const UPLOADS_URL_PREFIX = '/uploads/';

/**
 * Where in a business's folder an image lives.
 *
 * `logo` and `cover` are single slots that replace each other. A product keeps
 * its own folder so one product's image is never deleted when another's is
 * replaced, and so a product can grow a gallery later without changing the
 * layout.
 */
export type ImageSlot = 'logo' | 'cover' | 'products';
