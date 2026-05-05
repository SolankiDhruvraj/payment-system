// ─── Retry Utilities ──────────────────────────────────────────────────────────

export const calculateBackoffDelay = (attempt, {
  baseDelay = parseInt(process.env.RETRY_BASE_DELAY_MS) || 1000,
  maxDelay = parseInt(process.env.RETRY_MAX_DELAY_MS) || 30000,
  jitterFactor = 0.25,
} = {}) => {
  const exponentialDelay = Math.min(baseDelay * Math.pow(2, attempt), maxDelay);
  const jitter = exponentialDelay * jitterFactor * Math.random();
  return Math.floor(exponentialDelay + jitter);
};

export const getNextRetryAt = (retryCount) => {
  const delayMs = calculateBackoffDelay(retryCount);
  return new Date(Date.now() + delayMs);
};

export const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export const isRetryableError = (error) => {
  const NON_RETRYABLE_CODES = [
    'BAD_REQUEST_ERROR',
    'PAYMENT_SIGNATURE_INVALID',
    'PAYMENT_ALREADY_PROCESSED',
    'VALIDATION_ERROR',
    'CARD_STOLEN',
    'DO_NOT_HONOUR',
  ];

  if (error.code && NON_RETRYABLE_CODES.includes(error.code)) {
    return false;
  }

  // Timeouts and network errors are always retryable
  if (error.code === 'ECONNRESET' || error.code === 'ETIMEDOUT' || error.code === 'ENOTFOUND') {
    return true;
  }

  // Gateway 5xx errors are retryable
  if (error.statusCode >= 500 && error.statusCode < 600) {
    return true;
  }

  // Gateway 503 (service unavailable) and 429 (rate limit) are retryable
  if (error.statusCode === 503 || error.statusCode === 429) {
    return true;
  }

  return false;
};
