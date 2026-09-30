/**
 * Query parsing for the public directory.
 *
 * Every public parameter is validated here rather than in the route, so the
 * limits are in one place and a handler cannot forget the cap. The caps matter:
 * `limit` and `page` reach OFFSET in SQL, and an uncapped `limit` is a cheap
 * way for one caller to ask the database for the whole table.
 */

import { z } from 'zod';

/** Above this the pager stops offering a next page, so the cap matches. */
export const MAX_PAGE_SIZE = 50;
export const DEFAULT_PAGE_SIZE = 20;

/** A boolean query flag that also accepts the bare `?featured` form. */
const booleanFlag = z
    .union([z.literal('true'), z.literal('false'), z.literal('1'), z.literal('0')])
    .transform((v) => v === 'true' || v === '1');

/**
 * Normalises `page`/`limit`, both of which arrive as strings.
 *
 * `page` is capped rather than only validated so that a caller cannot make the
 * database walk a five billion row OFFSET.
 */
const pageSchema = z.coerce.number().int().min(1).max(10_000).default(1);
const limitSchema = z.coerce.number().int().min(1).max(MAX_PAGE_SIZE).default(DEFAULT_PAGE_SIZE);

export const directoryQuerySchema = z.object({
    city: z.string().trim().min(1).max(120).optional(),
    /** Numeric id, kept for callers that already hold one. */
    categoryId: z.coerce.number().int().positive().optional(),
    /** Slug, which is what a public URL carries. */
    category: z.string().trim().min(1).max(120).optional(),
    /**
     * Name search. Capped short on purpose: a `%term%` cannot use the name
     * index, so a long free-text argument is a table scan.
     */
    q: z.string().trim().min(1).max(80).optional(),
    sort: z.enum(['newest', 'rating', 'featured']).default('newest'),
    featured: booleanFlag.optional(),
    page: pageSchema,
    limit: limitSchema,
});

export const businessIdParamSchema = z.coerce.number().int().positive();

export const reviewsQuerySchema = z.object({
    page: pageSchema,
    limit: limitSchema,
});

export type DirectoryQueryInput = z.infer<typeof directoryQuerySchema>;

/** Page metadata returned with every paginated public response. */
export function pageMeta(total: number, page: number, limit: number) {
    return {
        page,
        limit,
        total,
        totalPages: Math.max(1, Math.ceil(total / limit)),
        hasNext: page * limit < total,
        hasPrevious: page > 1,
    };
}
