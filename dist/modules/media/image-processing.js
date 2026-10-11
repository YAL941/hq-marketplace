/**
 * Turning an uploaded file into the one image the site will ever serve.
 *
 * The output is always WebP, always resized to a ceiling, and always stripped of
 * metadata. Three properties are being bought here, and each one has a reason
 * that is not "smaller files":
 *
 *   * **No metadata.** sharp does not copy EXIF unless `.withMetadata()` is
 *     called, so a phone photo's GPS coordinates, camera serial and capture
 *     time never reach a public CDN path. Calling `.withMetadata()` here would
 *     undo the only part of this pipeline that is a privacy control.
 *   * **Auto-rotation.** `.rotate()` with no argument applies the EXIF
 *     orientation tag and then removes it, so the image is upright and the tag
 *     is not left behind describing a rotation that no longer applies.
 *   * **A bounded size.** `withoutEnlargement` stops a 40 px phone icon from
 *     being stretched to 1600 px, and the pixel ceiling in `readImageMetadata`
 *     stops a small file that decompresses to gigabytes.
 *
 * Nothing is cropped. `fit: 'inside'` means a logo that is not square stays the
 * shape its owner drew it in; cropping a logo to a square would cut the thing
 * off, and cropping a product photo would hide part of the product.
 */
import sharp from 'sharp';
import { config } from '../../config.js';
import { AppError } from '../../db/errors.js';
import { ACCEPTED_IMAGE_FORMATS, detectImageFormat } from './image-format.js';
/** Widest stored version of each image, in pixels. */
const MAX_WIDTH = {
    logo: 512,
    cover: 1600,
    product: 1200,
};
/** Byte ceiling per kind. Enforced twice: once while streaming, once on the buffer. */
export function maxBytesFor(kind) {
    switch (kind) {
        case 'logo':
            return config.UPLOAD_MAX_LOGO_BYTES;
        case 'cover':
            return config.UPLOAD_MAX_COVER_BYTES;
        case 'product':
            return config.UPLOAD_MAX_PRODUCT_BYTES;
    }
}
function reject(code, message, details) {
    return new AppError(400, code, message, { field: 'file', ...details });
}
/**
 * Reads the header and refuses anything that is not a single, bounded raster
 * image. Runs before the resize so a decompression bomb is rejected on its
 * declared size rather than after allocating the pixels.
 */
export async function readImageMetadata(buffer, kind) {
    let metadata;
    try {
        metadata = await sharp(buffer, { failOn: 'error' }).metadata();
    }
    catch {
        // The magic bytes already agreed this is a JPEG, PNG or WebP, so
        // reaching here means the container is truncated or corrupt.
        throw reject('UNREADABLE_IMAGE', 'The image could not be read. It may be damaged or incomplete.', {
            kind,
        });
    }
    if ((metadata.pages ?? 1) > 1) {
        // A multi-page TIFF/WebP is one file holding several images. Only the
        // first would be stored, so the caller would be told they uploaded a
        // picture and would get a different one.
        throw reject('MULTI_PAGE_IMAGE', 'Animated and multi-page images are not accepted. Upload a single image.', {
            kind,
            pages: metadata.pages ?? null,
        });
    }
    const width = metadata.width ?? 0;
    const height = metadata.height ?? 0;
    if (width <= 0 || height <= 0) {
        throw reject('UNREADABLE_IMAGE', 'The image has no usable dimensions.', { kind });
    }
    if (width * height > config.UPLOAD_MAX_PIXELS) {
        throw reject('IMAGE_TOO_LARGE', `The image is too large to process: ${width}x${height} pixels exceeds the ${config.UPLOAD_MAX_PIXELS} pixel limit.`, { kind, width, height, maxPixels: config.UPLOAD_MAX_PIXELS });
    }
    return metadata;
}
/**
 * Validates and rewrites one uploaded image.
 *
 * The order is: content type from bytes, then declared size, then the pixel
 * ceiling, then the resize. A file that is too large is refused before any
 * pixel work, and a file that is not an image is refused before it is decoded at
 * all.
 */
export async function processImage(buffer, kind) {
    const format = detectImageFormat(buffer);
    if (!format) {
        throw reject('UNSUPPORTED_IMAGE_TYPE', `Unsupported image type. Accepted formats are ${ACCEPTED_IMAGE_FORMATS}; SVG is not accepted.`, { kind, accepted: ['jpeg', 'png', 'webp'] });
    }
    const limit = maxBytesFor(kind);
    if (buffer.byteLength > limit) {
        throw reject('FILE_TOO_LARGE', `The file is ${(buffer.byteLength / 1024 / 1024).toFixed(1)} MB. The limit for a ${kind} image is ${Math.round(limit / 1024 / 1024)} MB.`, { kind, maxBytes: limit, bytes: buffer.byteLength });
    }
    await readImageMetadata(buffer, kind);
    let result;
    try {
        result = await sharp(buffer, { failOn: 'error' })
            .rotate()
            .resize({
            width: MAX_WIDTH[kind],
            fit: 'inside',
            withoutEnlargement: true,
        })
            .webp({ quality: 82, effort: 4 })
            .toBuffer({ resolveWithObject: true });
    }
    catch {
        throw reject('UNPROCESSABLE_IMAGE', 'The image could not be processed.', { kind, format });
    }
    return {
        body: result.data,
        width: result.info.width,
        height: result.info.height,
        contentType: 'image/webp',
    };
}
//# sourceMappingURL=image-processing.js.map