import { Router } from 'express';
import paymentRoutes from './payment.routes.js';
import webhookRoutes from './webhook.routes.js';
import paymentController from '../controllers/PaymentController.js';

const router = Router();

// ─── API v1 Routes ────────────────────────────────────────────────────────────

router.get('/health', paymentController.healthCheck);

router.use('/payments', paymentRoutes);
router.use('/webhooks', webhookRoutes);

// 404 handler for unknown API routes
router.use('*', (req, res) => {
  res.status(404).json({
    success: false,
    error: {
      code: 'ROUTE_NOT_FOUND',
      message: `Route ${req.method} ${req.originalUrl} not found`,
    },
    timestamp: new Date().toISOString(),
  });
});

export default router;
