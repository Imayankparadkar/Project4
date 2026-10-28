import {
  Injectable,
  Logger,
  BadRequestException,
  InternalServerErrorException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CashfreeService } from '../cashfree/cashfree.service';
import { PaymentsService } from '../payments/payments.service';
import {
  CashfreeWebhookPayload,
  CashfreeWebhookEventType,
} from '../cashfree/cashfree.types';
import { Prisma } from '@prisma/client';

/**
 * Webhook processing service.
 *
 * Handles:
 * 1. Signature verification (must happen before any processing)
 * 2. Event deduplication via database unique constraint
 * 3. Payment status updates via PaymentsService
 * 4. Recording webhook events for audit trail
 *
 * DEDUPLICATION STRATEGY:
 * Since Cashfree doesn't guarantee a universal unique event ID in every payload,
 * we construct a composite deduplication key from:
 *   eventType + ":" + orderId + ":" + paymentId (or "none")
 *
 * This ensures the same event (e.g., PAYMENT_SUCCESS for order X, payment Y)
 * is processed exactly once, even if delivered multiple times.
 */
@Injectable()
export class WebhooksService {
  private readonly logger = new Logger(WebhooksService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly cashfreeService: CashfreeService,
    private readonly paymentsService: PaymentsService,
  ) {}

  /**
   * Process an incoming Cashfree webhook.
   *
   * Steps:
   * 1. Verify HMAC-SHA256 signature
   * 2. Parse and validate the event payload
   * 3. Check for duplicate delivery (database constraint)
   * 4. Process the event (update payment status)
   * 5. Record the event with processing status
   */
  async processWebhook(
    rawBody: string,
    timestamp: string,
    signature: string,
  ): Promise<void> {
    // Step 1: Verify signature BEFORE any processing
    const isValid = this.cashfreeService.verifyWebhookSignature(
      rawBody,
      timestamp,
      signature,
    );

    if (!isValid) {
      this.logger.warn('Webhook signature verification failed');
      throw new BadRequestException('Invalid webhook signature');
    }

    // Step 2: Parse the payload (only after signature is verified)
    let payload: CashfreeWebhookPayload;
    try {
      payload = JSON.parse(rawBody);
    } catch {
      this.logger.error('Failed to parse webhook payload after signature verification');
      throw new BadRequestException('Invalid webhook payload');
    }

    // Validate required fields
    if (!payload.type || !payload.data?.order?.order_id) {
      this.logger.error('Webhook payload missing required fields');
      throw new BadRequestException('Webhook payload missing required fields');
    }

    const eventType = payload.type;
    const orderId = payload.data.order.order_id;
    const paymentId = payload.data.payment?.cf_payment_id || 'none';

    // Step 3: Construct deduplication key
    const eventKey = `${eventType}:${orderId}:${paymentId}`;

    // Step 4 & 5: Record and process the event atomically
    try {
      // Try to create the webhook event record (unique constraint on eventKey handles dedup)
      const webhookEvent = await this.prisma.webhookEvent.create({
        data: {
          eventKey,
          eventType,
          cashfreeOrderId: orderId,
          cashfreePaymentId: paymentId !== 'none' ? paymentId : null,
          processingStatus: 'PROCESSING',
          rawPayload: this.sanitizePayload(payload),
        },
      });

      try {
        // Process the event
        await this.processEvent(payload, webhookEvent.id);

        // Mark as processed
        await this.prisma.webhookEvent.update({
          where: { id: webhookEvent.id },
          data: {
            processingStatus: 'PROCESSED',
            processedAt: new Date(),
          },
        });

        this.logger.log(`Webhook processed: ${eventType} for order ${orderId}`);
      } catch (error) {
        // Mark as failed but DON'T rethrow - we've accepted the event
        const errorMessage =
          error instanceof Error ? error.message : 'Unknown processing error';

        await this.prisma.webhookEvent.update({
          where: { id: webhookEvent.id },
          data: {
            processingStatus: 'FAILED',
            processedAt: new Date(),
            processingError: errorMessage.substring(0, 500), // Truncate for safety
          },
        });

        this.logger.error(
          `Webhook processing failed for ${eventKey}: ${errorMessage}`,
        );
        // Don't throw - return 200 to Cashfree so it doesn't retry
        // Failed events can be reconciled later
      }
    } catch (error) {
      // Handle duplicate event (unique constraint violation)
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        this.logger.log(`Duplicate webhook ignored: ${eventKey}`);
        // Return successfully - duplicate events are expected and safe to ignore
        return;
      }

      this.logger.error(
        `Failed to record webhook event: ${error instanceof Error ? error.message : 'Unknown'}`,
      );
      throw new InternalServerErrorException('Failed to process webhook');
    }
  }

  /**
   * Process a specific webhook event based on its type.
   */
  private async processEvent(
    payload: CashfreeWebhookPayload,
    webhookEventId: string,
  ): Promise<void> {
    const { type, data } = payload;
    const order = data.order;
    const payment = data.payment;

    if (!payment) {
      this.logger.warn(`Webhook ${type} has no payment data - skipping`);
      return;
    }

    switch (type) {
      case CashfreeWebhookEventType.PAYMENT_SUCCESS:
      case CashfreeWebhookEventType.PAYMENT_FAILED:
      case CashfreeWebhookEventType.PAYMENT_USER_DROPPED: {
        // Extract payment method safely (just the type, no sensitive details)
        let paymentMethodType: string | null = null;
        if (payment.payment_method) {
          // payment_method is an object like { upi: {...} } or { card: {...} }
          paymentMethodType = Object.keys(payment.payment_method)[0] || null;
        }

        const result = await this.paymentsService.processWebhookPaymentUpdate(
          order.order_id,
          payment.cf_payment_id,
          payment.payment_status,
          paymentMethodType,
          payment.error_details?.error_code || null,
          payment.error_details?.error_description || null,
          order.order_amount,
          order.order_currency,
        );

        // Link webhook event to internal payment
        if (result.paymentId) {
          await this.prisma.webhookEvent.update({
            where: { id: webhookEventId },
            data: { paymentId: result.paymentId },
          });
        }

        break;
      }
      default:
        this.logger.warn(`Unknown webhook event type: ${type}`);
        // Don't throw - unknown events are logged but not failures
        break;
    }
  }

  /**
   * Sanitize webhook payload for storage.
   * Removes any potentially sensitive data before persisting.
   */
  private sanitizePayload(payload: CashfreeWebhookPayload): Prisma.InputJsonValue {
    const sanitized: Record<string, Prisma.InputJsonValue> = {
      type: payload.type,
      event_time: payload.event_time,
      order: {
        order_id: payload.data.order.order_id,
        order_amount: payload.data.order.order_amount,
        order_currency: payload.data.order.order_currency,
        order_status: payload.data.order.order_status,
      },
    };

    if (payload.data.payment) {
      sanitized.payment = {
        cf_payment_id: payload.data.payment.cf_payment_id,
        payment_status: payload.data.payment.payment_status,
        payment_amount: payload.data.payment.payment_amount,
        payment_currency: payload.data.payment.payment_currency,
        // Only store payment method TYPE, not details (no card numbers, etc.)
        payment_method_type: payload.data.payment.payment_method
          ? Object.keys(payload.data.payment.payment_method)[0]
          : null,
        error_details: payload.data.payment.error_details
          ? {
              error_code: payload.data.payment.error_details.error_code,
              error_reason: payload.data.payment.error_details.error_reason,
            }
          : null,
      };
    }

    return sanitized;
  }
}
