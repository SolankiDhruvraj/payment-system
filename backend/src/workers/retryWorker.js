import retryService from '../services/RetryService.js';
import logger from '../config/logger.js';

// ─── Payment Retry Worker ─────────────────────────────────────────────────────
// Periodically polls the database for payments that are eligible for retry
// (status = FAILED, nextRetryAt <= NOW, retryCount < maxRetries) and attempts
// to retry them using the RetryService.

export const startRetryWorker = () => {
  const intervalMs = parseInt(process.env.RETRY_WORKER_INTERVAL_MS) || 60000; // Default 1 minute
  
  logger.info(`Starting payment retry worker (interval: ${intervalMs}ms)`);
  
  // Set up an interval to periodically run the retry processing
  setInterval(async () => {
    try {
      logger.debug('Retry worker: Checking for eligible retries...');
      const results = await retryService.processEligibleRetries();
      
      if (results.processed > 0) {
        logger.info('Retry worker: Processing complete', results);
      }
    } catch (error) {
      logger.error('Retry worker encountered an error', { error: error.message, stack: error.stack });
    }
  }, intervalMs);
};
