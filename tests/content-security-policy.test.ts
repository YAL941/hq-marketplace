/**
 * Content Security Policy.
 *
 * The reason this file exists is the `/uploads` mount. Every other response
 * here is JSON produced by this project, and a policy is straightforward
 * defence in depth for it. Stored uploads are different: they are user-supplied
 * bytes, and an SVG is a document a browser will execute. Served from the API's
 * own origin, a stored SVG is therefore an execution context on that origin —
 * the same origin a session cookie would belong to.
 *
 * So the two kinds of response get two policies, and the tests below check the
 * ones that matter:
 *
 *   * the upload policy denies everything *and* sandboxes the document, so an
 *     SVG cannot script, cannot load a payload, and cannot touch the opener;
 *   * the API policy denies everything, which is available because nothing this
 *     API returns is ever rendered as a document;
 *   * a 404 for a missing upload does *not* get the upload policy, because there
 *     are no user bytes in it to contain;
 *   * and none of this changes how an image actually loads, which is the one
 *     thing that must not regress — the frontend embeds these URLs in `<img>`
 *     tags and they have to keep rendering.
 */

process.env['NODE_ENV'] = 'test';
process.env['PGDATABASE'] = process.env['TEST_PGDATABASE'] ?? 'hq_marketplace_test';
process.env['JWT_SECRET'] = process.env['JWT_SECRET'] ?? 'test-secret-that-is-long-enough-123';

import assertModule from 'node:assert/strict';
import { before, describe, it } from 'node:test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import request from 'supertest';

const assert: typeof assertModule = assertModule;

type App = import('express').Express;
type CreateApp = typeof import('../src/app.js').createApp;

let createApp: CreateApp;
let adminPool: import('pg').Pool;
let closePools: () => Promise<void>;
let uploadRoot: () => string;
let apiPolicy: string;
let uploadPolicy: string;

/**
 * The policy a response actually carried, as a directive map.
 *
 * Parsed rather than string-compared, because the directives are the contract
 * and the formatting is not: a test that asserted one exact header string would
 * fail on a harmless reorder and pass on a genuinely missing directive if the
 * order happened to line up.
 */
function parsePolicy(header: unknown): Map<string, string[]> {
    assert.equal(typeof header, 'string', `expected a CSP header, got ${JSON.stringify(header)}`);

    const directives = new Map<string, string[]>();
    for (const part of (header as string).split(';')) {
        const trimmed = part.trim();
        if (trimmed === '') continue;

        const [name, ...values] = trimmed.split(/\s+/);
        directives.set(name!, values);
    }
    return directives;
}

/** Writes a file into the upload root and returns the URL that serves it. */
function placeUpload(name: string, contents: string, mimeExtension: string): string {
    const dir = join(uploadRoot(), 'csp-fixture');
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, `${name}${mimeExtension}`), contents);
    return `/uploads/csp-fixture/${name}${mimeExtension}`;
}

before(async () => {
    const csp = await import('../src/middleware/csp.js');
    apiPolicy = csp.API_CONTENT_SECURITY_POLICY;
    uploadPolicy = csp.UPLOAD_CONTENT_SECURITY_POLICY;

    const poolModule = await import('../src/db/pool.js');
    adminPool = poolModule.adminPool;
    closePools = poolModule.closePools;
    createApp = (await import('../src/app.js')).createApp;
    uploadRoot = (await import('../src/modules/media/storage/local-disk.js')).uploadRoot;

    const { prepareTestDatabase } = await import('./helpers/test-database.js');
    await prepareTestDatabase(adminPool);
});

describe('the policy on API responses', () => {
    let app: App;

    before(() => {
        app = createApp();
    });

    it('is on a JSON response', async () => {
        const res = await request(app).get('/api/businesses');
        assert.ok(res.headers['content-security-policy'], 'no CSP header on a JSON response');
    });

    it('denies everything by default', async () => {
        // The API returns JSON that no browser treats as a document, so there is
        // no legitimate reason to let a response load or execute anything. This
        // is stricter than the policy people normally write out.
        const res = await request(app).get('/api/businesses');
        const directives = parsePolicy(res.headers['content-security-policy']);

        assert.deepEqual(directives.get('default-src'), ["'none'"]);
    });

    it('forbids the things that turn a response into an execution context', async () => {
        const res = await request(app).get('/api/businesses');
        const directives = parsePolicy(res.headers['content-security-policy']);

        for (const directive of ['script-src', 'object-src', 'base-uri', 'form-action']) {
            assert.deepEqual(
                directives.get(directive),
                ["'none'"],
                `${directive} should be denied, got ${JSON.stringify(directives.get(directive))}`,
            );
        }
        assert.deepEqual(directives.get('frame-ancestors'), ["'none'"]);
    });

    it('replaces helmet\'s default policy rather than sitting beside it', async () => {
        // Two CSP headers are combined by the browser, taking the intersection —
        // so a stray helmet default would silently tighten the policy and make
        // this file's other assertions describe something other than what ships.
        const res = await request(app).get('/api/businesses');
        const header = res.headers['content-security-policy'] as string;
        assert.equal(header, apiPolicy, 'the response should carry exactly the API policy');
        assert.ok(
            !header.includes("script-src 'self'"),
            `helmet's default script-src leaked through: ${header}`,
        );
    });

    it('keeps helmet\'s other protections', async () => {
        // Only the policy was replaced. Everything helmet does that is not a CSP
        // — nosniff, frame options, referrer policy — has to survive, or
        // swapping one header out has quietly undone the rest.
        const res = await request(app).get('/api/businesses');
        assert.equal(res.headers['x-content-type-options'], 'nosniff');
        assert.ok(res.headers['x-frame-options'], 'X-Frame-Options was dropped');
        assert.ok(res.headers['referrer-policy'], 'Referrer-Policy was dropped');
    });

    it('is on an error response too', async () => {
        // Errors are as likely to be rendered as anything else, and a missing
        // header on the 500 path is exactly where a policy would be missed.
        const res = await request(app).get('/api/does-not-exist');
        assert.equal(res.status, 404);
        assert.ok(res.headers['content-security-policy']);
    });

    it('is on the service index', async () => {
        const res = await request(app).get('/api');
        assert.equal(res.status, 200);
        assert.equal(res.headers['content-security-policy'], apiPolicy);
    });
});

describe('the policy on stored uploads', () => {
    let app: App;

    before(() => {
        app = createApp();
    });

    it('sandboxes the document, with no allowances', async () => {
        // The load-bearing directive. An empty `sandbox` gives the document a
        // unique opaque origin: no scripts, no popups, no form submission, no
        // access to `window.opener`. It is what stops an uploaded SVG being an
        // execution context on the API's origin.
        const url = placeUpload('image', '<svg xmlns="http://www.w3.org/2000/svg"/>', '.svg');
        const res = await request(app).get(url);

        assert.equal(res.status, 200);
        const directives = parsePolicy(res.headers['content-security-policy']);

        assert.ok(directives.has('sandbox'), `no sandbox directive in: ${res.headers['content-security-policy']}`);
        assert.deepEqual(directives.get('sandbox'), [], 'sandbox must grant no allowances');
    });

    it('denies loading anything from anywhere', async () => {
        const url = placeUpload('loader', '<svg xmlns="http://www.w3.org/2000/svg"/>', '.svg');
        const res = await request(app).get(url);
        const directives = parsePolicy(res.headers['content-security-policy']);

        assert.deepEqual(directives.get('default-src'), ["'none'"]);
        assert.deepEqual(directives.get('base-uri'), ["'none'"]);
        assert.deepEqual(directives.get('form-action'), ["'none'"]);
    });

    it('is stricter than the policy on API responses', async () => {
        const url = placeUpload('compare', '<svg xmlns="http://www.w3.org/2000/svg"/>', '.svg');
        const res = await request(app).get(url);

        assert.notEqual(
            res.headers['content-security-policy'],
            apiPolicy,
            'user-supplied bytes must not get the same policy as this project\'s own responses',
        );
    });

    it('does not apply to a 404, where there are no user bytes to contain', async () => {
        // `setHeaders` only runs for a file that was found. The right policy for
        // a missing upload is the API one, because the response is not made of
        // anything the user chose.
        const res = await request(app).get('/uploads/csp-fixture/never-uploaded.png');

        assert.equal(res.status, 404);
        assert.equal(res.headers['content-security-policy'], apiPolicy);
    });

    it('applies to a stored file whatever its type', async () => {
        // The policy must not depend on the extension: the point is that the
        // content is user-supplied, not that it happened to be named `.svg`.
        const png = placeUpload('pixels', 'not really a png', '.png');
        const res = await request(app).get(png);

        assert.equal(res.status, 200);
        assert.equal(res.headers['content-security-policy'], uploadPolicy);
    });
});

describe('what the upload policy must not break', () => {
    let app: App;

    before(() => {
        app = createApp();
    });

    it('still serves the bytes with the right content type', async () => {
        // The whole point of these files is that the frontend can display them.
        // An `<img>` request is not a document, so the policy is not consulted
        // for it — but only if the file is still served correctly.
        const contents = 'bytes-that-stand-in-for-a-jpeg';
        const url = placeUpload('displayable', contents, '.jpg');
        const res = await request(app).get(url).buffer(true).parse((response, callback) => {
            const chunks: Buffer[] = [];
            response.on('data', (chunk: Buffer) => chunks.push(chunk));
            response.on('end', () => callback(null, Buffer.concat(chunks)));
        });

        assert.equal(res.status, 200);
        assert.match(res.headers['content-type'] ?? '', /image\/jpeg/);
        assert.equal(res.body.toString('utf8'), contents);
    });

    it('keeps cross-origin resource sharing open', async () => {
        // The frontend is served from a different origin in development, and an
        // `<img>` is a `no-cors` request filtered by CORP rather than by CORS.
        // Tightening CSP does not justify turning this off.
        const url = placeUpload('shared', 'bytes', '.png');
        const res = await request(app).get(url);

        assert.equal(res.headers['cross-origin-resource-policy'], 'cross-origin');
    });

    it('keeps the cache headers that make stored names safe', async () => {
        const url = placeUpload('cached', 'bytes', '.png');
        const res = await request(app).get(url);

        assert.match(res.headers['cache-control'] ?? '', /immutable|max-age=31536000/);
    });
});