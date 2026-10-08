import cors from 'cors';
import express from 'express';
import helmet from 'helmet';
import { config } from './config.js';
import { adminRoutes } from './modules/admin/admin.routes.js';
import { authRoutes } from './modules/auth/auth.routes.js';
import { businessRoutes } from './modules/businesses/business.routes.js';
import { nearbyRoutes } from './modules/businesses/nearby.routes.js';
import { healthRoutes } from './modules/health/health.routes.js';
import { favoriteRoutes } from './modules/favorites/favorite.routes.js';
import { locationRoutes } from './modules/locations/location.routes.js';
import { mediaRoutes } from './modules/media/media.routes.js';
import { uploadRoot } from './modules/media/storage/local-disk.js';
import { orderRoutes } from './modules/orders/order.routes.js';
import { productRoutes } from './modules/products/product.routes.js';
import { reviewRoutes } from './modules/reviews/review.routes.js';
import { serviceRoutes } from './modules/services/service.routes.js';
import { setUploadContentSecurityPolicy, withApiContentSecurityPolicy } from './middleware/csp.js';
import { errorHandler, notFoundHandler } from './middleware/error.js';
export function createApp(options = {}) {
    const app = express();
    /**
     * Tells express how far to trust `X-Forwarded-For`, and it has to come first:
     * every later middleware that reads `req.ip` — which is every rate limiter
     * here — reads whatever this produced.
     *
     * Left unset (the value is `false`), every request through a reverse proxy
     * arrives looking like it came from the proxy itself. That does not merely
     * lose the client address in a log: the limiters key on `req.ip`, so all
     * traffic shares one counter and one abusive client can lock out every
     * visitor on the site.
     */
    app.set('trust proxy', options.trustProxyHops ?? config.trustProxyHops);
    app.set('ordersEnabled', options.ordersEnabled ?? config.ORDERS_ENABLED);
    app.use(helmet());
    /**
     * helmet's default policy is written for a service that renders HTML, so it
     * is replaced rather than merely extended. This API returns JSON, and stored
     * uploads are user-supplied bytes served from this origin — both are covered
     * in `src/middleware/csp.ts`, where the two policies and the reason they
     * differ are explained.
     */
    app.use(withApiContentSecurityPolicy());
    app.use(cors({ origin: config.corsOrigins, credentials: true }));
    app.use(express.json({ limit: '1mb' }));
    /**
     * Uploaded images, served from disk.
     *
     * Mounted before the routers and with `fallthrough` left at its default, so
     * a request for a file that does not exist carries on to the routers and
     * ends at notFoundHandler with the same JSON body as every other missing
     * route — and, just as importantly, `/api/...` never enters here at all.
     *
     * Three options are not cosmetic:
     *
     *   * `immutable` with a one year lifetime is safe because a stored name is
     *     16 random bytes and is never reused: replacing a logo produces a new
     *     URL rather than a new version of the old one, so no cache anywhere can
     *     be holding the thing that just changed.
     *   * `Cross-Origin-Resource-Policy: cross-origin` overrides helmet's
     *     `same-origin` for this mount. Without it a development page on
     *     :3000 silently fails to display an image served from :4000, because
     *     an `<img>` request is `no-cors` and is filtered by CORP rather than
     *     by CORS. CORS itself is irrelevant here: an image element never reads
     *     a response body.
     *   * `dotfiles: 'deny'`, `index: false` and `redirect: false` keep the
     *     mount from serving `.env`, a directory listing, or turning a
     *     misspelled key into a 301 that a client would follow to something
     *     else.
     */
    app.use('/uploads', express.static(uploadRoot(), {
        index: false,
        dotfiles: 'deny',
        redirect: false,
        acceptRanges: false,
        maxAge: '365d',
        immutable: true,
        setHeaders: (res) => {
            res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
            setUploadContentSecurityPolicy(res);
        },
    }));
    /**
     * Liveness and readiness, mounted before the routers.
     *
     * Before, so that neither endpoint is subject to a rate limiter. A probe runs
     * every few seconds from every instance; if it spent the same budget as a
     * user, it would be the thing that caused the outage it exists to detect.
     */
    app.use(healthRoutes());
    /**
     * Kept for the deployment that already uses it, and now an alias for
     * `/healthz` rather than a separate thing to keep in step.
     *
     * This is the one to point uptime monitoring at, and the one to give Caddy
     * if it is configured with a health check. It is unconditional — not gated on
     * the environment — because removing an endpoint a monitor already polls is
     * how an existing monitor starts reporting a false outage. `/healthz` and
     * `/readyz` are the newer, better-separated pair; use those for new setups.
     */
    app.get('/health', (_req, res) => {
        res.json({ status: 'ok', service: 'hq-marketplace', phase: 1 });
    });
    /**
     * The route index: a full map of every endpoint, with its auth level.
     *
     * Development only, and this is not obscurity for its own sake. The index
     * tells a reader exactly which endpoints exist, which parameter belongs to
     * which role, and which header has to be present — a ready-made inventory
     * for someone looking for the one route they should not be calling. It also
     * drifts out of date silently, since a new route is not required to update
     * it, so in production it is more likely to be misleading than useful.
     *
     * 404 rather than 403: there is nothing here to authorise, and pretending
     * the route exists to deny it is what turns a probe into a discovery.
     */
    // Read once, here, rather than per request. The two places that care about
    // the environment are both describing the same build, and a value that can
    // change under a running app is one whose answer is not reproducible.
    const isProduction = config.isProduction;
    if (!isProduction) {
        app.get('/api', (_req, res) => {
            res.json({
                service: 'OmniHQ',
                phase: 1,
                scope: 'database architecture + multi-business data isolation',
                public: [
                    'GET  /api/businesses',
                    'GET  /api/businesses/nearby?lat&lng&radiusKm',
                    'GET  /api/businesses/:businessId',
                    'GET  /api/businesses/slug/:businessSlug',
                    'GET  /api/businesses/:businessId/locations',
                    'GET  /api/products',
                    'GET  /api/services',
                    'GET  /api/reviews',
                ],
                authenticated: [
                    'POST /api/auth/register',
                    'POST /api/auth/login',
                    'GET  /api/auth/me',
                    'POST /api/businesses/register',
                    'POST /api/orders',
                    'GET  /api/orders/mine',
                    'POST /api/orders/mine/:orderId/cancel',
                    'POST /api/reviews',
                    'GET  /api/favorites',
                    'PUT|DELETE /api/favorites/:businessId',
                ],
                businessStaff: [
                    'GET|POST|PATCH|DELETE /api/business/:businessId/products[/:productId]',
                    'GET|POST|PATCH         /api/business/:businessId/services[/:serviceId]',
                    'GET|POST|PATCH         /api/business/:businessId/locations[/:locationId]',
                    'GET                   /api/business/:businessId/orders[/:orderId]',
                    'PATCH                 /api/business/:businessId/orders/:orderId/status',
                    'GET                   /api/business/:businessId/reviews',
                    'POST                  /api/business/:businessId/reviews/:reviewId/respond',
                    'PATCH                 /api/business/:businessId/reviews/:reviewId/moderate',
                    'PATCH                 /api/business/:businessId',
                    'GET                   /api/business/:businessId/statistics',
                    'GET|POST              /api/business/:businessId/members',
                    'GET                   /api/business/:businessId',
                    'PUT|DELETE            /api/business/:businessId/logo',
                    'PUT|DELETE            /api/business/:businessId/cover',
                    'PUT|DELETE            /api/business/:businessId/products/:productId/image',
                ],
                platformAdmin: [
                    'GET   /api/admin/businesses?status=pending|active|rejected&page&limit',
                    'PATCH /api/admin/businesses/:businessId/verification',
                ],
                note: 'Business staff routes need "Authorization: Bearer <token>" and the '
                    + 'business id in the path. The id in the X-Business-Id header is '
                    + 'verified against business_users; a mismatch is rejected. The '
                    + '/api/admin routes need the platform_admin role and nothing else does. '
                    + 'Image uploads are multipart/form-data with one field named "file"; '
                    + 'JPEG, PNG and WebP only, and the stored URL is served from /uploads.',
            });
        });
    }
    app.get('/', (_req, res) => {
        res.json({
            service: 'OmniHQ API',
            phase: 1,
            health: '/health',
            liveness: '/healthz',
            readiness: '/readyz',
            // Named as null rather than omitted when it is unavailable, so a
            // client can tell "this build has no index" from an older response.
            index: isProduction ? null : '/api',
        });
    });
    app.use('/api', authRoutes);
    app.use('/api', favoriteRoutes);
    // Mounted before businessRoutes: /businesses/nearby would otherwise be
    // captured as a :businessId by the directory router's path parameters.
    app.use('/api', nearbyRoutes);
    app.use('/api', businessRoutes);
    app.use('/api', productRoutes);
    app.use('/api', serviceRoutes);
    app.use('/api', orderRoutes);
    app.use('/api', reviewRoutes);
    app.use('/api', locationRoutes);
    app.use('/api', adminRoutes);
    app.use('/api', mediaRoutes);
    app.use(notFoundHandler);
    app.use(errorHandler);
    return app;
}
//# sourceMappingURL=app.js.map