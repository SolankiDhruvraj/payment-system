import { ErrorCodes, ErrorHttpStatus } from '../constants/errorCodes.js';

// ─── Base Application Error ───────────────────────────────────────────────────

export class AppError extends Error {
  constructor(message, code = ErrorCodes.INTERNAL_ERROR, statusCode, isOperational = true, meta = {}) {
    super(message);
    this.name = this.constructor.name;
    this.code = code;
    this.statusCode = statusCode ?? ErrorHttpStatus[code] ?? 500;
    this.isOperational = isOperational;
    this.meta = meta;

    // Capture clean stack trace (excludes this constructor frame)
    Error.captureStackTrace(this, this.constructor);
  }

  toJSON() {
    return {
      error: {
        code: this.code,
        message: this.message,
        ...(Object.keys(this.meta).length > 0 && { details: this.meta }),
      },
    };
  }
}

// ─── Specialized Error Classes ────────────────────────────────────────────────

export class ValidationError extends AppError {
  constructor(message, details = {}) {
    super(message, ErrorCodes.VALIDATION_ERROR, 400, true, details);
  }
}

export class NotFoundError extends AppError {
  constructor(resource = 'Resource') {
    super(`${resource} not found`, ErrorCodes.PAYMENT_NOT_FOUND, 404);
  }
}

export class ConflictError extends AppError {
  constructor(message, code = ErrorCodes.PAYMENT_ALREADY_PROCESSED) {
    super(message, code, 409);
  }
}

export class GatewayError extends AppError {
  constructor(message, code = ErrorCodes.GATEWAY_UNAVAILABLE, meta = {}) {
    super(message, code, ErrorHttpStatus[code], true, meta);
  }
}

export class CircuitOpenError extends AppError {
  constructor(gatewayName = 'payment-gateway') {
    super(
      `Circuit breaker is OPEN for ${gatewayName}. Requests are temporarily blocked.`,
      ErrorCodes.CIRCUIT_OPEN,
      503
    );
  }
}

export class ConcurrentUpdateError extends AppError {
  constructor(paymentId) {
    super(
      `Concurrent update detected for payment ${paymentId}. Please retry.`,
      ErrorCodes.PAYMENT_CONCURRENT_UPDATE,
      409
    );
  }
}

export class InvalidTransitionError extends AppError {
  constructor(fromStatus, toStatus) {
    super(
      `Invalid state transition from ${fromStatus} to ${toStatus}`,
      ErrorCodes.PAYMENT_INVALID_TRANSITION,
      422,
      true,
      { fromStatus, toStatus }
    );
  }
}

export class WebhookError extends AppError {
  constructor(message, code = ErrorCodes.WEBHOOK_PROCESSING_FAILED, meta = {}) {
    super(message, code, ErrorHttpStatus[code], true, meta);
  }
}
