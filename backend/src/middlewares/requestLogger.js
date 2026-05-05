import { v4 as uuidv4 } from 'uuid';
import logger from '../config/logger.js';

// ─── Request Logger Middleware ────────────────────────────────────────────────

const requestLogger = (req, res, next) => {
  // Attach a unique request ID for correlation
  req.requestId = req.headers['x-request-id'] || uuidv4();
  res.setHeader('X-Request-Id', req.requestId);

  const startTime = Date.now();

  // Log request receipt
  logger.info('Incoming request', {
    requestId: req.requestId,
    method: req.method,
    path: req.path,
    ip: req.ip,
    userAgent: req.get('User-Agent'),
  });

  // Log response after it's sent — override res.end to capture timing
  const originalEnd = res.end.bind(res);
  res.end = function (...args) {
    const duration = Date.now() - startTime;

    const logFn = res.statusCode >= 500 ? logger.error : res.statusCode >= 400 ? logger.warn : logger.info;

    logFn.call(logger, 'Request completed', {
      requestId: req.requestId,
      method: req.method,
      path: req.path,
      statusCode: res.statusCode,
      durationMs: duration,
    });

    return originalEnd(...args);
  };

  next();
};

export default requestLogger;
