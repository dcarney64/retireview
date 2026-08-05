import rateLimit, { ipKeyGenerator } from 'express-rate-limit';

// TODO: Replace with Redis store for multi-server deployment

const MINUTE_MS = 60 * 1000;

// Authenticated routes limit per user so a shared IP/VPN doesn't starve others.
const userKey = (req) => (req.user?.id ? String(req.user.id) : ipKeyGenerator(req.ip));

function makeLimiter({ windowMs, limit, error, perUser = false }) {
    return rateLimit({
        windowMs,
        limit,
        legacyHeaders: true,
        standardHeaders: false,
        message: { error },
        // Client IP sourcing is handled explicitly (auth/clientIp.js); without
        // this, a request bearing x-forwarded-for while trust proxy is off
        // makes the limiter throw a one-time 500.
        validate: { xForwardedForHeader: false },
        ...(perUser && { keyGenerator: userKey }),
    });
}

export const globalLimiter = makeLimiter({
    windowMs: MINUTE_MS,
    limit: 300,
    error: 'Too many requests — please slow down',
});

export const loginLimiter = makeLimiter({
    windowMs: 15 * MINUTE_MS,
    limit: 10,
    error: 'Too many login attempts. Try again in 15 minutes.',
});

export const otpSendLimiter = makeLimiter({
    windowMs: 15 * MINUTE_MS,
    limit: 3,
    error: 'Too many code requests. Try again in 15 minutes.',
});

export const otpVerifyLimiter = makeLimiter({
    windowMs: 15 * MINUTE_MS,
    limit: 10,
    error: 'Too many verification attempts. Try again in 15 minutes.',
});

export const verifyPasswordLimiter = makeLimiter({
    windowMs: 15 * MINUTE_MS,
    limit: 10,
    error: 'Too many password attempts. Try again in 15 minutes.',
    perUser: true,
});

export const registerLimiter = makeLimiter({
    windowMs: 60 * MINUTE_MS,
    limit: 5,
    error: 'Too many registration attempts. Try again later.',
});

export const refreshLimiter = makeLimiter({
    windowMs: 15 * MINUTE_MS,
    limit: 30,
    error: 'Too many requests — please slow down',
});

// ADD YOUR APP-SPECIFIC LIMITERS BELOW THIS LINE (use perUser: true for
// authenticated routes so a shared IP doesn't starve other users)
