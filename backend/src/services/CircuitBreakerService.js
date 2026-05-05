import { EventEmitter } from 'events';
import logger from '../config/logger.js';
import { CircuitOpenError } from '../utils/AppError.js';

// ─── Circuit Breaker States ───────────────────────────────────────────────────

const CircuitState = Object.freeze({
  CLOSED: 'CLOSED',       // Normal operation — requests flow through
  OPEN: 'OPEN',           // Failing — block all requests immediately
  HALF_OPEN: 'HALF_OPEN', // Recovery probe — allow limited requests to test recovery
});

// ─── Circuit Breaker Service ──────────────────────────────────────────────────

export class CircuitBreakerService extends EventEmitter {
  constructor({
    failureThreshold = parseInt(process.env.CIRCUIT_BREAKER_FAILURE_THRESHOLD) || 5,
    recoveryTimeoutMs = parseInt(process.env.CIRCUIT_BREAKER_RECOVERY_TIMEOUT_MS) || 30000,
    halfOpenMaxCalls = parseInt(process.env.CIRCUIT_BREAKER_HALF_OPEN_MAX_CALLS) || 2,
    name = 'default',
  } = {}) {
    super();
    this.name = name;
    this.failureThreshold = failureThreshold;
    this.recoveryTimeoutMs = recoveryTimeoutMs;
    this.halfOpenMaxCalls = halfOpenMaxCalls;

    // State
    this.state = CircuitState.CLOSED;
    this.consecutiveFailures = 0;
    this.lastFailureTime = null;
    this.halfOpenCallCount = 0;
  }

  async execute(fn) {
    if (this.state === CircuitState.OPEN) {
      // Check if recovery timeout has passed — transition to HALF_OPEN
      if (this._shouldAttemptRecovery()) {
        this._transitionTo(CircuitState.HALF_OPEN);
      } else {
        const timeUntilRecovery = Math.ceil(
          (this.recoveryTimeoutMs - (Date.now() - this.lastFailureTime)) / 1000
        );
        logger.warn('Circuit breaker is OPEN — blocking request', {
          circuit: this.name,
          timeUntilRecoverySeconds: timeUntilRecovery,
        });
        throw new CircuitOpenError(this.name);
      }
    }

    if (this.state === CircuitState.HALF_OPEN) {
      if (this.halfOpenCallCount >= this.halfOpenMaxCalls) {
        throw new CircuitOpenError(this.name);
      }
      this.halfOpenCallCount++;
    }

    try {
      const result = await fn();
      this._onSuccess();
      return result;
    } catch (error) {
      this._onFailure(error);
      throw error;
    }
  }

  /**
   * Get current circuit breaker status for health checks.
   */
  getStatus() {
    return {
      name: this.name,
      state: this.state,
      consecutiveFailures: this.consecutiveFailures,
      lastFailureTime: this.lastFailureTime,
      failureThreshold: this.failureThreshold,
    };
  }

  reset() {
    this.consecutiveFailures = 0;
    this.lastFailureTime = null;
    this.halfOpenCallCount = 0;
    this._transitionTo(CircuitState.CLOSED);
    logger.info('Circuit breaker manually reset', { circuit: this.name });
  }

  // ── Private Methods ────────────────────────────────────────────────────────

  _onSuccess() {
    if (this.state === CircuitState.HALF_OPEN) {
      logger.info('Circuit breaker probe succeeded — closing circuit', { circuit: this.name });
      this.reset();
    } else {
      // Reset failure count on any success
      this.consecutiveFailures = 0;
    }
  }

  _onFailure(error) {
    this.consecutiveFailures++;
    this.lastFailureTime = Date.now();

    logger.warn('Circuit breaker recorded failure', {
      circuit: this.name,
      consecutiveFailures: this.consecutiveFailures,
      threshold: this.failureThreshold,
      error: error.message,
    });

    if (this.state === CircuitState.HALF_OPEN) {
      // Probe failed — go back to OPEN
      logger.error('Circuit breaker half-open probe failed — reopening circuit', {
        circuit: this.name,
      });
      this._transitionTo(CircuitState.OPEN);
    } else if (this.consecutiveFailures >= this.failureThreshold) {
      logger.error('Circuit breaker threshold reached — opening circuit', {
        circuit: this.name,
        consecutiveFailures: this.consecutiveFailures,
      });
      this._transitionTo(CircuitState.OPEN);
    }
  }

  _shouldAttemptRecovery() {
    return this.lastFailureTime && (Date.now() - this.lastFailureTime) >= this.recoveryTimeoutMs;
  }

  _transitionTo(newState) {
    const prevState = this.state;
    this.state = newState;

    if (newState === CircuitState.HALF_OPEN) {
      this.halfOpenCallCount = 0;
    }

    logger.info('Circuit breaker state transition', {
      circuit: this.name,
      from: prevState,
      to: newState,
    });

    this.emit('stateChange', { circuit: this.name, from: prevState, to: newState });
  }
}

// Singleton circuit breaker for the payment gateway
export default new CircuitBreakerService({ name: 'razorpay-gateway' });
