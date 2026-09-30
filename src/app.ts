import cors from 'cors';
import express, { type Express } from 'express';
import helmet from 'helmet';
import { config } from './config.js';
import { authRoutes } from './modules/auth/auth.routes.js';
import { businessRoutes } from './modules/businesses/business.routes.js';
import { locationRoutes } from './modules/locations/location.routes.js';
import { orderRoutes } from './modules/orders/order.routes.js';
import { productRoutes } from './modules/products/product.routes.js';
import { reviewRoutes } from './modules/reviews/review.routes.js';
import { serviceRoutes } from './modules/services/service.routes.js';
import { errorHandler, notFoundHandler } from './middleware/error.js';

export function createApp(): Express {
    const app = express();

    app.use(helmet());
    app.use(cors({ origin: config.corsOrigins, credentials: true }));
    app.use(express.json({ limit: '1mb' }));

    app.get('/health', async (_req, res) => {
        res.json({ status: 'ok', service: 'hq-marketplace', phase: 1 });
    });

    app.get('/api', (_req, res) => {
        res.json({
            service: 'HQ Marketplace',
            phase: 1,
            scope: 'database architecture + multi-business data isolation',
            public: [
                'GET  /api/businesses',
                'GET  /api/businesses/:businessId',
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
            ],
            note: 'Business staff routes need "Authorization: Bearer <token>" and the '
                + 'business id in the path. The id in the X-Business-Id header is '
                + 'verified against business_users; a mismatch is rejected.',
        });
    });

    app.get('/', (_req, res) => {
        res.json({
            service: 'HQ Marketplace API',
            phase: 1,
            health: '/health',
            index: '/api',
        });
    });

    app.use('/api', authRoutes);
    app.use('/api', businessRoutes);
    app.use('/api', productRoutes);
    app.use('/api', serviceRoutes);
    app.use('/api', orderRoutes);
    app.use('/api', reviewRoutes);
    app.use('/api', locationRoutes);

    app.use(notFoundHandler);
    app.use(errorHandler);

    return app;
}
