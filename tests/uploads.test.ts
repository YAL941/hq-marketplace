/**
 * Image uploads: the six routes, what they accept, and what they refuse.
 *
 * The feature is small enough to test end to end, and the interesting parts are
 * all refusals: a caller who is not a member, a caller whose role lacks the
 * permission, a file whose bytes disagree with its name, and a path that tries
 * to leave the upload directory. Each of those is a case where the API has to
 * answer with a specific status and a specific body rather than a 500, so each
 * one is asserted on its own.
 *
 * The upload root is a temporary directory created before `src/app.js` is
 * imported, because `createApp()` resolves and mounts `UPLOAD_DIR` once at
 * startup. Everything under it is removed in `after`, and the tests never write
 * into the project's own `uploads/`.
 *
 * Fixtures are generated with sharp rather than committed as binaries, so the
 * "EXIF is stripped" assertion has something real to strip and the sizes are
 * derived from the same limits the API enforces.
 */

process.env['NODE_ENV'] = 'test';
process.env['PGDATABASE'] = process.env['TEST_PGDATABASE'] ?? 'hq_marketplace_test';
process.env['JWT_SECRET'] = process.env['JWT_SECRET'] ?? 'test-secret-that-is-long-enough-123';

import assertModule from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { readFile, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, describe, it } from 'node:test';
import bcrypt from 'bcryptjs';
import request from 'supertest';
import sharp from 'sharp';

const assert: typeof assertModule = assertModule;

/** Isolated upload root for this file. Set before the app is created. */
const UPLOAD_ROOT = mkdtempSync(join(tmpdir(), 'hq-uploads-'));
process.env['UPLOAD_DIR'] = UPLOAD_ROOT;

type App = import('express').Express;
let app: App;
let adminPool: import('pg').Pool;
let closePools: () => Promise<void>;

const PASSWORD = 'Password123!';

interface Actor {
    id: number;
    token: string;
    /** Kept as a string everywhere in the request path; these are bigints. */
    businessId?: string;
    productId?: string;
}

let ownerA: Actor;
let ownerB: Actor;
let employee: Actor;

async function createUser(email: string, fullName: string): Promise<number> {
    const passwordHash = await bcrypt.hash(PASSWORD, 10);
    const { rows } = await adminPool.query<{ user_id: string }>(
        `INSERT INTO users (email, password_hash, full_name, status)
         VALUES ($1, $2, $3, 'active') RETURNING user_id`,
        [email, passwordHash, fullName],
    );
    return Number(rows[0]!.user_id);
}

async function login(email: string): Promise<string> {
    const res = await request(app).post('/api/auth/login').send({ email, password: PASSWORD });
    if (res.status !== 200) throw new Error(`login failed for ${email}: ${JSON.stringify(res.body)}`);
    return res.body.data.token as string;
}

async function actor(email: string, fullName: string): Promise<Actor> {
    const id = await createUser(email, fullName);
    return { id, token: await login(email) };
}

async function registerBusiness(token: string, body: Record<string, unknown>) {
    return request(app).post('/api/businesses/register').set('Authorization', `Bearer ${token}`).send(body);
}

async function addMember(businessId: number, userId: number, roleKey: string): Promise<void> {
    const { rows } = await adminPool.query<{ role_id: string }>(
        `SELECT role_id FROM roles WHERE role_key = $1 AND scope = 'business'`,
        [roleKey],
    );
    await adminPool.query(
        `INSERT INTO business_users (business_id, user_id, role_id, status, joined_at)
         VALUES ($1, $2, $3, 'active', now())`,
        [businessId, userId, rows[0]!.role_id],
    );
}

async function createProduct(token: string, businessId: string, name: string): Promise<string> {
    const res = await request(app)
        .post(`/api/business/${businessId}/products`)
        .set('Authorization', `Bearer ${token}`)
        .send({ productName: name, price: 10, currency: 'USD', status: 'active' });
    assert.equal(res.status, 201, `product creation failed: ${JSON.stringify(res.body)}`);
    return res.body.data.product_id as string;
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const solid = (width: number, height: number, colour: { r: number; g: number; b: number }) =>
    sharp({ create: { width, height, channels: 3, background: colour } });

/** A JPEG carrying EXIF, so "metadata is stripped" has something to strip. */
async function jpegWithExif(): Promise<Buffer> {
    return solid(640, 480, { r: 200, g: 40, b: 40 })
        .jpeg({ quality: 90 })
        .withExif({ IFD0: { Copyright: 'Confidential-HQ-Marker' } })
        .toBuffer();
}

function png(): Promise<Buffer> {
    return solid(300, 200, { r: 20, g: 90, b: 200 }).png().toBuffer();
}

function webp(): Promise<Buffer> {
    return solid(300, 200, { r: 20, g: 200, b: 90 }).webp().toBuffer();
}

/** Random noise, so it does not compress: larger than the 2 MB logo ceiling. */
function oversizePng(): Promise<Buffer> {
    return sharp({
        create: {
            width: 1100,
            height: 1100,
            channels: 3,
            background: { r: 128, g: 128, b: 128 },
            noise: { type: 'gaussian', mean: 128, sigma: 40 },
        },
    })
        .png({ compressionLevel: 0 })
        .toBuffer();
}

const TEXT_FILE = Buffer.from('This is not an image, whatever the file is called.\n', 'utf8');

const SVG_FILE = Buffer.from(
    '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10">' +
        '<script>alert(1)</script><rect width="10" height="10"/></svg>',
    'utf8',
);

const PDF_FILE = Buffer.from('%PDF-1.4\n1 0 obj\n<< /Type /Catalog >>\nendobj\ntrailer\n%%EOF\n', 'latin1');

/** The file behind a stored URL, read from the isolated upload root. */
async function storedFile(storedUrl: string): Promise<Buffer> {
    assert.ok(storedUrl.startsWith('/uploads/'), `not a managed path: ${storedUrl}`);
    return readFile(join(UPLOAD_ROOT, storedUrl.slice('/uploads/'.length)));
}

async function exists(storedUrl: string): Promise<boolean> {
    try {
        await stat(join(UPLOAD_ROOT, storedUrl.slice('/uploads/'.length)));
        return true;
    } catch {
        return false;
    }
}

const putLogo = (businessId: string, token: string | null, body: Buffer, name = 'logo.png') =>
    token === null
        ? request(app).put(`/api/business/${businessId}/logo`).attach('file', body, name)
        : request(app)
              .put(`/api/business/${businessId}/logo`)
              .set('Authorization', `Bearer ${token}`)
              .attach('file', body, name);

// ---------------------------------------------------------------------------

before(async () => {
    app = (await import('../src/app.js')).createApp();
    const poolModule = await import('../src/db/pool.js');
    adminPool = poolModule.adminPool;
    closePools = poolModule.closePools;
    const { prepareTestDatabase } = await import('./helpers/test-database.js');
    await prepareTestDatabase(adminPool);

    ownerA = await actor('uploads-owner-a@hq.test', 'Uploads Owner A');
    ownerB = await actor('uploads-owner-b@hq.test', 'Uploads Owner B');
    employee = await actor('uploads-employee@hq.test', 'Uploads Employee');

    const a = await registerBusiness(ownerA.token, {
        businessName: 'Uploads Grill House',
        phone: '61 000 0011',
        city: 'Mogadishu',
    });
    assert.equal(a.status, 201, `owner A registration failed: ${JSON.stringify(a.body)}`);
    ownerA.businessId = a.body.data.business_id as string;

    const b = await registerBusiness(ownerB.token, {
        businessName: 'Uploads Bookshop',
        email: 'uploads-owner-b@hq.test',
        city: 'Hargeisa',
    });
    assert.equal(b.status, 201, `owner B registration failed: ${JSON.stringify(b.body)}`);
    ownerB.businessId = b.body.data.business_id as string;

    // The employee holds `products.edit` but not `business.edit`, which is
    // exactly the split the two permission keys rely on.
    await addMember(Number(ownerA.businessId), employee.id, 'business_employee');

    ownerA.productId = await createProduct(ownerA.token, ownerA.businessId, 'Uploads Product One');
    ownerB.productId = await createProduct(ownerB.token, ownerB.businessId, 'Uploads Product Two');

    // A dotfile inside the upload root, to prove `dotfiles: 'deny'` is on.
    writeFileSync(join(UPLOAD_ROOT, '.hidden'), 'should never be served', 'utf8');
});

after(async () => {
    await closePools?.();
    rmSync(UPLOAD_ROOT, { recursive: true, force: true });
});

describe('PUT /api/business/:businessId/logo: who may upload', () => {
    it('refuses an anonymous caller with 401', async () => {
        const res = await putLogo(ownerA.businessId!, null, await png());
        assert.equal(res.status, 401);
        assert.equal(res.body.error.code, 'UNAUTHORIZED');
    });

    it('refuses a member of another business with 403', async () => {
        const res = await putLogo(ownerA.businessId!, ownerB.token, await png());
        assert.equal(res.status, 403);
        assert.match(res.body.error.message, /not a member/i);
    });

    it('refuses a member whose role lacks business.edit, with 403', async () => {
        const res = await putLogo(ownerA.businessId!, employee.token, await png());
        assert.equal(res.status, 403);
        assert.match(res.body.error.message, /business\.edit/);
    });

    it('leaves the column untouched when the upload is refused', async () => {
        const { rows } = await adminPool.query<{ logo_url: string | null }>(
            'SELECT logo_url FROM businesses WHERE business_id = $1',
            [ownerA.businessId],
        );
        assert.equal(rows[0]!.logo_url, null);
    });
});

describe('PUT /api/business/:businessId/logo: what may be uploaded', () => {
    it('rejects a plain text file with 400 and details.field = file', async () => {
        const res = await putLogo(ownerA.businessId!, ownerA.token, TEXT_FILE, 'notes.txt');
        assert.equal(res.status, 400);
        assert.equal(res.body.error.code, 'UNSUPPORTED_IMAGE_TYPE');
        assert.equal(res.body.error.details.field, 'file');
    });

    it('rejects SVG content with 400, whatever it is named', async () => {
        const res = await putLogo(ownerA.businessId!, ownerA.token, SVG_FILE, 'logo.svg');
        assert.equal(res.status, 400);
        assert.equal(res.body.error.code, 'UNSUPPORTED_IMAGE_TYPE');
    });

    it('rejects a PDF renamed to .png, because the bytes decide', async () => {
        const res = await putLogo(ownerA.businessId!, ownerA.token, PDF_FILE, 'logo.png');
        assert.equal(res.status, 400);
        assert.equal(res.body.error.code, 'UNSUPPORTED_IMAGE_TYPE');
    });

    it('rejects a logo over 2 MB with 400 before it is buffered whole', async () => {
        const big = await oversizePng();
        assert.ok(big.byteLength > 2 * 1024 * 1024, 'fixture must exceed the logo ceiling');
        const res = await putLogo(ownerA.businessId!, ownerA.token, big, 'huge.png');
        assert.equal(res.status, 400);
        assert.equal(res.body.error.code, 'FILE_TOO_LARGE');
        assert.equal(res.body.error.details.field, 'file');
        assert.equal(res.body.error.details.maxBytes, 2 * 1024 * 1024);
    });

    it('rejects a small file that declares more than 40 megapixels', async () => {
        // 8000x6000 is 48 MP and compresses to a few hundred kilobytes, which
        // is the whole point: the byte ceiling cannot catch a decompression
        // bomb, so the pixel count is checked separately.
        const bomb = await sharp({
            create: { width: 8000, height: 6000, channels: 3, background: { r: 30, g: 90, b: 200 } },
        })
            .jpeg({ quality: 60 })
            .toBuffer();
        assert.ok(bomb.byteLength < 2 * 1024 * 1024, 'the fixture must stay under the byte ceiling');

        const res = await putLogo(ownerA.businessId!, ownerA.token, bomb, 'wide.jpg');
        assert.equal(res.status, 400);
        assert.equal(res.body.error.code, 'IMAGE_TOO_LARGE');
        assert.equal(res.body.error.details.field, 'file');
        assert.equal(res.body.error.details.maxPixels, 40_000_000);
    });

    it('rejects a request that is not multipart at all', async () => {
        const res = await request(app)
            .put(`/api/business/${ownerA.businessId}/logo`)
            .set('Authorization', `Bearer ${ownerA.token}`)
            .send({ nope: true });
        assert.equal(res.status, 400);
        assert.equal(res.body.error.code, 'UNSUPPORTED_MEDIA_TYPE');
    });

    it('refuses a multipart body that carries fields but no file', async () => {
        const res = await request(app)
            .put(`/api/business/${ownerA.businessId}/logo`)
            .set('Authorization', `Bearer ${ownerA.token}`)
            .field('title', 'no file here');
        assert.equal(res.status, 400);
        assert.equal(res.body.error.code, 'UNEXPECTED_FIELDS');
    });

    it('refuses an empty multipart body with MISSING_FILE', async () => {
        const res = await request(app)
            .put(`/api/business/${ownerA.businessId}/logo`)
            .set('Authorization', `Bearer ${ownerA.token}`)
            .set('Content-Type', 'multipart/form-data; boundary=hqboundary')
            .send('--hqboundary--');
        assert.equal(res.status, 400);
        assert.equal(res.body.error.code, 'MISSING_FILE');
        assert.equal(res.body.error.details.field, 'file');
    });

    it('writes a WebP under the business folder and stores the path', async () => {
        const res = await putLogo(ownerA.businessId!, ownerA.token, await jpegWithExif(), 'photo.jpg');
        assert.equal(res.status, 200, JSON.stringify(res.body));

        const logoUrl = res.body.data.logo_url as string;
        assert.match(logoUrl, new RegExp(`^/uploads/${ownerA.businessId}/logo/[0-9a-f]{32}\\.webp$`));

        const stored = await storedFile(logoUrl);
        const metadata = await sharp(stored).metadata();
        assert.equal(metadata.format, 'webp', 'the stored file must be WebP');
    });

    it('strips the EXIF the uploaded file carried', async () => {
        const { rows } = await adminPool.query<{ logo_url: string }>(
            'SELECT logo_url FROM businesses WHERE business_id = $1',
            [ownerA.businessId],
        );
        const stored = await storedFile(rows[0]!.logo_url);
        const metadata = await sharp(stored).metadata();
        assert.equal(metadata.exif, undefined, 'no EXIF block may survive the pipeline');
        assert.ok(
            !stored.includes(Buffer.from('Confidential-HQ-Marker', 'utf8')),
            'the EXIF value must not be present anywhere in the stored bytes',
        );
    });

    it('resizes to the 512 px logo ceiling without enlarging a small image', async () => {
        const res = await putLogo(ownerA.businessId!, ownerA.token, await png(), 'small.png');
        assert.equal(res.status, 200);
        const metadata = await sharp(await storedFile(res.body.data.logo_url)).metadata();
        assert.equal(metadata.width, 300, 'a 300 px wide image must stay 300 px wide');
    });
});

describe('PUT /api/business/:businessId/logo: replacing an image', () => {
    it('stores a new name and deletes the file it replaced', async () => {
        const { rows: beforeRows } = await adminPool.query<{ logo_url: string }>(
            'SELECT logo_url FROM businesses WHERE business_id = $1',
            [ownerA.businessId],
        );
        const previous = beforeRows[0]!.logo_url;

        const res = await putLogo(ownerA.businessId!, ownerA.token, await webp(), 'again.webp');
        assert.equal(res.status, 200);
        const current = res.body.data.logo_url as string;

        assert.notEqual(current, previous, 'a replacement must not reuse the old URL');
        assert.equal(await exists(previous), false, 'the replaced file must be gone from disk');
        assert.equal(await exists(current), true);
    });

    it('leaves exactly one file in the logo slot', async () => {
        const { rows } = await adminPool.query<{ logo_url: string }>(
            'SELECT logo_url FROM businesses WHERE business_id = $1',
            [ownerA.businessId],
        );
        const storedUrl = rows[0]!.logo_url;
        const { readdir } = await import('node:fs/promises');
        const files = await readdir(join(UPLOAD_ROOT, ownerA.businessId!, 'logo'));
        assert.equal(files.length, 1, `expected one file, found ${files.join(', ')}`);
        assert.equal(`/uploads/${ownerA.businessId}/logo/${files[0]}`, storedUrl);
    });
});

describe('GET /uploads: serving the stored files', () => {
    it('serves the image as image/webp with an immutable cache', async () => {
        const { rows } = await adminPool.query<{ logo_url: string }>(
            'SELECT logo_url FROM businesses WHERE business_id = $1',
            [ownerA.businessId],
        );
        const res = await request(app).get(rows[0]!.logo_url);
        assert.equal(res.status, 200);
        assert.equal(res.headers['content-type'], 'image/webp');
        assert.match(res.headers['cache-control'] ?? '', /immutable/);
        assert.match(res.headers['cache-control'] ?? '', /max-age=\d{6,}/);
        assert.equal(res.headers['cross-origin-resource-policy'], 'cross-origin');
    });

    it('does not shadow /api', async () => {
        assert.equal((await request(app).get('/api')).status, 200);
        assert.equal((await request(app).get('/health')).status, 200);
        const missing = await request(app).get('/api/not-a-route');
        assert.equal(missing.status, 404);
        assert.equal(missing.body.error.code, 'NOT_FOUND');
    });

    it('404s an unknown key with the API error body, not an HTML page', async () => {
        const res = await request(app).get(`/uploads/${ownerA.businessId}/logo/00000000000000000000000000000000.webp`);
        assert.equal(res.status, 404);
        assert.equal(res.body.error.code, 'NOT_FOUND');
    });

    it('denies dotfiles inside the upload root', async () => {
        const res = await request(app).get('/uploads/.hidden');
        assert.equal(res.status, 404);
        assert.ok(!String(res.text).includes('should never be served'));
    });

    it('does not leak a file outside the upload root', async () => {
        const attempts = [
            '/uploads/../../.env',
            '/uploads/%2e%2e%2f%2e%2e%2f.env',
            '/uploads/..%2f..%2f.env',
            '/uploads/..\\..\\.env',
        ];
        for (const path of attempts) {
            const res = await request(app).get(path);
            assert.equal(res.status, 404, `${path} answered ${res.status}`);
            assert.ok(
                !String(res.text).includes('JWT_SECRET') && !String(res.text).includes('PGPASSWORD'),
                `${path} leaked environment content`,
            );
        }
    });
});

describe('DELETE /api/business/:businessId/logo', () => {
    it('clears the column and removes the file', async () => {
        const { rows } = await adminPool.query<{ logo_url: string }>(
            'SELECT logo_url FROM businesses WHERE business_id = $1',
            [ownerA.businessId],
        );
        const previous = rows[0]!.logo_url;

        const res = await request(app)
            .delete(`/api/business/${ownerA.businessId}/logo`)
            .set('Authorization', `Bearer ${ownerA.token}`);
        assert.equal(res.status, 204);
        assert.equal(await exists(previous), false);
        assert.equal((await request(app).get(previous)).status, 404);

        const { rows: afterRows } = await adminPool.query<{ logo_url: string | null }>(
            'SELECT logo_url FROM businesses WHERE business_id = $1',
            [ownerA.businessId],
        );
        assert.equal(afterRows[0]!.logo_url, null);
    });

    it('is a no-op when there is nothing to remove', async () => {
        const res = await request(app)
            .delete(`/api/business/${ownerA.businessId}/logo`)
            .set('Authorization', `Bearer ${ownerA.token}`);
        assert.equal(res.status, 204);
    });

    it('refuses a member of another business with 403', async () => {
        const res = await request(app)
            .delete(`/api/business/${ownerA.businessId}/logo`)
            .set('Authorization', `Bearer ${ownerB.token}`);
        assert.equal(res.status, 403);
    });
});

describe('PUT|DELETE /api/business/:businessId/cover', () => {
    it('stores a resized WebP cover and removes it again', async () => {
        const source = await solid(2400, 1200, { r: 10, g: 10, b: 120 }).jpeg({ quality: 85 }).toBuffer();
        const res = await request(app)
            .put(`/api/business/${ownerA.businessId}/cover`)
            .set('Authorization', `Bearer ${ownerA.token}`)
            .attach('file', source, 'cover.jpg');
        assert.equal(res.status, 200, JSON.stringify(res.body));

        const coverUrl = res.body.data.cover_image_url as string;
        assert.match(coverUrl, new RegExp(`^/uploads/${ownerA.businessId}/cover/[0-9a-f]{32}\\.webp$`));

        const metadata = await sharp(await storedFile(coverUrl)).metadata();
        assert.equal(metadata.format, 'webp');
        assert.equal(metadata.width, 1600, 'a 2400 px wide cover is capped at 1600');
        assert.equal(metadata.height, 800, 'the aspect ratio is kept');

        const removal = await request(app)
            .delete(`/api/business/${ownerA.businessId}/cover`)
            .set('Authorization', `Bearer ${ownerA.token}`);
        assert.equal(removal.status, 204);
        assert.equal(await exists(coverUrl), false);
    });

    it('refuses an anonymous caller', async () => {
        const res = await request(app).put(`/api/business/${ownerA.businessId}/cover`).attach('file', await png());
        assert.equal(res.status, 401);
    });

    it('refuses a member whose role lacks business.edit', async () => {
        const res = await request(app)
            .put(`/api/business/${ownerA.businessId}/cover`)
            .set('Authorization', `Bearer ${employee.token}`)
            .attach('file', await png(), 'cover.png');
        assert.equal(res.status, 403);
    });
});

describe('PUT|DELETE /api/business/:businessId/products/:productId/image', () => {
    it('stores the product image and clears it again', async () => {
        const res = await request(app)
            .put(`/api/business/${ownerA.businessId}/products/${ownerA.productId}/image`)
            .set('Authorization', `Bearer ${ownerA.token}`)
            .attach('file', await jpegWithExif(), 'product.jpg');
        assert.equal(res.status, 200, JSON.stringify(res.body));

        const imageUrl = res.body.data.image_url as string;
        assert.match(
            imageUrl,
            new RegExp(`^/uploads/${ownerA.businessId}/products/${ownerA.productId}/[0-9a-f]{32}\\.webp$`),
        );

        const metadata = await sharp(await storedFile(imageUrl)).metadata();
        assert.equal(metadata.format, 'webp');
        assert.equal(metadata.exif, undefined);

        const removal = await request(app)
            .delete(`/api/business/${ownerA.businessId}/products/${ownerA.productId}/image`)
            .set('Authorization', `Bearer ${ownerA.token}`);
        assert.equal(removal.status, 204);
        assert.equal(await exists(imageUrl), false);

        const { rows } = await adminPool.query<{ image_url: string | null }>(
            'SELECT image_url FROM products WHERE product_id = $1',
            [ownerA.productId],
        );
        assert.equal(rows[0]!.image_url, null);
    });

    it('answers 404 for a product belonging to another business', async () => {
        const res = await request(app)
            .put(`/api/business/${ownerA.businessId}/products/${ownerB.productId}/image`)
            .set('Authorization', `Bearer ${ownerA.token}`)
            .attach('file', await png(), 'product.png');
        assert.equal(res.status, 404);
        assert.equal(res.body.error.code, 'NOT_FOUND');
    });

    it('leaves no file behind for a product it refused', async () => {
        const { readdir } = await import('node:fs/promises');
        const folder = join(UPLOAD_ROOT, String(ownerA.businessId), 'products', String(ownerA.productId));
        const files = await readdir(folder).catch(() => [] as string[]);
        assert.equal(files.length, 0, `expected an empty folder, found ${files.join(', ')}`);
    });

    it('answers 404 when deleting a product image of another business', async () => {
        const res = await request(app)
            .delete(`/api/business/${ownerA.businessId}/products/${ownerB.productId}/image`)
            .set('Authorization', `Bearer ${ownerA.token}`);
        assert.equal(res.status, 404);
    });

    it('is allowed for business_employee, which holds products.edit', async () => {
        const res = await request(app)
            .put(`/api/business/${ownerA.businessId}/products/${ownerA.productId}/image`)
            .set('Authorization', `Bearer ${employee.token}`)
            .attach('file', await png(), 'product.png');
        assert.equal(res.status, 200, JSON.stringify(res.body));
        assert.match(
            res.body.data.image_url as string,
            new RegExp(`^/uploads/${ownerA.businessId}/products/${ownerA.productId}/`),
        );
    });

    it('refuses a member of another business with 403', async () => {
        const res = await request(app)
            .put(`/api/business/${ownerA.businessId}/products/${ownerA.productId}/image`)
            .set('Authorization', `Bearer ${ownerB.token}`)
            .attach('file', await png(), 'product.png');
        assert.equal(res.status, 403);
    });

    it('caps a product image at 1200 px', async () => {
        const source = await solid(2000, 1000, { r: 120, g: 10, b: 10 }).jpeg().toBuffer();
        const res = await request(app)
            .put(`/api/business/${ownerA.businessId}/products/${ownerA.productId}/image`)
            .set('Authorization', `Bearer ${ownerA.token}`)
            .attach('file', source, 'product.jpg');
        assert.equal(res.status, 200);
        const metadata = await sharp(await storedFile(res.body.data.image_url)).metadata();
        assert.equal(metadata.width, 1200);
    });
});

describe('a stored path belongs to one business only', () => {
    it('rejects a PATCH that points at another business folder with 400', async () => {
        const res = await request(app)
            .patch(`/api/business/${ownerA.businessId}`)
            .set('Authorization', `Bearer ${ownerA.token}`)
            .send({ logoUrl: `/uploads/${ownerB.businessId}/logo/${'a'.repeat(32)}.webp` });
        assert.equal(res.status, 400);
        assert.equal(res.body.error.code, 'VALIDATION_ERROR');
        assert.match(JSON.stringify(res.body.error.details), /another business/i);
    });

    it('rejects a PATCH that points at a path this API never produced', async () => {
        for (const bad of [
            `/uploads/${ownerA.businessId}/logo/../../secrets.webp`,
            `/uploads/${ownerA.businessId}/logo/nothex.webp`,
            '/uploads/1/logo/0123456789abcdef0123456789abcdef.png',
        ]) {
            const res = await request(app)
                .patch(`/api/business/${ownerA.businessId}`)
                .set('Authorization', `Bearer ${ownerA.token}`)
                .send({ logoUrl: bad });
            assert.equal(res.status, 400, `${bad} was accepted`);
        }
    });

    it('rejects unsafe schemes and malformed external URLs with the field name', async () => {
        for (const bad of [
            'javascript:alert(1)',
            'data:text/html',
            'JAVASCRIPT:alert(1)',
            ' javascript:alert(1)',
            '//evil.test',
            'ftp://evil.test/image.png',
            'file:///etc/passwd',
        ]) {
            const res = await request(app)
                .patch(`/api/business/${ownerA.businessId}`)
                .set('Authorization', `Bearer ${ownerA.token}`)
                .send({ website: bad });
            assert.equal(res.status, 400, `${bad} was accepted`);
            assert.equal(res.body.error.code, 'VALIDATION_ERROR');
            assert.ok(
                res.body.error.details.some((issue: { path: string[] }) => issue.path.includes('website')),
                `validation error did not name website: ${JSON.stringify(res.body.error.details)}`,
            );

            const product = await request(app)
                .post(`/api/business/${ownerA.businessId}/products`)
                .set('Authorization', `Bearer ${ownerA.token}`)
                .send({ productName: `Unsafe URL ${bad}`, price: 5, imageUrl: bad });
            assert.equal(product.status, 400, `${bad} was accepted as an image URL`);
            assert.ok(
                product.body.error.details.some((issue: { path: string[] }) => issue.path.includes('imageUrl')),
                `validation error did not name imageUrl: ${JSON.stringify(product.body.error.details)}`,
            );
        }
    });

    it('accepts external http and https URLs for websites and product images', async () => {
        for (const protocol of ['http', 'https']) {
            const websiteUrl = `${protocol}://business.example.test`;
            const imageUrl = `${protocol}://cdn.example.test/logo.png`;
            const business = await request(app)
                .patch(`/api/business/${ownerA.businessId}`)
                .set('Authorization', `Bearer ${ownerA.token}`)
                .send({ website: websiteUrl, logoUrl: imageUrl });
            assert.equal(business.status, 200);
            assert.equal(business.body.data.website, websiteUrl);
            assert.equal(business.body.data.logo_url, imageUrl);

            const product = await request(app)
                .post(`/api/business/${ownerA.businessId}/products`)
                .set('Authorization', `Bearer ${ownerA.token}`)
                .send({ productName: `External ${protocol} image`, price: 5, imageUrl });
            assert.equal(product.status, 201);
            assert.equal(product.body.data.image_url, imageUrl);
        }
    });

    it('accepts its own managed path back', async () => {
        const upload = await request(app)
            .put(`/api/business/${ownerA.businessId}/logo`)
            .set('Authorization', `Bearer ${ownerA.token}`)
            .attach('file', await png(), 'logo.png');
        assert.equal(upload.status, 200);
        const managed = upload.body.data.logo_url as string;

        const res = await request(app)
            .patch(`/api/business/${ownerA.businessId}`)
            .set('Authorization', `Bearer ${ownerA.token}`)
            .send({ logoUrl: managed });
        assert.equal(res.status, 200);
        assert.equal(res.body.data.logo_url, managed);
    });

    it('never deletes another business file, whatever the row claims', async () => {
        // A file that genuinely belongs to B, planted directly on disk.
        const foreignKey = `${ownerB.businessId}/logo/${'b'.repeat(32)}.webp`;
        const foreignUrl = `/uploads/${foreignKey}`;
        const { mkdir, writeFile } = await import('node:fs/promises');
        await mkdir(join(UPLOAD_ROOT, ownerB.businessId!, 'logo'), { recursive: true });
        await writeFile(join(UPLOAD_ROOT, foreignKey), 'business B logo');

        const { LocalDiskStorage } = await import('../src/modules/media/storage/local-disk.js');
        const storage = new LocalDiskStorage();
        const businessA = Number(ownerA.businessId);
        const businessB = Number(ownerB.businessId);
        await storage.removeByStoredValue(foreignUrl, businessA);
        assert.equal(await exists(foreignUrl), true, 'A removed B file while acting for A');

        await storage.removeByStoredValue('https://cdn.example.test/logo.png', businessA);
        await storage.removeByStoredValue('/etc/passwd', businessA);
        await storage.removeByStoredValue(`/uploads/../${ownerA.businessId}/logo/x.webp`, businessA);
        assert.equal(await exists(foreignUrl), true);

        // Its own folder is still removable, which is what the route relies on.
        await storage.removeByStoredValue(foreignUrl, businessB);
        assert.equal(await exists(foreignUrl), false);
    });
});

describe('a product image column accepts the same two shapes', () => {
    it('rejects another business path on create', async () => {
        const res = await request(app)
            .post(`/api/business/${ownerA.businessId}/products`)
            .set('Authorization', `Bearer ${ownerA.token}`)
            .send({
                productName: 'Uploads Rejected Product',
                price: 5,
                imageUrl: `/uploads/${ownerB.businessId}/products/1/${'c'.repeat(32)}.webp`,
            });
        assert.equal(res.status, 400);
        assert.equal(res.body.error.code, 'VALIDATION_ERROR');
    });

    it('accepts a managed path on update', async () => {
        const res = await request(app)
            .patch(`/api/business/${ownerA.businessId}/products/${ownerA.productId}`)
            .set('Authorization', `Bearer ${ownerA.token}`)
            .send({ imageUrl: `/uploads/${ownerA.businessId}/products/${ownerA.productId}/${'d'.repeat(32)}.webp` });
        assert.equal(res.status, 200);
        assert.match(res.body.data.image_url as string, /^\/uploads\//);
    });
});

describe('product archive permissions', () => {
    it('allows an owner to archive through PATCH and DELETE', async () => {
        const patchProductId = await createProduct(ownerA.token, ownerA.businessId!, 'Owner Archived by Patch');
        const patch = await request(app)
            .patch(`/api/business/${ownerA.businessId}/products/${patchProductId}`)
            .set('Authorization', `Bearer ${ownerA.token}`)
            .send({ status: 'archived' });
        assert.equal(patch.status, 200);
        assert.equal(patch.body.data.status, 'archived');

        const deleteProductId = await createProduct(ownerA.token, ownerA.businessId!, 'Owner Archived by Delete');
        const deleted = await request(app)
            .delete(`/api/business/${ownerA.businessId}/products/${deleteProductId}`)
            .set('Authorization', `Bearer ${ownerA.token}`);
        assert.equal(deleted.status, 204);
    });

    it('denies an employee with products.edit but without products.delete', async () => {
        const productId = await createProduct(ownerA.token, ownerA.businessId!, 'Employee Cannot Archive');
        const patch = await request(app)
            .patch(`/api/business/${ownerA.businessId}/products/${productId}`)
            .set('Authorization', `Bearer ${employee.token}`)
            .send({ status: 'archived' });
        assert.equal(patch.status, 403);

        const deleted = await request(app)
            .delete(`/api/business/${ownerA.businessId}/products/${productId}`)
            .set('Authorization', `Bearer ${employee.token}`);
        assert.equal(deleted.status, 403);

        const unchanged = await request(app)
            .get(`/api/business/${ownerA.businessId}/products/${productId}`)
            .set('Authorization', `Bearer ${ownerA.token}`);
        assert.equal(unchanged.status, 200);
        assert.equal(unchanged.body.data.status, 'active');
    });
});