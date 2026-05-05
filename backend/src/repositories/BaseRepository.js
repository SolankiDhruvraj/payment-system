import prisma from '../config/database.js';
import logger from '../config/logger.js';
import { AppError } from '../utils/AppError.js';
import { ErrorCodes } from '../constants/errorCodes.js';

// ─── Base Repository ──────────────────────────────────────────────────────────

export class BaseRepository {
  constructor(modelName) {
    this.model = prisma[modelName];
    this.modelName = modelName;
  }
  async findById(id) {
    try {
      return await this.model.findUnique({ where: { id } });
    } catch (error) {
      this._handleDbError(error, 'findById', { id });
    }
  }
  async findOne(where) {
    try {
      return await this.model.findFirst({ where });
    } catch (error) {
      this._handleDbError(error, 'findOne', { where });
    }
  }

  async findMany(options = {}) {
    try {
      return await this.model.findMany(options);
    } catch (error) {
      this._handleDbError(error, 'findMany', options);
    }
  }

  async count(where = {}) {
    try {
      return await this.model.count({ where });
    } catch (error) {
      this._handleDbError(error, 'count', { where });
    }
  }

  async create(data) {
    try {
      return await this.model.create({ data });
    } catch (error) {
      this._handleDbError(error, 'create', { data });
    }
  }

  async update(id, data) {
    try {
      return await this.model.update({ where: { id }, data });
    } catch (error) {
      this._handleDbError(error, 'update', { id, data });
    }
  }
  async delete(id) {
    try {
      return await this.model.delete({ where: { id } });
    } catch (error) {
      this._handleDbError(error, 'delete', { id });
    }
  }

  // ── Error Normalization ────────────────────────────────────────────────────

  _handleDbError(error, operation, context = {}) {
    // Prisma known request errors
    if (error.code === 'P2025') {
      // Record not found
      throw new AppError(
        `${this.modelName} not found`,
        ErrorCodes.PAYMENT_NOT_FOUND,
        404
      );
    }

    if (error.code === 'P2002') {
      // Unique constraint violation
      throw new AppError(
        `Duplicate ${this.modelName} detected`,
        ErrorCodes.PAYMENT_ALREADY_PROCESSED,
        409
      );
    }

    // Log unexpected DB errors
    logger.error('Database operation failed', {
      model: this.modelName,
      operation,
      context,
      error: error.message,
      prismaCode: error.code,
    });

    throw new AppError(
      'Database operation failed',
      ErrorCodes.DATABASE_ERROR,
      500,
      false
    );
  }
}
