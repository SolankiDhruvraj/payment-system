import prisma from '../config/database.js';
import { BaseRepository } from './BaseRepository.js';
import { AppError, ConcurrentUpdateError } from '../utils/AppError.js';
import { ErrorCodes } from '../constants/errorCodes.js';
import { isValidTransition } from '../constants/paymentStatus.js';
import logger from '../config/logger.js';

// ─── Payment Repository ───────────────────────────────────────────────────────

export class PaymentRepository extends BaseRepository {
  constructor() {
    super('payment');
  }

  async findByIdempotencyKey(idempotencyKey) {
    return this.findOne({ idempotencyKey });
  }

  async findByRazorpayOrderId(razorpayOrderId) {
    return this.findOne({ razorpayOrderId });
  }
  async createWithAudit(data) {
    return prisma.$transaction(async (tx) => {
      const payment = await tx.payment.create({ data });

      await tx.paymentAuditLog.create({
        data: {
          paymentId: payment.id,
          fromStatus: null,
          toStatus: payment.status,
          actor: 'system',
          reason: 'Payment initiated',
          metadata: { idempotencyKey: payment.idempotencyKey, amount: payment.amount },
        },
      });

      return payment;
    });
  }

  async updateStatusWithAudit(id, newStatus, updateData = {}, actor = 'system', reason = '') {
    return prisma.$transaction(async (tx) => {
      // Lock the row for this transaction — prevents concurrent updates
      const current = await tx.payment.findUnique({ where: { id } });

      if (!current) {
        throw new AppError(`Payment ${id} not found`, ErrorCodes.PAYMENT_NOT_FOUND, 404);
      }

      // State machine validation
      if (current.status !== newStatus && !isValidTransition(current.status, newStatus)) {
        throw new AppError(
          `Invalid transition from ${current.status} to ${newStatus}`,
          ErrorCodes.PAYMENT_INVALID_TRANSITION,
          422
        );
      }

      // Optimistic locking — if version changed between read and write, someone else got there first
      const updated = await tx.payment.updateMany({
        where: {
          id,
          version: current.version, // version must match what we read
        },
        data: {
          status: newStatus,
          version: current.version + 1, // increment version
          ...updateData,
        },
      });

      if (updated.count === 0) {
        // Another transaction updated this record between our read and write
        throw new ConcurrentUpdateError(id);
      }

      // Fetch the updated record
      const updatedPayment = await tx.payment.findUnique({ where: { id } });

  
      await tx.paymentAuditLog.create({
        data: {
          paymentId: id,
          fromStatus: current.status,
          toStatus: newStatus,
          actor,
          reason,
          metadata: {
            version: updatedPayment.version,
            ...Object.keys(updateData).reduce((acc, key) => {
              if (!['failureReason', 'metadata'].includes(key)) acc[key] = updateData[key];
              return acc;
            }, {}),
          },
        },
      });

      logger.info('Payment status updated', {
        paymentId: id,
        fromStatus: current.status,
        toStatus: newStatus,
        actor,
        version: updatedPayment.version,
      });

      return updatedPayment;
    });
  }

  async list({ page = 1, limit = 20, status } = {}) {
    const where = status ? { status } : {};
    const skip = (page - 1) * limit;

    const [payments, total] = await prisma.$transaction([
      prisma.payment.findMany({
        where,
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
        include: { auditLogs: { orderBy: { createdAt: 'asc' } } },
      }),
      prisma.payment.count({ where }),
    ]);

    return { payments, total, page, limit, totalPages: Math.ceil(total / limit) };
  }

  async findPaymentsEligibleForRetry() {
    return prisma.payment.findMany({
      where: {
        status: 'FAILED',
        nextRetryAt: { lte: new Date() },
        retryCount: { lt: prisma.payment.fields.maxRetries }, // retryCount < maxRetries
      },
    });
  }
}

export default new PaymentRepository();
