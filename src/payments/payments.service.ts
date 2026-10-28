import {
  Injectable,
  Logger,
  ConflictException,
  NotFoundException,
  BadRequestException,
  ForbiddenException,
  InternalServerErrorException,
} from '@nestjs/common';
import { v4 as uuidv4 } from 'uuid';
import { Decimal } from '@prisma/client/runtime/library';
import { PaymentsRepository } from './payments.repository';
import { CashfreeService } from '../cashfree/cashfree.service';
import { FeeRepository } from '../common/repositories/fee.repository';
import { CreatePaymentDto } from './dto/create-payment.dto';
import {
  PaymentResponseDto,
  CreatePaymentResponseDto,
  VerifyPaymentResponseDto,
  PaymentAttemptResponseDto,
} from './dto/payment-response.dto';
import {
  PaymentStatusEnum,
  isValidStatusTransition,
} from './enums/payment-status.enum';
import { Payment, PaymentAttempt, $Enums } from '@prisma/client';

/**
 * Core payment business logic service.
 *
 * Orchestrates payment creation, verification, and status management.
 * Contains all domain rules including:
 * - Fee validation and amount resolution from trusted ERP source
 * - Idempotency handling with conflict detection
 * - Cashfree order creation with timeout reconciliation
 * - Payment state machine enforcement
 * - ERP fee settlement after verified payment
 */
@Injectable()
export class PaymentsService {
  private readonly logger = new Logger(PaymentsService.name);

  constructor(
    private readonly paymentsRepository: PaymentsRepository,
    private readonly cashfreeService: CashfreeService,
    private readonly feeRepository: FeeRepository,
  ) {}

  /**
   * Create a new payment for an ERP fee.
   *
   * Workflow:
   * 1. Resolve fee from trusted ERP repository (never trust client amount)
   * 2. Validate fee is payable (exists, belongs to student, not already paid)
   * 3. Check idempotency key for duplicates
   * 4. Create internal payment record
   * 5. Create Cashfree order
   * 6. Return payment session ID for frontend checkout
   */
  async createPayment(
    dto: CreatePaymentDto,
    studentId: string,
  ): Promise<CreatePaymentResponseDto> {
    // Step 1 & 2: Resolve and validate the fee
    const fee = await this.feeRepository.findFee(dto.feeReference, studentId);

    if (!fee) {
      throw new NotFoundException(
        `Fee reference '${dto.feeReference}' not found for this student`,
      );
    }

    if (fee.isPaid) {
      throw new ConflictException(
        `Fee '${dto.feeReference}' has already been paid`,
      );
    }

    // Step 3: Check idempotency key
    const existingPayment = await this.paymentsRepository.findByIdempotencyKey(
      dto.idempotencyKey,
    );

    if (existingPayment) {
      // Same idempotency key exists - check if payload matches
      if (existingPayment.feeReference !== dto.feeReference) {
        throw new ConflictException(
          'Idempotency key has already been used with a different fee reference',
        );
      }

      if (existingPayment.studentId !== studentId) {
        throw new ConflictException(
          'Idempotency key has already been used by a different student',
        );
      }

      // Same key, same payload - return existing payment (idempotent)
      this.logger.log(
        `Idempotent request: returning existing payment ${existingPayment.orderId}`,
      );

      // If the payment already has a Cashfree order, we need to return the session ID
      // If not, we need to complete the order creation that might have failed
      if (existingPayment.cashfreeOrderId && existingPayment.status !== 'CREATED') {
        // Payment already has an order - just return the existing data
        // Note: We can't retrieve the payment_session_id after initial creation,
        // so we return a response indicating the payment already exists
        return this.toCreateResponse(existingPayment, '');
      }

      // Payment was created but Cashfree order wasn't created yet - proceed to create it
      return this.createCashfreeOrderForPayment(existingPayment, fee);
    }

    // Step 4: Create internal payment record
    const orderId = `TXN-${uuidv4().replace(/-/g, '').substring(0, 12)}`;

    let payment: Payment;
    try {
      payment = await this.paymentsRepository.createPayment({
        orderId,
        feeReference: dto.feeReference,
        studentId,
        amount: fee.amount,
        currency: fee.currency,
        idempotencyKey: dto.idempotencyKey,
        description: dto.description || fee.description,
        status: 'CREATED',
      });
    } catch (error: unknown) {
      // Handle race condition: another request with same idempotency key
      if (
        error &&
        typeof error === 'object' &&
        'code' in error &&
        (error as { code: string }).code === 'P2002'
      ) {
        throw new ConflictException(
          'Duplicate payment request. Please retry with a new idempotency key.',
        );
      }
      throw error;
    }

    // Step 5 & 6: Create Cashfree order and return response
    return this.createCashfreeOrderForPayment(payment, fee);
  }

  /**
   * Get payment status by order ID.
   * Verifies the requesting student owns the payment.
   */
  async getPaymentStatus(
    orderId: string,
    studentId: string,
  ): Promise<PaymentResponseDto> {
    const payment = await this.paymentsRepository.findByOrderId(orderId, true);

    if (!payment) {
      throw new NotFoundException(`Payment with order ID '${orderId}' not found`);
    }

    // Authorization: only the owning student can view their payment
    if (payment.studentId !== studentId) {
      throw new ForbiddenException('You are not authorized to view this payment');
    }

    return this.toResponse(payment, payment.attempts);
  }

  /**
   * Verify payment status from Cashfree's authoritative server-side API.
   *
   * This is the TRUSTED verification path. It:
   * 1. Fetches order/payment status directly from Cashfree
   * 2. Validates amount, currency, and order identity
   * 3. Updates local database with verified status
   * 4. Settles the ERP fee if payment is confirmed successful
   *
   * NEVER trusts a client assertion like {"status":"PAID"}.
   */
  async verifyPayment(
    orderId: string,
    studentId: string,
  ): Promise<VerifyPaymentResponseDto> {
    const payment = await this.paymentsRepository.findByOrderId(orderId, true);

    if (!payment) {
      throw new NotFoundException(`Payment with order ID '${orderId}' not found`);
    }

    if (payment.studentId !== studentId) {
      throw new ForbiddenException('You are not authorized to verify this payment');
    }

    if (!payment.cashfreeOrderId) {
      throw new BadRequestException(
        'Payment has no Cashfree order. Cannot verify.',
      );
    }

    // If already verified as PAID, return immediately (idempotent)
    if (payment.status === PaymentStatusEnum.PAID) {
      return {
        ...this.toResponse(payment, payment.attempts),
        verified: true,
        feeSettled: payment.feeSettled,
      };
    }

    try {
      // Fetch authoritative status from Cashfree
      const [cashfreeOrder, cashfreePayments] = await Promise.all([
        this.cashfreeService.fetchOrder(payment.orderId),
        this.cashfreeService.fetchPaymentsForOrder(payment.orderId),
      ]);

      // Validate order identity and amount
      if (cashfreeOrder.order_id !== payment.orderId) {
        this.logger.error(
          `Order ID mismatch: expected ${payment.orderId}, got ${cashfreeOrder.order_id}`,
        );
        throw new InternalServerErrorException('Payment verification failed: order mismatch');
      }

      const expectedAmount = Number(payment.amount);
      if (Math.abs(cashfreeOrder.order_amount - expectedAmount) > 0.01) {
        this.logger.error(
          `Amount mismatch for ${payment.orderId}: expected ${expectedAmount}, got ${cashfreeOrder.order_amount}`,
        );
        throw new InternalServerErrorException('Payment verification failed: amount mismatch');
      }

      // Process payment attempts from Cashfree
      for (const cfPayment of cashfreePayments) {
        const nextAttemptNum = await this.paymentsRepository.getNextAttemptNumber(payment.id);

        // Try to update existing attempt or create new one
        const existingAttempt = await this.paymentsRepository.updatePaymentAttempt(
          payment.id,
          cfPayment.cf_payment_id,
          {
            status: this.mapCashfreePaymentStatus(cfPayment.payment_status),
            paymentMethod: cfPayment.payment_group || undefined,
            failureCode: cfPayment.error_details?.error_code || undefined,
            failureMessage: cfPayment.error_details?.error_description || undefined,
          },
        );

        if (!existingAttempt) {
          try {
            await this.paymentsRepository.createPaymentAttempt({
              payment: { connect: { id: payment.id } },
              cashfreePaymentId: cfPayment.cf_payment_id,
              attemptNumber: nextAttemptNum,
              status: this.mapCashfreePaymentStatus(cfPayment.payment_status),
              paymentMethod: cfPayment.payment_group || null,
              failureCode: cfPayment.error_details?.error_code || null,
              failureMessage: cfPayment.error_details?.error_description || null,
            });
          } catch (error: unknown) {
            // Ignore duplicate attempt errors (race with webhook)
            if (
              error &&
              typeof error === 'object' &&
              'code' in error &&
              (error as { code: string }).code === 'P2002'
            ) {
              this.logger.debug(
                `Duplicate attempt ignored for payment ${payment.id}`,
              );
            } else {
              throw error;
            }
          }
        }
      }

      // Determine overall payment status from Cashfree order status
      let newStatus: PaymentStatusEnum;
      let verified = false;
      let feeSettled = payment.feeSettled;

      if (cashfreeOrder.order_status === 'PAID') {
        newStatus = PaymentStatusEnum.PAID;
        verified = true;
      } else if (cashfreeOrder.order_status === 'EXPIRED') {
        newStatus = PaymentStatusEnum.EXPIRED;
      } else {
        // ACTIVE - check if any payment attempt succeeded
        const hasSuccess = cashfreePayments.some(
          (p) => p.payment_status === 'SUCCESS',
        );
        if (hasSuccess) {
          newStatus = PaymentStatusEnum.PAID;
          verified = true;
        } else {
          newStatus = payment.status as PaymentStatusEnum;
        }
      }

      // Update payment status if changed
      if (newStatus !== payment.status) {
        if (isValidStatusTransition(payment.status as PaymentStatusEnum, newStatus)) {
          const updated = await this.paymentsRepository.updatePaymentStatus(
            payment.id,
            payment.status as PaymentStatusEnum,
            newStatus,
            {
              paidAt: verified ? new Date() : undefined,
            },
          );

          if (updated && verified && !feeSettled) {
            // Settle the ERP fee
            feeSettled = await this.settleFee(payment.feeReference, payment.studentId, payment.id);
          }
        } else {
          this.logger.warn(
            `Invalid status transition during verification: ${payment.status} → ${newStatus} for ${payment.orderId}`,
          );
        }
      } else if (verified && !feeSettled) {
        // Status unchanged but fee not yet settled
        feeSettled = await this.settleFee(payment.feeReference, payment.studentId, payment.id);
      }

      // Fetch updated payment
      const updatedPayment = await this.paymentsRepository.findByOrderId(orderId, true);

      return {
        ...this.toResponse(updatedPayment!, updatedPayment!.attempts),
        verified,
        feeSettled,
      };
    } catch (error) {
      if (
        error instanceof NotFoundException ||
        error instanceof ForbiddenException ||
        error instanceof BadRequestException ||
        error instanceof InternalServerErrorException
      ) {
        throw error;
      }

      this.logger.error(
        `Payment verification failed for ${orderId}: ${error instanceof Error ? error.message : 'Unknown error'}`,
      );
      throw new InternalServerErrorException(
        'Payment verification failed. Please try again.',
      );
    }
  }

  /**
   * Process a verified webhook event to update payment status.
   * Called by the WebhooksService after signature verification.
   *
   * Handles out-of-order events safely:
   * - Never overwrites PAID with FAILED
   * - Uses optimistic concurrency to prevent race conditions
   */
  async processWebhookPaymentUpdate(
    cashfreeOrderId: string,
    cashfreePaymentId: string,
    paymentStatus: string,
    paymentMethod: string | null,
    failureCode: string | null,
    failureMessage: string | null,
    orderAmount: number,
    orderCurrency: string,
  ): Promise<{ paymentId: string | null; updated: boolean }> {
    // Find the internal payment by the merchant order ID (which we use as Cashfree order_id)
    const payment = await this.paymentsRepository.findByCashfreeOrderId(
      cashfreeOrderId,
      true,
    );

    if (!payment) {
      // Try finding by orderId since we set order_id = our orderId in Cashfree
      const paymentByOrderId = await this.paymentsRepository.findByOrderId(
        cashfreeOrderId,
        true,
      );

      if (!paymentByOrderId) {
        this.logger.warn(
          `Webhook received for unknown order: ${cashfreeOrderId}`,
        );
        return { paymentId: null, updated: false };
      }

      return this.processPaymentUpdate(
        paymentByOrderId,
        cashfreePaymentId,
        paymentStatus,
        paymentMethod,
        failureCode,
        failureMessage,
        orderAmount,
        orderCurrency,
      );
    }

    return this.processPaymentUpdate(
      payment,
      cashfreePaymentId,
      paymentStatus,
      paymentMethod,
      failureCode,
      failureMessage,
      orderAmount,
      orderCurrency,
    );
  }

  // ===========================================================================
  // Private helpers
  // ===========================================================================

  private async processPaymentUpdate(
    payment: Payment & { attempts?: PaymentAttempt[] },
    cashfreePaymentId: string,
    paymentStatus: string,
    paymentMethod: string | null,
    failureCode: string | null,
    failureMessage: string | null,
    orderAmount: number,
    orderCurrency: string,
  ): Promise<{ paymentId: string; updated: boolean }> {
    // Validate amount matches
    const expectedAmount = Number(payment.amount);
    if (Math.abs(orderAmount - expectedAmount) > 0.01) {
      this.logger.error(
        `Amount mismatch in webhook for ${payment.orderId}: expected ${expectedAmount}, got ${orderAmount}`,
      );
      return { paymentId: payment.id, updated: false };
    }

    // Record the payment attempt
    const nextAttemptNum = await this.paymentsRepository.getNextAttemptNumber(payment.id);
    const attemptStatus = this.mapCashfreePaymentStatus(paymentStatus);

    const existingAttempt = await this.paymentsRepository.updatePaymentAttempt(
      payment.id,
      cashfreePaymentId,
      {
        status: attemptStatus,
        paymentMethod: paymentMethod || undefined,
        failureCode: failureCode || undefined,
        failureMessage: failureMessage || undefined,
      },
    );

    if (!existingAttempt) {
      try {
        await this.paymentsRepository.createPaymentAttempt({
          payment: { connect: { id: payment.id } },
          cashfreePaymentId,
          attemptNumber: nextAttemptNum,
          status: attemptStatus,
          paymentMethod: paymentMethod || null,
          failureCode: failureCode || null,
          failureMessage: failureMessage || null,
        });
      } catch (error: unknown) {
        if (
          error &&
          typeof error === 'object' &&
          'code' in error &&
          (error as { code: string }).code === 'P2002'
        ) {
          this.logger.debug(`Duplicate attempt ignored for webhook processing`);
        } else {
          throw error;
        }
      }
    }

    // Determine new overall payment status
    let newStatus: PaymentStatusEnum;
    const currentStatus = payment.status as PaymentStatusEnum;

    if (paymentStatus === 'SUCCESS') {
      newStatus = PaymentStatusEnum.PAID;
    } else if (paymentStatus === 'USER_DROPPED') {
      newStatus = PaymentStatusEnum.CANCELLED;
    } else if (paymentStatus === 'FAILED') {
      newStatus = PaymentStatusEnum.FAILED;
    } else {
      // PENDING or unknown - don't change overall status
      return { paymentId: payment.id, updated: true };
    }

    // Apply state machine rules
    if (!isValidStatusTransition(currentStatus, newStatus)) {
      this.logger.warn(
        `Webhook status transition blocked: ${currentStatus} → ${newStatus} for ${payment.orderId}. ` +
          `This likely means a late/out-of-order event was safely ignored.`,
      );
      return { paymentId: payment.id, updated: false };
    }

    // Update payment status
    const updated = await this.paymentsRepository.updatePaymentStatus(
      payment.id,
      currentStatus,
      newStatus,
      {
        paidAt: newStatus === PaymentStatusEnum.PAID ? new Date() : undefined,
        failureReason:
          newStatus === PaymentStatusEnum.FAILED
            ? (failureMessage || failureCode || 'Payment failed')
            : undefined,
      },
    );

    if (updated && newStatus === PaymentStatusEnum.PAID && !payment.feeSettled) {
      // Settle the ERP fee
      await this.settleFee(payment.feeReference, payment.studentId, payment.id);
    }

    return { paymentId: payment.id, updated: !!updated };
  }

  /**
   * Create a Cashfree order for an existing internal payment.
   */
  private async createCashfreeOrderForPayment(
    payment: Payment,
    fee: { amount: Decimal; currency: string; description: string },
  ): Promise<CreatePaymentResponseDto> {
    try {
      const cashfreeOrder = await this.cashfreeService.createOrder({
        order_id: payment.orderId,
        order_amount: Number(fee.amount),
        order_currency: fee.currency,
        customer_details: {
          customer_id: payment.studentId,
          customer_phone: '9999999999', // Required by Cashfree - real ERP would provide this
        },
        order_note: fee.description,
      });

      // Update payment with Cashfree order ID
      await this.paymentsRepository.updateWithCashfreeOrder(
        payment.id,
        cashfreeOrder.cf_order_id,
      );

      this.logger.log(
        `Payment ${payment.orderId} created with Cashfree order ${cashfreeOrder.cf_order_id}`,
      );

      return this.toCreateResponse(payment, cashfreeOrder.payment_session_id);
    } catch (error) {
      // Mark payment as failed if Cashfree order creation fails
      this.logger.error(
        `Cashfree order creation failed for ${payment.orderId}: ${error instanceof Error ? error.message : 'Unknown'}`,
      );

      await this.paymentsRepository.updatePaymentStatus(
        payment.id,
        PaymentStatusEnum.CREATED,
        PaymentStatusEnum.FAILED,
        {
          failureReason: 'Payment gateway order creation failed',
        },
      );

      throw new InternalServerErrorException(
        'Failed to create payment order. Please try again.',
      );
    }
  }

  /**
   * Settle the ERP fee after confirmed payment.
   * Idempotent: safe to call multiple times.
   */
  private async settleFee(
    feeReference: string,
    studentId: string,
    paymentId: string,
  ): Promise<boolean> {
    try {
      const settled = await this.feeRepository.settleFee(feeReference, studentId);
      if (settled) {
        await this.paymentsRepository.updatePaymentStatus(
          paymentId,
          PaymentStatusEnum.PAID,
          PaymentStatusEnum.PAID,
          { feeSettled: true },
        );
        this.logger.log(`ERP fee ${feeReference} settled for student ${studentId}`);
      }
      return settled;
    } catch (error) {
      // Fee settlement failure is logged but doesn't fail the payment verification.
      // A reconciliation job should pick this up and retry.
      this.logger.error(
        `Failed to settle ERP fee ${feeReference}: ${error instanceof Error ? error.message : 'Unknown'}. ` +
          `Payment ${paymentId} is PAID but fee settlement needs manual reconciliation.`,
      );
      return false;
    }
  }

  /**
   * Map Cashfree payment status to internal attempt status.
   */
  private mapCashfreePaymentStatus(cfStatus: string): $Enums.PaymentAttemptStatus {
    switch (cfStatus) {
      case 'SUCCESS':
        return 'SUCCESS' as $Enums.PaymentAttemptStatus;
      case 'FAILED':
        return 'FAILED' as $Enums.PaymentAttemptStatus;
      case 'USER_DROPPED':
        return 'USER_DROPPED' as $Enums.PaymentAttemptStatus;
      case 'PENDING':
      case 'NOT_ATTEMPTED':
      default:
        return 'PENDING' as $Enums.PaymentAttemptStatus;
    }
  }

  /**
   * Map a Payment entity to the API response DTO.
   */
  private toResponse(
    payment: Payment,
    attempts?: PaymentAttempt[],
  ): PaymentResponseDto {
    const response: PaymentResponseDto = {
      orderId: payment.orderId,
      feeReference: payment.feeReference,
      amount: payment.amount.toString(),
      currency: payment.currency,
      status: payment.status,
      description: payment.description,
      createdAt: payment.createdAt,
      updatedAt: payment.updatedAt,
      paidAt: payment.paidAt,
    };

    if (attempts) {
      response.attempts = attempts.map(this.toAttemptResponse);
    }

    return response;
  }

  private toCreateResponse(
    payment: Payment,
    paymentSessionId: string,
  ): CreatePaymentResponseDto {
    return {
      ...this.toResponse(payment),
      paymentSessionId,
    };
  }

  private toAttemptResponse(attempt: PaymentAttempt): PaymentAttemptResponseDto {
    return {
      cashfreePaymentId: attempt.cashfreePaymentId,
      attemptNumber: attempt.attemptNumber,
      status: attempt.status,
      paymentMethod: attempt.paymentMethod,
      failureCode: attempt.failureCode,
      failureMessage: attempt.failureMessage,
      createdAt: attempt.createdAt,
    };
  }
}
