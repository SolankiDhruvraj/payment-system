import idempotencyRepository from '../repositories/IdempotencyRepository.js';
import { AppError } from '../utils/AppError.js';
import { ErrorCodes } from '../constants/errorCodes.js';
import logger from '../config/logger.js';


const idempotency = async (req, res, next) => {
  const idempotencyKey = req.headers['idempotency-key'];

  if (req.method !== 'POST' && req.method !== 'PUT') {
    return next();
  }

  if (!idempotencyKey) {
    return next(
      new AppError(
        'Idempotency-Key header is required for this endpoint',
        ErrorCodes.VALIDATION_ERROR,
        400
      )
    );
  }

  if (idempotencyKey.length > 255) {
    return next(
      new AppError('Idempotency-Key must not exceed 255 characters', ErrorCodes.VALIDATION_ERROR, 400)
    );
  }

  // Check for existing response
  const cached = await idempotencyRepository.findByKey(idempotencyKey);
  if (cached) {
    logger.info('Replaying idempotent response', {
      idempotencyKey,
      statusCode: cached.statusCode,
    });

    res.setHeader('X-Idempotent-Replay', 'true');
    return res.status(cached.statusCode).json(cached.response);
  }

  req.idempotencyKey = idempotencyKey;

  // Intercept response to cache it
  const originalJson = res.json.bind(res);
  res.json = (body) => {
    if (res.statusCode >= 200 && res.statusCode < 300) {
      idempotencyRepository
        .storeKey(idempotencyKey, body, res.statusCode)
        .catch((err) => logger.warn('Failed to cache idempotency response', { err: err.message }));
    }
    return originalJson(body);
  };

  next();
};

export default idempotency;
