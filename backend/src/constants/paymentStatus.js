export const PaymentStatus = Object.freeze({
  PENDING: 'PENDING',
  PROCESSING: 'PROCESSING',
  SUCCESS: 'SUCCESS',
  FAILED: 'FAILED',
  REFUNDED: 'REFUNDED',
});

// Valid state transitions — strict state machine enforcement
export const VALID_TRANSITIONS = Object.freeze({
  [PaymentStatus.PENDING]: [PaymentStatus.PROCESSING, PaymentStatus.SUCCESS, PaymentStatus.FAILED],
  [PaymentStatus.PROCESSING]: [PaymentStatus.SUCCESS, PaymentStatus.FAILED, PaymentStatus.PENDING],
  [PaymentStatus.SUCCESS]: [PaymentStatus.REFUNDED],
  [PaymentStatus.FAILED]: [PaymentStatus.PENDING], // Allow retry (reset to PENDING)
  [PaymentStatus.REFUNDED]: [],
});

// Terminal states cannot be transitioned out of (except SUCCESS → REFUNDED)
export const TERMINAL_STATES = Object.freeze([
  PaymentStatus.SUCCESS,
  PaymentStatus.REFUNDED,
]);

// Non-retryable failure codes from Razorpay — hard failures that won't recover
export const NON_RETRYABLE_FAILURE_CODES = Object.freeze([
  'BAD_REQUEST_ERROR',       
  'GATEWAY_ERROR',       
  'INVALID_CARD',
  'CARD_STOLEN',
  'DO_NOT_HONOUR',
]);


export const isValidTransition = (fromStatus, toStatus) => {
  const allowed = VALID_TRANSITIONS[fromStatus] || [];
  return allowed.includes(toStatus);
};

export const isTerminalStatus = (status) => {
  return status === PaymentStatus.SUCCESS || status === PaymentStatus.REFUNDED;
};
