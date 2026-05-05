import Joi from 'joi';

// ─── Payment Validators ───────────────────────────────────────────────────────

const SUPPORTED_CURRENCIES = ['INR', 'USD', 'EUR', 'GBP', 'SGD', 'AED'];
export const initiatePaymentSchema = Joi.object({
  amount: Joi.number()
    .integer()
    .min(100) // Minimum 1 INR (100 paise) — Razorpay minimum
    .max(10000000) // 1 lakh INR max per transaction
    .required()
    .messages({
      'number.min': 'Amount must be at least 100 paise (₹1)',
      'number.max': 'Amount cannot exceed ₹1,00,000 per transaction',
      'any.required': 'Amount is required',
    }),

  currency: Joi.string()
    .valid(...SUPPORTED_CURRENCIES)
    .default('INR')
    .messages({
      'any.only': `Currency must be one of: ${SUPPORTED_CURRENCIES.join(', ')}`,
    }),

  metadata: Joi.object({
    customerName: Joi.string().max(100),
    customerEmail: Joi.string().email(),
    customerPhone: Joi.string().pattern(/^[6-9]\d{9}$/),
    orderId: Joi.string().max(100),
    description: Joi.string().max(500),
  }).optional(),
});

/**
 * Schema: Verify payment after Razorpay checkout
 */
export const verifyPaymentSchema = Joi.object({
  razorpay_order_id: Joi.string()
    .pattern(/^order_/)
    .required()
    .messages({
      'string.pattern.base': 'Invalid Razorpay order ID format',
      'any.required': 'razorpay_order_id is required',
    }),

  razorpay_payment_id: Joi.string()
    .pattern(/^pay_/)
    .required()
    .messages({
      'string.pattern.base': 'Invalid Razorpay payment ID format',
      'any.required': 'razorpay_payment_id is required',
    }),

  razorpay_signature: Joi.string()
    .hex()
    .length(64)
    .required()
    .messages({
      'string.length': 'Invalid signature length',
      'any.required': 'razorpay_signature is required',
    }),
});

/**
 * Schema: List payments query params
 */
export const listPaymentsSchema = Joi.object({
  page: Joi.number().integer().min(1).default(1),
  limit: Joi.number().integer().min(1).max(100).default(20),
  status: Joi.string()
    .valid('PENDING', 'PROCESSING', 'SUCCESS', 'FAILED', 'REFUNDED')
    .optional(),
});

export const validate = (schema, data) => {
  return schema.validate(data, {
    abortEarly: false, // Return all errors, not just the first
    stripUnknown: true, // Remove unknown keys silently
  });
};
