import rateLimit from 'express-rate-limit';
import logger from '../config/logger.js';

// ─── Rate Limiting ────────────────────────────────────────────────────────────

const createRateLimiter = (options = {}) => {
  return rateLimit({
    windowMs: options.windowMs || parseInt(process.env.RATE_LIMIT_WINDOW_MS) || 15 * 60 * 1000, // 15 minutes
    max: options.max || parseInt(process.env.RATE_LIMIT_MAX_REQUESTS) || 100,
    standardHeaders: true,  // Return rate limit info in RateLimit-* headers
    legacyHeaders: false,    // Disable X-RateLimit-* headers

    handler: (req, res) => {
      logger.warn('Rate limit exceeded', {
        ip: req.ip,
        path: req.path,
        limit: options.max,
      });

      res.status(429).json({
        success: false,
        error: {
          code: 'RATE_LIMIT_EXCEEDED',
          message: 'Too many requests. Please try again later.',
          retryAfter: Math.ceil(options.windowMs / 1000),
        },
        timestamp: new Date().toISOString(),
      });
    },

    // Skip rate limiting for health checks
    skip: (req) => req.path === '/api/v1/health',
  });
};

// General API limiter
export const apiLimiter = createRateLimiter();

// Stricter limiter for payment initiation — prevent payment creation abuse
export const paymentInitiateLimiter = createRateLimiter({
  windowMs: 60 * 1000, // 1 minute window
  max: 10,             // Max 10 payment initiations per minute per IP
});

// Very strict for retry endpoints
export const retryLimiter = createRateLimiter({
  windowMs: 5 * 60 * 1000, // 5 minute window
  max: 5,                   // Max 5 retries per 5 minutes per IP
});
