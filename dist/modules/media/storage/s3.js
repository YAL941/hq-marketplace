import { DeleteObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { config } from '../../../config.js';
import { UPLOADS_URL_PREFIX } from './types.js';
function ensureObjectKey(rawKey) {
    return rawKey.replace(/^\/+/u, '').replace(/^uploads\//u, '');
}
export class S3Storage {
    client;
    constructor() {
        const bucket = config.S3_BUCKET;
        const region = config.S3_REGION ?? 'auto';
        const endpoint = config.S3_ENDPOINT ?? undefined;
        if (!bucket) {
            throw new Error('S3 bucket is not configured. Set S3_BUCKET before using STORAGE_DRIVER=s3');
        }
        this.client = new S3Client({
            region,
            endpoint,
            forcePathStyle: config.S3_FORCE_PATH_STYLE ?? false,
            credentials: {
                accessKeyId: config.S3_ACCESS_KEY_ID ?? '',
                secretAccessKey: config.S3_SECRET_ACCESS_KEY ?? '',
            },
        });
    }
    publicUrl(key) {
        const base = config.S3_PUBLIC_URL?.replace(/\/+$/u, '') ?? '';
        return `${base}${UPLOADS_URL_PREFIX}${ensureObjectKey(key)}`;
    }
    async put(key, body, contentType, metadata) {
        const objectKey = `uploads/${ensureObjectKey(key)}`;
        await this.client.send(new PutObjectCommand({
            Bucket: config.S3_BUCKET,
            Key: objectKey,
            Body: body,
            ContentType: contentType,
            CacheControl: 'public, max-age=31536000, immutable',
        }));
        return {
            key: objectKey,
            url: this.publicUrl(key),
            bytes: body.byteLength,
            contentType,
            width: metadata?.width ?? 0,
            height: metadata?.height ?? 0,
        };
    }
    async remove(key) {
        const objectKey = `uploads/${ensureObjectKey(key)}`;
        await this.client.send(new DeleteObjectCommand({
            Bucket: config.S3_BUCKET,
            Key: objectKey,
        }));
    }
    async removeByStoredValue(stored, businessId) {
        if (!stored)
            return;
        const publicBase = config.S3_PUBLIC_URL?.replace(/\/+$/u, '');
        let path = stored;
        if (publicBase && stored.startsWith(publicBase)) {
            path = stored.slice(publicBase.length);
        }
        const relative = path.replace(/^https?:\/\/[^/]+/u, '').replace(/^\/+/u, '');
        if (!relative.startsWith('uploads/')) {
            return;
        }
        const key = relative.slice('uploads/'.length);
        if (!key.startsWith(`${businessId}/`)) {
            return;
        }
        await this.remove(key);
    }
}
//# sourceMappingURL=s3.js.map