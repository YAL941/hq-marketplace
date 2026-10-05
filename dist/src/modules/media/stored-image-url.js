/**
 * What a `*_url` column is allowed to hold.
 *
 * Two shapes are legal and nothing else:
 *
 *   * an external `http(s)` URL, which is what the columns already accepted and
 *     what an existing row may already hold; and
 *   * a managed upload path, `/uploads/<businessId>/<slot>/<32 hex>.webp`, which
 *     is what the upload routes write.
 *
 * Two things are deliberately stricter than the schema this replaces. The old
 * one was `z.string().url()`, which accepts `javascript:alert(1)` and
 * `file:///etc/passwd` just as readily as an image address — and the value ends
 * up in an `<img src>` in a visitor's browser. And a managed path has to name
 * *this* business: the row is written through a route that already resolved the
 * caller's membership, so accepting `/uploads/<someone else>/...` would let one
 * business point at another business's file and have it deleted the next time it
 * replaced its own.
 *
 * The `<businessId>` compared here is therefore the id the route resolved from
 * the path and proved membership for, never the one in the body.
 */
import { z } from 'zod';
/**
 * A managed upload path: `/uploads/<businessId>/<slot...>/<32 hex>.webp`.
 *
 * The slot alternatives mirror `buildImageKey`: `logo`, `cover`, or
 * `products/<productId>`. The random name is part of the pattern on purpose, so
 * the column cannot be pointed at a hand-picked file inside the upload root.
 */
const MANAGED_PATH = /^\/uploads\/(\d+)\/(?:logo|cover|products\/\d+)\/[0-9a-f]{32}\.webp$/;
const NOT_A_MANAGED_PATH = 'A stored image must be a path this API produced: /uploads/<businessId>/<slot>/<name>.webp';
const ANOTHER_BUSINESS = 'That image path belongs to another business';
const NOT_A_URL = 'Must be an http or https URL, or an uploaded image path';
const BAD_PROTOCOL = 'Only http and https URLs are accepted';
/** Reports what is wrong with a value, or an empty array when it is fine. */
export function imageUrlProblems(businessId, value) {
    if (value.startsWith('/')) {
        const match = MANAGED_PATH.exec(value);
        if (!match)
            return [NOT_A_MANAGED_PATH];
        return match[1] === String(businessId) ? [] : [ANOTHER_BUSINESS];
    }
    let url;
    try {
        url = new URL(value);
    }
    catch {
        return [NOT_A_URL];
    }
    return url.protocol === 'http:' || url.protocol === 'https:' ? [] : [BAD_PROTOCOL];
}
function check(businessId) {
    return (value, ctx) => {
        for (const message of imageUrlProblems(businessId, value)) {
            ctx.addIssue({ code: z.ZodIssueCode.custom, message });
        }
    };
}
/**
 * An image column on a row belonging to `businessId`, clearable with `null`.
 *
 * `nullish()` rather than `optional()`: clearing an image is a normal part of
 * the profile PATCH. An empty string is still rejected, because `''` renders as
 * a broken image rather than as no image.
 */
export function managedImageUrlSchema(businessId) {
    return z.string().trim().min(1).max(500).superRefine(check(businessId)).nullish();
}
/** The same rule for a create body, where the column may simply be absent. */
export function optionalManagedImageUrlSchema(businessId) {
    return z.string().trim().min(1).max(500).superRefine(check(businessId)).optional();
}
//# sourceMappingURL=stored-image-url.js.map