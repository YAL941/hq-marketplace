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
/** Public URL prefix. Chosen so `express.static` can mount it unchanged. */
export const UPLOADS_URL_PREFIX = '/uploads/';
//# sourceMappingURL=types.js.map