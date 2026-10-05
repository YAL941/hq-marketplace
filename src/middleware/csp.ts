/**
 * Content Security Policy for the two kinds of response this API produces.
 *
 * There are two kinds, and they need different policies because only one of
 * them is under the project's control:
 *
 *   * JSON, produced by this code. Nothing here is ever parsed as a document,
 *     so the policy can be as close to "nothing at all" as a browser allows.
 *   * uploaded images, produced by a user. These *are* documents: an SVG is
 *     XML that a browser will execute, and it is served from the API's own
 *     origin, so anything it manages to do happens with the API's origin behind
 *     it.
 *
 * The second case is the reason this file exists. `helmet()`'s default policy
 * is a sensible general-purpose one, but it is written for an application that
 * serves its own HTML. Applied to stored uploads it would still permit
 * `default-src 'self'`, which means an uploaded SVG could load a script from
 * the API's origin — and the API's origin is also where any session cookie for
 * the API would be readable. So the upload policy below denies everything and
 * sandboxes the document, which is what turns "a user uploaded an SVG" into
 * "a user uploaded a picture of an SVG".
 */

import type { RequestHandler } from 'express';

/**
 * Serialises directives into a header value.
 *
 * Written out rather than pulled in, because the whole content of this policy
 * is the choice of directives and a library would obscure that.
 */
function buildPolicy(directives: Record<string, string[]>): string {
    return Object.entries(directives)
        .map(([directive, values]) => `${directive} ${values.join(' ')}`)
        .join('; ');
}

/**
 * For responses this code writes.
 *
 * `default-src 'none'` is the whole idea: this API returns JSON and nothing
 * that a browser treats as a document, so there is no legitimate reason for any
 * response to be allowed to load, execute or connect to anything. A stricter
 * policy than the one people usually write out, and the only one that survives
 * being copied onto a page that does render HTML.
 *
 * `connect-src 'self'` is the one relaxation, and it exists only so that the
 * policy is not so unusual that a proxy or a browser in front of it starts
 * stripping it. This API makes no outbound request of its own.
 */
export const API_CONTENT_SECURITY_POLICY = buildPolicy({
    'default-src': ["'none'"],
    'base-uri': ["'none'"],
    'form-action': ["'none'"],
    'frame-ancestors': ["'none'"],
    'object-src': ["'none'"],
    'script-src': ["'none'"],
    'style-src': ["'none'"],
    'img-src': ["'none'"],
    'connect-src': ["'self'"],
});

/**
 * For stored uploads, which are user-supplied bytes.
 *
 * `sandbox` with no allowances is the load-bearing part: it applies to the
 * response the browser builds a document out of, and an empty sandbox means that
 * document gets a unique opaque origin, cannot run scripts, cannot open
 * popups, cannot submit forms and cannot navigate the opener. It is what stops
 * an uploaded SVG being an execution context on the API's origin.
 *
 * `default-src 'none'` then stops the same document from loading anything at
 * all, including through the inline `xlink:href` an SVG would need to fetch a
 * payload from somewhere else.
 *
 * This does not affect the normal way these files are used. An `<img>` element
 * is not a document, so the policy on the image response is not consulted for
 * it, and images display exactly as before.
 */
export const UPLOAD_CONTENT_SECURITY_POLICY = buildPolicy({
    'default-src': ["'none'"],
    'sandbox': [],
    'base-uri': ["'none'"],
    'form-action': ["'none'"],
});

/**
 * Sets the API policy on a response.
 *
 * A header-setting middleware rather than a `helmet` option, because helmet
 * applies one policy to every response and the two kinds of response here need
 * different ones.
 */
export function withApiContentSecurityPolicy(): RequestHandler {
    return (_req, res, next) => {
        res.setHeader('Content-Security-Policy', API_CONTENT_SECURITY_POLICY);
        next();
    };
}

/**
 * Sets the stricter policy on a stored upload.
 *
 * Applied through `express.static`'s `setHeaders`, which runs only for files
 * that were actually found. A 404 for a missing upload therefore gets the API
 * policy rather than the upload one — the right way round, since there are no
 * user-supplied bytes in that response to contain.
 */
export function setUploadContentSecurityPolicy(res: {
    setHeader(name: string, value: string): void;
}): void {
    res.setHeader('Content-Security-Policy', UPLOAD_CONTENT_SECURITY_POLICY);
}