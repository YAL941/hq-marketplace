import rateLimit, { ipKeyGenerator } from 'express-rate-limit';
import { config } from '../config.js';
const PROFILES = {
    // 10 attempts per 15 minutes is the usual baseline against credential
    // stuffing: high enough to survive a shared office NAT, low enough that a
    // dictionary attack never gets through.
    auth: { max: 10, windowMs: 15 * 60 * 1000 },
    // Order and review creation is authenticated but carries no reputation
    // score, so it gets a looser budget: 30 per minute.
    write: { max: 30, windowMs: 60 * 1000 },
    // The directory is read-only, unauthenticated and cheap per row, but a
    // catalogue crawl or a scraper is still a denial-of-service in slow motion.
    // 120/minute leaves an interactive client and its asset prefetch well under
    // the ceiling while stopping an unbounded loop.
    public: { max: 120, windowMs: 60 * 1000 },
};
/**
 * Tests share one IP address and one database, so a realistic budget would be
 * spent by the suite itself before it reached the interesting assertions.
 * Raising the ceiling rather than removing the middleware keeps the wiring
 * under test: a limiter that is accidentally left off a route, or mounted in
 * the wrong order, still shows up as a failing test.
 */
const TEST_OVERRIDE = { max: 10_000, windowMs: 60_000 };
function effectiveLimits(profile) {
    return config.isTest ? { ...TEST_OVERRIDE } : { ...PROFILES[profile] };
}
const sharedOptions = {
    // Count the client address, not the identity behind the token: the login
    // limiter has to work before anyone is authenticated.
    //
    // ipKeyGenerator, not req.ip, because a single residential IPv6 customer
    // is routinely handed a /64: keying on the raw address would let one person
    // rotate through billions of them and never hit the ceiling. The helper
    // folds the address down to its /56 subnet, which is the real granularity
    // a rate limit can count on.
    keyGenerator: (req) => ipKeyGenerator(req.ip ?? req.socket.remoteAddress ?? 'unknown'),
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    // A rejected request must not fall through to the error handler, or the
    // caller gets an HTML stack trace instead of a 429.
    handler: (_req, res) => {
        res.status(429).json({
            error: {
                code: 'RATE_LIMITED',
                message: 'Too many requests. Please try again later.',
            },
        });
    },
};
/** One limiter per profile, shared by every route that uses that profile. */
const limiters = new Map();
export function rateLimiter(profile) {
    const cached = limiters.get(profile);
    if (cached)
        return cached;
    const limiter = rateLimit({ ...sharedOptions, ...effectiveLimits(profile) });
    limiters.set(profile, limiter);
    return limiter;
}
//# sourceMappingURL=rate-limit.js.map