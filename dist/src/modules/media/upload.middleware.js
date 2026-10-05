/**
 * The multipart middleware for the six image routes.
 *
 * Everything is buffered in memory and never written to disk before it has been
 * validated. That is affordable here because the byte ceiling is 2–5 MB and the
 * worst case is one buffered request per concurrent upload; the alternative —
 * streaming to a temporary file and validating it afterwards — would mean
 * creating, and then having to reliably clean up, a file for every rejected
 * request, which is where "a rejected upload left a file behind" bugs come from.
 *
 * Every rejection is an `AppError`, so it reaches the single error handler and
 * is formatted like every other API failure: `{ error: { code, message, details } }`
 * with `details.field = 'file'`. multer's own errors are plain `Error`s with a
 * `code` property, and are translated here rather than being allowed to fall
 * through as an unhandled 500.
 */
import multer from 'multer';
import { AppError } from '../../db/errors.js';
import { ACCEPTED_IMAGE_FORMATS } from './image-format.js';
import { maxBytesFor } from './image-processing.js';
/** The one form field an image may arrive in. */
const FIELD_NAME = 'file';
function fileError(code, message, details) {
    return new AppError(400, code, message, { field: 'file', ...details });
}
/**
 * Reads exactly one image from a multipart body and rejects anything else.
 *
 * `kind` is what makes the size limit per-image: the logo ceiling is half the
 * cover ceiling, and a single middleware instance cannot know which route it is
 * mounted on unless it is told.
 */
export function imageUpload(kind) {
    const limit = maxBytesFor(kind);
    const parse = multer({
        storage: multer.memoryStorage(),
        limits: {
            fileSize: limit,
            files: 1,
            // No non-file fields are read by these routes. Capping them keeps a
            // caller from padding the request with hundreds of kilobytes of
            // form data that nothing will look at.
            fields: 0,
            parts: 1,
        },
    }).single(FIELD_NAME);
    return function imageUploadMiddleware(req, res, next) {
        const contentType = req.header('content-type') ?? '';
        if (!contentType.toLowerCase().startsWith('multipart/form-data')) {
            next(fileError('UNSUPPORTED_MEDIA_TYPE', `Send the image as multipart/form-data in a field named "${FIELD_NAME}". Accepted formats are ${ACCEPTED_IMAGE_FORMATS}.`, { kind, expected: 'multipart/form-data' }));
            return;
        }
        parse(req, res, (error) => {
            if (error) {
                next(translateMulterError(error, kind, limit));
                return;
            }
            const file = req.file;
            if (!file) {
                next(fileError('MISSING_FILE', `No image was uploaded. Send one file in a field named "${FIELD_NAME}".`, {
                    kind,
                    field: FIELD_NAME,
                }));
                return;
            }
            if (file.size === 0) {
                next(fileError('EMPTY_FILE', 'The uploaded file is empty.', { kind, bytes: 0 }));
                return;
            }
            req.uploadedFile = {
                buffer: file.buffer,
                size: file.size,
                // Kept only so an error message can name the file the caller
                // tried to upload. It is never used to build a path or a name.
                originalName: file.originalname,
            };
            next();
        });
    };
}
/** multer reports its limits as plain errors; the API reports them as 400s. */
function translateMulterError(error, kind, limit) {
    const code = error?.code;
    switch (code) {
        case 'LIMIT_FILE_SIZE':
            return fileError('FILE_TOO_LARGE', `The file is larger than the ${Math.round(limit / 1024 / 1024)} MB limit for a ${kind} image.`, { kind, maxBytes: limit });
        case 'LIMIT_FILE_COUNT':
        case 'LIMIT_PART_COUNT':
            return fileError('TOO_MANY_FILES', 'Send one image at a time, in a field named "file".', { kind });
        case 'LIMIT_FIELD_COUNT':
            return fileError('UNEXPECTED_FIELDS', 'Send only the image file, with no other form fields.', { kind });
        case 'LIMIT_UNEXPECTED_FILE':
            return fileError('UNEXPECTED_FIELD', 'The image must be sent in a field named "file".', { kind });
        default:
            // A malformed multipart body arrives here too, and it is the
            // caller's fault in the same way a bad image is.
            return fileError('MALFORMED_UPLOAD', 'The upload could not be read. Send the image as multipart/form-data.', {
                kind,
            });
    }
}
//# sourceMappingURL=upload.middleware.js.map