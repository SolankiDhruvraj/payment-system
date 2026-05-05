import prisma from '../config/database.js';
import logger from '../config/logger.js';

// ─── Idempotency Repository ───────────────────────────────────────────────────

export class IdempotencyRepository {
  async findByKey(key) {
    try {
      const record = await prisma.idempotencyKey.findUnique({ where: { key } });

      if (!record) return null;

      // Expired key — treat as if it doesn't exist, clean up asynchronously
      if (record.expiresAt < new Date()) {
        this.deleteKey(key).catch(() => {}); // fire-and-forget cleanup
        return null;
      }

      return { response: record.response, statusCode: record.statusCode };
    } catch (error) {
      logger.warn('Idempotency key lookup failed', { key, error: error.message });
      return null; // Fail open — don't block the request if key lookup fails
    }
  }

  async storeKey(key, response, statusCode) {
    const ttlHours = parseInt(process.env.IDEMPOTENCY_KEY_TTL_HOURS) || 24;
    const expiresAt = new Date(Date.now() + ttlHours * 60 * 60 * 1000);

    try {
      await prisma.idempotencyKey.upsert({
        where: { key },
        update: { response, statusCode, expiresAt },
        create: { key, response, statusCode, expiresAt },
      });
    } catch (error) {
      // Non-critical — log and continue. The operation already succeeded.
      logger.warn('Failed to store idempotency key', { key, error: error.message });
    }
  }
  async deleteKey(key) {
    await prisma.idempotencyKey.delete({ where: { key } }).catch(() => {});
  }

  async cleanExpiredKeys() {
    const result = await prisma.idempotencyKey.deleteMany({
      where: { expiresAt: { lt: new Date() } },
    });
    logger.info('Cleaned expired idempotency keys', { count: result.count });
    return result.count;
  }
}

export default new IdempotencyRepository();
