import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { Payment, PaymentAttempt, Prisma, $Enums } from '@prisma/client';
import { PaymentStatusEnum } from './enums/payment-status.enum';

/**
 * Payment data access layer.
 * Encapsulates all Prisma queries for the payments domain.
 * Business logic belongs in PaymentsService, not here.
 */
@Injectable()
export class PaymentsRepository {
  private readonly logger = new Logger(PaymentsRepository.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Create a new payment record.
   * Uses a unique constraint on idempotencyKey for deduplication.
   */
  async createPayment(data: Prisma.PaymentCreateInput): Promise<Payment> {
    return this.prisma.payment.create({ data });
  }

  /**
   * Find a payment by its internal order ID.
   */
  async findByOrderId(
    orderId: string,
    includeAttempts = false,
  ): Promise<(Payment & { attempts?: PaymentAttempt[] }) | null> {
    return this.prisma.payment.findUnique({
      where: { orderId },
      include: includeAttempts ? { attempts: { orderBy: { attemptNumber: 'asc' } } } : undefined,
    });
  }

  /**
   * Find a payment by its idempotency key.
   */
  async findByIdempotencyKey(
    idempotencyKey: string,
  ): Promise<Payment | null> {
    return this.prisma.payment.findUnique({
      where: { idempotencyKey },
    });
  }

  /**
   * Find a payment by its Cashfree order ID.
   */
  async findByCashfreeOrderId(
    cashfreeOrderId: string,
    includeAttempts = false,
  ): Promise<(Payment & { attempts?: PaymentAttempt[] }) | null> {
    return this.prisma.payment.findFirst({
      where: { cashfreeOrderId },
      include: includeAttempts ? { attempts: { orderBy: { attemptNumber: 'asc' } } } : undefined,
    });
  }

  /**
   * Update payment status with optimistic concurrency control.
   * Only updates if the current status matches expectedCurrentStatus.
   * This prevents stale/out-of-order events from corrupting the state.
   *
   * @returns The updated payment, or null if the status didn't match (stale update)
   */
  async updatePaymentStatus(
    paymentId: string,
    expectedCurrentStatus: PaymentStatusEnum,
    newStatus: PaymentStatusEnum,
    additionalData?: Partial<{
      cashfreeOrderId: string;
      paidAt: Date;
      failureReason: string;
      feeSettled: boolean;
    }>,
  ): Promise<Payment | null> {
    try {
      return await this.prisma.payment.update({
        where: {
          id: paymentId,
          // Optimistic lock: only update if status hasn't changed
          status: expectedCurrentStatus as $Enums.PaymentStatus,
        },
        data: {
          status: newStatus as unknown as $Enums.PaymentStatus,
          ...additionalData,
        },
      });
    } catch (error) {
      // P2025: Record not found (status already changed)
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2025'
      ) {
        this.logger.warn(
          `Stale status update rejected: payment ${paymentId}, ` +
            `expected ${expectedCurrentStatus}, target ${newStatus}`,
        );
        return null;
      }
      throw error;
    }
  }

  /**
   * Update payment with Cashfree order details after successful order creation.
   */
  async updateWithCashfreeOrder(
    paymentId: string,
    cashfreeOrderId: string,
  ): Promise<Payment> {
    return this.prisma.payment.update({
      where: { id: paymentId },
      data: {
        cashfreeOrderId,
        status: 'PENDING',
      },
    });
  }

  /**
   * Create a payment attempt record.
   */
  async createPaymentAttempt(
    data: Prisma.PaymentAttemptCreateInput,
  ): Promise<PaymentAttempt> {
    return this.prisma.paymentAttempt.create({ data });
  }

  /**
   * Get the next attempt number for a payment.
   */
  async getNextAttemptNumber(paymentId: string): Promise<number> {
    const lastAttempt = await this.prisma.paymentAttempt.findFirst({
      where: { paymentId },
      orderBy: { attemptNumber: 'desc' },
      select: { attemptNumber: true },
    });
    return (lastAttempt?.attemptNumber ?? 0) + 1;
  }

  /**
   * Update a payment attempt's status and details.
   */
  async updatePaymentAttempt(
    paymentId: string,
    cashfreePaymentId: string,
    data: Partial<{
      status: $Enums.PaymentAttemptStatus;
      paymentMethod: string;
      failureCode: string;
      failureMessage: string;
    }>,
  ): Promise<PaymentAttempt | null> {
    // Try to find existing attempt by cashfreePaymentId
    const existing = await this.prisma.paymentAttempt.findFirst({
      where: { paymentId, cashfreePaymentId },
    });

    if (existing) {
      return this.prisma.paymentAttempt.update({
        where: { id: existing.id },
        data,
      });
    }

    return null;
  }

  /**
   * Execute operations within a database transaction.
   */
  async executeInTransaction<T>(
    fn: (tx: Prisma.TransactionClient) => Promise<T>,
  ): Promise<T> {
    return this.prisma.$transaction(fn);
  }
}
