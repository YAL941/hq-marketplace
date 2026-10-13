import { DeleteObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { config } from '../../../config.js';
import { UPLOADS_URL_PREFIX, type StorageProvider, type StoredObject, type StoredObjectMetadata } from './types.js';

/** `<businessId>/<slot>/<name>`: no leading slash, no `uploads/` prefix. */
function ensureObjectKey(rawKey: string): string {
    return rawKey.replace(/^\/+/u, '').replace(/^uploads\//u, '');
}

/** The bucket key for a storage key. The `uploads/` prefix lives only here. */
function bucketKey(key: string): string {
    return `uploads/${ensureObjectKey(key)}`;
}

export class S3Storage implements StorageProvider {
    private readonly client: S3Client;

    constructor() {
        const bucket = config.S3_BUCKET;
        const region = config.S3_REGION ?? 'auto';
        const endpoint = config.S3_ENDPOINT ?? undefined;

        if (!bucket) {
            throw new Error('S3 bucket is not configured. Set S3_BUCKET before using STORAGE_DRIVER=s3');
        }
        if (!config.S3_ACCESS_KEY_ID || !config.S3_SECRET_ACCESS_KEY) {
            throw new Error('S3 credentials are not configured. Set S3_ACCESS_KEY_ID and S3_SECRET_ACCESS_KEY');
        }

        this.client = new S3Client({
            region,
            endpoint,
            forcePathStyle: config.S3_FORCE_PATH_STYLE ?? false,
            credentials: {
                accessKeyId: config.S3_ACCESS_KEY_ID,
                secretAccessKey: config.S3_SECRET_ACCESS_KEY,
            },
        });
    }

    /**
     * Always the RELATIVE path `/uploads/<key>`, whatever the driver.
     *
     * The storage contract (types.ts, rule 1) says this value is what goes into
     * the `*_url` columns, so a row survives a change of driver and stays inside
     * the managed-path rules in stored-image-url.ts. The browser reaches the
     * bucket through the frontend's `VITE_MEDIA_BASE` (set it to the public
     * bucket / CDN origin) or through a proxy that maps `/uploads/*` to the
     * bucket. Do not store an absolute URL here.
     */
    publicUrl(key: string): string {
        return `${UPLOADS_URL_PREFIX}${ensureObjectKey(key)}`;
    }

    async put(key: string, body: Buffer, contentType: string, metadata?: StoredObjectMetadata): Promise<StoredObject> {
        await this.client.send(new PutObjectCommand({
            Bucket: config.S3_BUCKET!,
            Key: bucketKey(key),
            Body: body,
            ContentType: contentType,
            CacheControl: 'public, max-age=31536000, immutable',
        }));

        return {
            key: ensureObjectKey(key),
            url: this.publicUrl(key),
            bytes: body.byteLength,
            contentType,
            width: metadata?.width ?? 0,
            height: metadata?.height ?? 0,
        };
    }

    async remove(key: string): Promise<void> {
        await this.client.send(new DeleteObjectCommand({
            Bucket: config.S3_BUCKET!,
            Key: bucketKey(key),
        }));
    }

    async removeByStoredValue(stored: string | null | undefined, businessId: number): Promise<void> {
        if (!stored) return;

        if (!stored.startsWith(UPLOADS_URL_PREFIX)) return;

        const key = stored.slice(UPLOADS_URL_PREFIX.length);
        if (key.includes('..') || !key.startsWith(`${businessId}/`)) return;

        await this.remove(key);
    }
}
