import Razorpay from 'razorpay';
import logger from './logger.js';

// ─── Razorpay Client Singleton ────────────────────────────────────────────────

let razorpayInstance = null;

export const getRazorpayClient = () => {
  if (!razorpayInstance) {
    if (!process.env.RAZORPAY_KEY_ID || !process.env.RAZORPAY_KEY_SECRET) {
      throw new Error('Razorpay credentials not configured. Set RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET in .env');
    }

    razorpayInstance = new Razorpay({
      key_id: process.env.RAZORPAY_KEY_ID,
      key_secret: process.env.RAZORPAY_KEY_SECRET,
    });

    logger.info('Razorpay client initialized', {
      keyId: process.env.RAZORPAY_KEY_ID?.substring(0, 8) + '...',
      mode: process.env.RAZORPAY_KEY_ID?.startsWith('rzp_test_') ? 'TEST' : 'LIVE',
    });
  }

  return razorpayInstance;
};

export const RAZORPAY_WEBHOOK_SECRET = process.env.RAZORPAY_WEBHOOK_SECRET;
