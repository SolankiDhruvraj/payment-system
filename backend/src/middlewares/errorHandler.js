import logger from '../config/logger.js';
import { AppError } from '../utils/AppError.js';
import { ErrorCodes } from '../constants/errorCodes.js';

const errorHandler = (err, req, res, next) => {
  // Default to 500 Internal Server Error
  let statusCode = err.statusCode || 500;
  let code = err.code || ErrorCodes.INTERNAL_ERROR;
  let message = err.message || 'An unexpected error occurred';
  let isOperational = err.isOperational ?? false;

  // Prisma / DB errors — normalize
  if (err.name === 'PrismaClientKnownRequestError') {
    if (err.code === 'P2025') {
      statusCode = 404;
      code = ErrorCodes.PAYMENT_NOT_FOUND;
      message = 'Record not found';
      isOperational = true;
    } else if (err.code === 'P2002') {
      statusCode = 409;
      code = ErrorCodes.PAYMENT_ALREADY_PROCESSED;
      message = 'Duplicate record detected';
      isOperational = true;
    }
  }

  // Joi validation errors (if not wrapped in AppError)
  if (err.name === 'ValidationError' && err.isJoi) {
    statusCode = 400;
    code = ErrorCodes.VALIDATION_ERROR;
    message = err.details.map((d) => d.message).join(', ');
    isOperational = true;
  }

  // Log structured error — include stack for non-operational (bugs)
  const logPayload = {
    code,
    statusCode,
    message,
    method: req.method,
    path: req.path,
    requestId: req.headers['x-request-id'],
  };

  if (!isOperational) {
    logger.error('Unhandled error (non-operational)', { ...logPayload, stack: err.stack });
  } else {
    logger.warn('Operational error', logPayload);
  }

  // Never leak internal error details in production
  const responseMessage =
    !isOperational && process.env.NODE_ENV === 'production'
      ? 'An internal server error occurred'
      : message;

  res.status(statusCode).json({
    success: false,
    error: {
      code,
      message: responseMessage,
      ...(process.env.NODE_ENV === 'development' && !isOperational && { stack: err.stack }),
    },
    timestamp: new Date().toISOString(),
    requestId: req.headers['x-request-id'],
  });
};

export default errorHandler;
