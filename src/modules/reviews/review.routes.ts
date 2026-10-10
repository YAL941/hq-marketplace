import { Router } from 'express';
import { z } from 'zod';
import { unauthorized } from '../../db/errors.js';
import { withTenant } from '../../db/tenant.js';
import { authenticate, contextFor } from '../../middleware/auth.js';
import { resolveBusiness } from '../../middleware/error.js';
import { rateLimiter } from '../../middleware/rate-limit.js';
import {
    createReview,
    createProductReview,
    getReviewEligibility,
    getProductReviewEligibility,
    listPublicReviews,
    listPublicProductReviews,
    listReviewsForBusiness,
    listProductReviewsForBusiness,
    moderateReview,
    moderateProductReview,
    respondToReview,
    respondToProductReview,
    type ReviewRow,
} from './review.repository.js';

const listQuerySchema = z.object({
    status: z.enum(['pending', 'published', 'rejected', 'hidden']).optional(),
    minRating: z.coerce.number().int().min(1).max(5).optional(),
    businessId: z.coerce.number().int().positive().optional(),
    limit: z.coerce.number().int().positive().max(100).optional(),
    offset: z.coerce.number().int().min(0).optional(),
});

const createSchema = z.object({
    businessId: z.number().int().positive(),
    orderId: z.number().int().positive(),
    rating: z.number().int().min(1).max(5),
    reviewText: z.string().max(4000).nullish(),
});

const productReviewCreateSchema = z.object({
    productId: z.number().int().positive(),
    orderId: z.number().int().positive(),
    rating: z.number().int().min(1).max(5),
    reviewText: z.string().max(4000).nullish(),
});

const productReviewListSchema = z.object({
    productId: z.coerce.number().int().positive(),
    limit: z.coerce.number().int().positive().max(100).optional(),
    offset: z.coerce.number().int().min(0).optional(),
});

export const reviewRoutes: Router = Router();

const writeLimiter = rateLimiter('write');

reviewRoutes.get('/reviews/eligibility/:businessId', authenticate, async (req, res, next) => {
    try {
        if (!req.user) throw unauthorized();
        const businessId = z.coerce.number().int().positive().parse(req.params['businessId']);
        const eligibility = await withTenant(contextFor(req), (client) =>
            getReviewEligibility(client, req.user!.id, businessId),
        );
        res.json({ data: eligibility });
    } catch (error) {
        next(error);
    }
});

/** Customer writes a review for a business. */
reviewRoutes.post('/reviews', writeLimiter, authenticate, async (req, res, next) => {
    try {
        if (!req.user) throw unauthorized();
        const input = createSchema.parse(req.body);
        const review = await withTenant(contextFor(req), (client) =>
            createReview(client, req.user!.id, input),
        );
        res.status(201).json({ data: review });
    } catch (error) {
        next(error);
    }
});

reviewRoutes.get('/product-reviews/eligibility/:productId', authenticate, async (req, res, next) => {
    try {
        if (!req.user) throw unauthorized();
        const productId = z.coerce.number().int().positive().parse(req.params['productId']);
        const eligibility = await withTenant(contextFor(req), (client) =>
            getProductReviewEligibility(client, req.user!.id, productId),
        );
        res.json({ data: eligibility });
    } catch (error) {
        next(error);
    }
});

reviewRoutes.post('/product-reviews', writeLimiter, authenticate, async (req, res, next) => {
    try {
        if (!req.user) throw unauthorized();
        const input = productReviewCreateSchema.parse(req.body);
        const review = await withTenant(contextFor(req), (client) =>
            createProductReview(client, req.user!.id, input),
        );
        res.status(201).json({ data: review });
    } catch (error) {
        next(error);
    }
});

/** Public: published product reviews only. */
reviewRoutes.get('/product-reviews', async (req, res, next) => {
    try {
        const q = productReviewListSchema.parse(req.query);
        const reviews = await withTenant(contextFor(req), (client) =>
            listPublicProductReviews(client, q.productId, q.limit, q.offset),
        );
        res.json({ data: reviews, meta: { count: reviews.length } });
    } catch (error) {
        next(error);
    }
});

/** Public: published reviews only (RLS enforces which business is visible). */
reviewRoutes.get('/reviews', async (req, res, next) => {
    try {
        const q = listQuerySchema.parse(req.query);
        const reviews = await withTenant(contextFor(req), (client) => listPublicReviews(client, q));
        res.json({ data: reviews, meta: { count: reviews.length } });
    } catch (error) {
        next(error);
    }
});

/** Business staff: reviews of THIS business only. */
reviewRoutes.get('/business/:businessId/reviews', authenticate, resolveBusiness, async (req, res, next) => {
    try {
        if (!req.user) throw unauthorized();
        const businessId = req.businessId!;
        const q = listQuerySchema.parse(req.query);
        const reviews = await withTenant(contextFor(req, businessId), (client) =>
            listReviewsForBusiness(client, businessId, q),
        );
        res.json({ data: reviews, meta: { count: reviews.length, businessId } });
    } catch (error) {
        next(error);
    }
});

reviewRoutes.post('/business/:businessId/reviews/:reviewId/respond', authenticate, resolveBusiness, async (req, res, next) => {
    try {
        if (!req.user) throw unauthorized();
        const businessId = req.businessId!;
        const reviewId = Number(req.params['reviewId']);
        const { response } = z.object({ response: z.string().min(1).max(4000) }).parse(req.body);
        const review: ReviewRow = await withTenant(contextFor(req, businessId), (client) =>
            respondToReview(client, businessId, reviewId, response),
        );
        res.json({ data: review });
    } catch (error) {
        next(error);
    }
});

reviewRoutes.patch('/business/:businessId/reviews/:reviewId/moderate', authenticate, resolveBusiness, async (req, res, next) => {
    try {
        if (!req.user) throw unauthorized();
        const businessId = req.businessId!;
        const reviewId = Number(req.params['reviewId']);
        const { status } = z.object({ status: z.enum(['published', 'hidden']) }).parse(req.body);
        const review = await withTenant(contextFor(req, businessId), (client) =>
            moderateReview(client, businessId, reviewId, status),
        );
        res.json({ data: review });
    } catch (error) {
        next(error);
    }
});

reviewRoutes.get('/business/:businessId/product-reviews', authenticate, resolveBusiness, async (req, res, next) => {
    try {
        if (!req.user) throw unauthorized();
        const businessId = req.businessId!;
        const q = listQuerySchema.pick({ status: true, limit: true, offset: true }).parse(req.query);
        const reviews = await withTenant(contextFor(req, businessId), (client) =>
            listProductReviewsForBusiness(client, businessId, q),
        );
        res.json({ data: reviews, meta: { count: reviews.length, businessId } });
    } catch (error) {
        next(error);
    }
});

reviewRoutes.patch('/business/:businessId/product-reviews/:reviewId/moderate', authenticate, resolveBusiness, async (req, res, next) => {
    try {
        if (!req.user) throw unauthorized();
        const businessId = req.businessId!;
        const reviewId = z.coerce.number().int().positive().parse(req.params['reviewId']);
        const { status } = z.object({ status: z.enum(['published', 'hidden']) }).parse(req.body);
        const review = await withTenant(contextFor(req, businessId), (client) =>
            moderateProductReview(client, businessId, reviewId, status),
        );
        res.json({ data: review });
    } catch (error) {
        next(error);
    }
});

reviewRoutes.post('/business/:businessId/product-reviews/:reviewId/respond', authenticate, resolveBusiness, async (req, res, next) => {
    try {
        if (!req.user) throw unauthorized();
        const businessId = req.businessId!;
        const reviewId = z.coerce.number().int().positive().parse(req.params['reviewId']);
        const { response } = z.object({ response: z.string().min(1).max(4000) }).parse(req.body);
        const review = await withTenant(contextFor(req, businessId), (client) =>
            respondToProductReview(client, businessId, reviewId, response),
        );
        res.json({ data: review });
    } catch (error) {
        next(error);
    }
});
