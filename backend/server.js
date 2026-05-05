import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

import logger from './src/config/logger.js';
import { connectDB, disconnectDB } from './src/config/database.js';
import apiRoutes from './src/routes/index.js';
import errorHandler from './src/middlewares/errorHandler.js';
import requestLogger from './src/middlewares/requestLogger.js';
import { apiLimiter } from './src/middlewares/rateLimiter.js';
import { startRetryWorker } from './src/workers/retryWorker.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const logsDir = path.join(__dirname, 'logs');
if (!fs.existsSync(logsDir)) fs.mkdirSync(logsDir, { recursive: true });

const app = express();


app.use(cors({
  origin: process.env.ALLOWED_ORIGINS?.split(',') || ['http://localhost:5173', 'http://localhost:3000'],
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'Idempotency-Key', 'X-Request-Id'],
  exposedHeaders: ['X-Request-Id', 'X-Idempotent-Replay', 'RateLimit-Limit', 'RateLimit-Remaining'],
}));


app.use('/api/v1/webhooks', express.raw({ type: 'application/json', limit: '1mb' }));


app.use(express.json({ limit: '10kb' }));
app.use(express.urlencoded({ extended: true, limit: '10kb' }));


app.use(requestLogger);


app.use('/api', apiLimiter);


app.use('/api/v1', apiRoutes);

app.get('/', (req, res) => {
  res.json({
    service: 'Payment Processing System',
    version: '1.0.0',
    status: 'running',
    docs: '/api/v1/health',
    timestamp: new Date().toISOString(),
  });
});


app.use(errorHandler);

const PORT = process.env.PORT || 4001;

const startServer = async () => {
  try {
    // Connect to database before accepting requests
    await connectDB();
    
    // Start background workers
    startRetryWorker();

    const server = app.listen(PORT, () => {
      logger.info(`Server running`, {
        port: PORT,
        environment: process.env.NODE_ENV || 'development',
        url: `http://localhost:${PORT}`,
      });
    });

    const gracefulShutdown = async (signal) => {
      logger.info(`${signal} received — initiating graceful shutdown`);

      server.close(async () => {
        logger.info('HTTP server closed');
        await disconnectDB();
        logger.info('Database connections closed — process exiting');
        process.exit(0);
      });

      // Force exit after 30 seconds if graceful shutdown hangs
      setTimeout(() => {
        logger.error('Forced shutdown after timeout');
        process.exit(1);
      }, 30000);
    };

    process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
    process.on('SIGINT', () => gracefulShutdown('SIGINT'));

    process.on('unhandledRejection', (reason, promise) => {
      logger.error('Unhandled promise rejection', {
        reason: reason?.message || reason,
        stack: reason?.stack,
      });
    });

    process.on('uncaughtException', (error) => {
      logger.error('Uncaught exception — shutting down', { error: error.message, stack: error.stack });
      process.exit(1);
    });

  } catch (error) {
    logger.error('Failed to start server', { error: error.message, stack: error.stack });
    process.exit(1);
  }
};

if (process.env.NODE_ENV !== 'test') {
  startServer();
}

export default app;