/**
 * What an uploaded file claims to be, decided from its bytes.
 *
 * Nothing here trusts a header, a filename or a `mimetype`. All three are
 * supplied by the client: the browser picks the declared type, the name is a
 * string the caller typed, and any of them can be set to anything at all. The
 * only trustworthy input is the file itself, so the three accepted formats are
 * recognised by their magic bytes:
 *
 *   JPEG  FF D8 FF                     (SOI + marker)
 *   PNG   89 50 4E 47 0D 0A 1A 0A      (full signature, 8 bytes)
 *   WebP  "RIFF" ???? "WEBP"           (RIFF container + form type at +8)
 *
 * SVG is refused on purpose. It is XML, so it can carry script, and it is
 * rendered by the browser in an image context where a script would run with the
 * page's origin. It is not on the list of accepted formats and will not be
 * added by widening this function.
 */

export type DetectedImageFormat = 'jpeg' | 'png' | 'webp';

const JPEG = Buffer.from([0xff, 0xd8, 0xff]);
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const RIFF = Buffer.from('RIFF', 'ascii');
const WEBP = Buffer.from('WEBP', 'ascii');

/**
 * Identifies an image from its leading bytes, or returns null.
 *
 * The lengths are checked before each `equals`, so a three byte file named
 * `photo.jpg` is reported as "not an image" rather than throwing.
 */
export function detectImageFormat(buffer: Buffer): DetectedImageFormat | null {
    if (buffer.length >= PNG.length && buffer.subarray(0, PNG.length).equals(PNG)) {
        return 'png';
    }
    if (buffer.length >= JPEG.length && buffer.subarray(0, JPEG.length).equals(JPEG)) {
        return 'jpeg';
    }
    if (buffer.length >= 12 && buffer.subarray(0, 4).equals(RIFF) && buffer.subarray(8, 12).equals(WEBP)) {
        return 'webp';
    }
    return null;
}

/** Human-readable list of what is accepted, used in the error message. */
export const ACCEPTED_IMAGE_FORMATS = 'JPEG, PNG or WebP';
