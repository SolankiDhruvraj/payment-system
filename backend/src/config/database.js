import { PrismaClient } from '@prisma/client';
import logger from './logger.js';

let prisma;

const createPrismaClient = () => {
  const client = new PrismaClient({
    log: [
      { emit: 'event', level: 'query' },
      { emit: 'event', level: 'error' },
      { emit: 'event', level: 'warn' },
    ],
  });

  if (process.env.NODE_ENV === 'development') {
    client.$on('query', (e) => {
      if (e.duration > 2000) {
        logger.warn('Slow query detected', {
          query: e.query,
          duration: `${e.duration}ms`,
        });
      }
    });
  }

  client.$on('error', (e) => {
    logger.error('Prisma error', { message: e.message, target: e.target });
  });

  return client;
};

if (!global.__prisma) {
  global.__prisma = createPrismaClient();
}

prisma = global.__prisma;

export default prisma;

export const connectDB = async () => {
  try {
    await prisma.$connect();
    logger.info('PostgreSQL connected successfully');
  } catch (error) {
    logger.error('Failed to connect to PostgreSQL', { error: error.message });
    process.exit(1);
  }
};

export const disconnectDB = async () => {
  await prisma.$disconnect();
  logger.info('PostgreSQL disconnected');
};
