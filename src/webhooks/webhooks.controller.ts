import {
  Controller,
  Post,
  Req,
  Headers,
  HttpCode,
  HttpStatus,
  RawBodyRequest,
  Logger,
  BadRequestException,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiHeader, ApiExcludeEndpoint } from '@nestjs/swagger';
import { SkipThrottle } from '@nestjs/throttler';
import { Request } from 'express';
import { WebhooksService } from './webhooks.service';

/**
 * Cashfree webhook receiver controller.
 *
 * CRITICAL IMPLEMENTATION NOTES:
 * 1. Uses raw body (Buffer) for signature verification - NOT parsed JSON
 * 2. Signature is verified BEFORE any event processing
 * 3. Rate limiting is skipped because Cashfree controls the request rate
 * 4. Always returns 200 for valid signatures to prevent Cashfree from retrying
 *    events we've already accepted (even if processing fails internally)
 */
@ApiTags('Webhooks')
@SkipThrottle() // Webhooks come from Cashfree, not end users
@Controller('webhooks')
export class WebhooksController {
  private readonly logger = new Logger(WebhooksController.name);

  constructor(private readonly webhooksService: WebhooksService) {}

  /**
   * Receive and process Cashfree payment webhooks.
   *
   * Cashfree sends webhooks for:
   * - PAYMENT_SUCCESS_WEBHOOK
   * - PAYMENT_FAILED_WEBHOOK
   * - PAYMENT_USER_DROPPED_WEBHOOK
   */
  @Post('cashfree')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Cashfree webhook receiver',
    description:
      'Receives payment status webhooks from Cashfree. ' +
      'Verifies the HMAC-SHA256 signature before processing. ' +
      'Handles duplicate deliveries safely via database-level deduplication.',
  })
  @ApiHeader({
    name: 'x-webhook-signature',
    description: 'HMAC-SHA256 signature from Cashfree',
    required: true,
  })
  @ApiHeader({
    name: 'x-webhook-timestamp',
    description: 'Timestamp of the webhook event',
    required: true,
  })
  @ApiResponse({
    status: 200,
    description: 'Webhook accepted and processed',
    schema: {
      properties: {
        status: { type: 'string', example: 'ok' },
      },
    },
  })
  @ApiResponse({ status: 400, description: 'Invalid signature or missing headers' })
  async handleCashfreeWebhook(
    @Req() request: RawBodyRequest<Request>,
    @Headers('x-webhook-signature') signature: string,
    @Headers('x-webhook-timestamp') timestamp: string,
  ): Promise<{ status: string }> {
    // Validate required headers
    if (!signature || !timestamp) {
      throw new BadRequestException('Missing webhook signature or timestamp headers');
    }

    // Get the raw body for signature verification
    // NestJS rawBody option preserves the exact bytes
    const rawBody = request.rawBody;
    if (!rawBody) {
      this.logger.error('Raw body not available - check NestFactory rawBody option');
      throw new BadRequestException('Unable to verify webhook signature');
    }

    const rawBodyString = rawBody.toString('utf-8');

    // Process the webhook (signature verification happens inside)
    await this.webhooksService.processWebhook(rawBodyString, timestamp, signature);

    return { status: 'ok' };
  }

  /**
   * Retry processing of failed webhook events.
   *
   * This endpoint allows manual or automated reconciliation of webhook events
   * that failed during initial processing. Safe to call repeatedly due to:
   * - Optimistic concurrency on payment status updates
   * - PAID is a terminal state (never overwritten)
   * - Fee settlement is idempotent (checked before executing)
   */
  @Post('retry')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Retry failed webhook events',
    description:
      'Retries processing of webhook events that previously failed. ' +
      'Safe to call repeatedly — idempotent payment processing prevents duplicates.',
  })
  @ApiResponse({
    status: 200,
    description: 'Retry results',
    schema: {
      properties: {
        retried: { type: 'number', example: 3 },
        succeeded: { type: 'number', example: 2 },
      },
    },
  })
  async retryFailedWebhooks(): Promise<{ retried: number; succeeded: number }> {
    return this.webhooksService.retryFailedEvents();
  }
}
