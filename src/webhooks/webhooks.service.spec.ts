import { Test, TestingModule } from '@nestjs/testing';
import { WebhooksService } from './webhooks.service';
import { CashfreeService } from '../cashfree/cashfree.service';
import { PaymentsService } from '../payments/payments.service';
import { PrismaService } from '../prisma/prisma.service';
import { BadRequestException } from '@nestjs/common';
import { Prisma } from '@prisma/client';

/**
 * Unit tests for WebhooksService.
 *
 * Tests webhook signature verification, deduplication, and event processing.
 */
describe('WebhooksService', () => {
  let service: WebhooksService;
  let cashfreeService: jest.Mocked<CashfreeService>;
  let paymentsService: jest.Mocked<PaymentsService>;
  let prismaService: jest.Mocked<PrismaService>;

  const validPayload = JSON.stringify({
    type: 'PAYMENT_SUCCESS_WEBHOOK',
    data: {
      order: {
        order_id: 'TXN-abc123def456',
        order_amount: 15000,
        order_currency: 'INR',
        order_status: 'PAID',
      },
      payment: {
        cf_payment_id: 'cf_pay_001',
        payment_status: 'SUCCESS',
        payment_amount: 15000,
        payment_currency: 'INR',
        payment_method: { upi: { channel: 'collect' } },
      },
    },
    event_time: '2024-01-15T10:35:00+05:30',
  });

  const validTimestamp = '1705302300000';
  const validSignature = 'valid_sig_base64';

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        WebhooksService,
        {
          provide: CashfreeService,
          useValue: {
            verifyWebhookSignature: jest.fn(),
          },
        },
        {
          provide: PaymentsService,
          useValue: {
            processWebhookPaymentUpdate: jest.fn(),
          },
        },
        {
          provide: PrismaService,
          useValue: {
            webhookEvent: {
              create: jest.fn(),
              update: jest.fn(),
            },
          },
        },
      ],
    }).compile();

    service = module.get<WebhooksService>(WebhooksService);
    cashfreeService = module.get(CashfreeService);
    paymentsService = module.get(PaymentsService);
    prismaService = module.get(PrismaService);
  });

  // =========================================================================
  // 12. Invalid webhook signature
  // =========================================================================
  describe('signature verification', () => {
    it('should reject webhook with invalid signature', async () => {
      cashfreeService.verifyWebhookSignature.mockReturnValue(false);

      await expect(
        service.processWebhook(validPayload, validTimestamp, 'invalid_signature'),
      ).rejects.toThrow(BadRequestException);

      // Should NOT attempt to process the event
      expect(prismaService.webhookEvent.create).not.toHaveBeenCalled();
    });

    it('should reject webhook with missing payload fields', async () => {
      cashfreeService.verifyWebhookSignature.mockReturnValue(true);

      const incompletePayload = JSON.stringify({ type: 'SOME_EVENT' });

      await expect(
        service.processWebhook(incompletePayload, validTimestamp, validSignature),
      ).rejects.toThrow(BadRequestException);
    });

    it('should reject webhook with invalid JSON', async () => {
      cashfreeService.verifyWebhookSignature.mockReturnValue(true);

      await expect(
        service.processWebhook('not-json{', validTimestamp, validSignature),
      ).rejects.toThrow(BadRequestException);
    });
  });

  // =========================================================================
  // 13. Valid successful webhook
  // =========================================================================
  describe('event processing', () => {
    it('should process a valid success webhook', async () => {
      cashfreeService.verifyWebhookSignature.mockReturnValue(true);
      (prismaService.webhookEvent.create as jest.Mock).mockResolvedValue({
        id: 'wh-event-1',
        eventKey: 'PAYMENT_SUCCESS_WEBHOOK:TXN-abc123def456:cf_pay_001',
        eventType: 'PAYMENT_SUCCESS_WEBHOOK',
        cashfreeOrderId: 'TXN-abc123def456',
        cashfreePaymentId: 'cf_pay_001',
        processingStatus: 'PROCESSING',
        rawPayload: {},
        receivedAt: new Date(),
        processedAt: null,
        processingError: null,
        paymentId: null,
      });
      paymentsService.processWebhookPaymentUpdate.mockResolvedValue({
        paymentId: 'pay-uuid-1',
        updated: true,
      });
      (prismaService.webhookEvent.update as jest.Mock).mockResolvedValue({});

      await service.processWebhook(validPayload, validTimestamp, validSignature);

      expect(paymentsService.processWebhookPaymentUpdate).toHaveBeenCalledWith(
        'TXN-abc123def456',
        'cf_pay_001',
        'SUCCESS',
        'upi',
        null,
        null,
        15000,
        'INR',
      );
    });

    // =========================================================================
    // Process failed webhook
    // =========================================================================
    it('should process a failed payment webhook', async () => {
      const failedPayload = JSON.stringify({
        type: 'PAYMENT_FAILED_WEBHOOK',
        data: {
          order: {
            order_id: 'TXN-abc123def456',
            order_amount: 15000,
            order_currency: 'INR',
          },
          payment: {
            cf_payment_id: 'cf_pay_fail',
            payment_status: 'FAILED',
            payment_amount: 15000,
            payment_currency: 'INR',
            error_details: {
              error_code: 'TRANSACTION_DECLINED',
              error_description: 'Insufficient funds',
              error_reason: 'bank_decline',
              error_source: 'issuer',
            },
          },
        },
        event_time: '2024-01-15T10:35:00+05:30',
      });

      cashfreeService.verifyWebhookSignature.mockReturnValue(true);
      (prismaService.webhookEvent.create as jest.Mock).mockResolvedValue({
        id: 'wh-event-2',
        eventKey: 'PAYMENT_FAILED_WEBHOOK:TXN-abc123def456:cf_pay_fail',
        eventType: 'PAYMENT_FAILED_WEBHOOK',
        cashfreeOrderId: 'TXN-abc123def456',
        cashfreePaymentId: 'cf_pay_fail',
        processingStatus: 'PROCESSING',
        rawPayload: {},
        receivedAt: new Date(),
        processedAt: null,
        processingError: null,
        paymentId: null,
      });
      paymentsService.processWebhookPaymentUpdate.mockResolvedValue({
        paymentId: 'pay-uuid-1',
        updated: true,
      });
      (prismaService.webhookEvent.update as jest.Mock).mockResolvedValue({});

      await service.processWebhook(failedPayload, validTimestamp, validSignature);

      expect(paymentsService.processWebhookPaymentUpdate).toHaveBeenCalledWith(
        'TXN-abc123def456',
        'cf_pay_fail',
        'FAILED',
        null,
        'TRANSACTION_DECLINED',
        'Insufficient funds',
        15000,
        'INR',
      );
    });
  });

  // =========================================================================
  // 14. Duplicate webhook delivery
  // =========================================================================
  describe('deduplication', () => {
    it('should silently ignore duplicate webhook delivery', async () => {
      cashfreeService.verifyWebhookSignature.mockReturnValue(true);

      // Simulate P2002 unique constraint violation
      const prismaError = new Prisma.PrismaClientKnownRequestError(
        'Unique constraint failed',
        { code: 'P2002', clientVersion: '5.0.0' },
      );
      (prismaService.webhookEvent.create as jest.Mock).mockRejectedValue(prismaError);

      // Should NOT throw - duplicates are expected
      await expect(
        service.processWebhook(validPayload, validTimestamp, validSignature),
      ).resolves.not.toThrow();

      // Should NOT process the event
      expect(paymentsService.processWebhookPaymentUpdate).not.toHaveBeenCalled();
    });
  });

  // =========================================================================
  // 19. Database failure during event processing
  // =========================================================================
  describe('error handling', () => {
    it('should handle database failure during event recording', async () => {
      cashfreeService.verifyWebhookSignature.mockReturnValue(true);
      (prismaService.webhookEvent.create as jest.Mock).mockRejectedValue(
        new Error('Database connection lost'),
      );

      await expect(
        service.processWebhook(validPayload, validTimestamp, validSignature),
      ).rejects.toThrow();
    });

    it('should mark event as failed if processing throws but still return 200', async () => {
      cashfreeService.verifyWebhookSignature.mockReturnValue(true);
      (prismaService.webhookEvent.create as jest.Mock).mockResolvedValue({
        id: 'wh-event-3',
        eventKey: 'PAYMENT_SUCCESS_WEBHOOK:TXN-abc123def456:cf_pay_001',
        eventType: 'PAYMENT_SUCCESS_WEBHOOK',
        cashfreeOrderId: 'TXN-abc123def456',
        cashfreePaymentId: 'cf_pay_001',
        processingStatus: 'PROCESSING',
        rawPayload: {},
        receivedAt: new Date(),
        processedAt: null,
        processingError: null,
        paymentId: null,
      });
      paymentsService.processWebhookPaymentUpdate.mockRejectedValue(
        new Error('Processing failed'),
      );
      (prismaService.webhookEvent.update as jest.Mock).mockResolvedValue({});

      // Should NOT throw - event accepted even if processing fails
      await expect(
        service.processWebhook(validPayload, validTimestamp, validSignature),
      ).resolves.not.toThrow();

      // Should mark as FAILED
      expect(prismaService.webhookEvent.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            processingStatus: 'FAILED',
            processingError: 'Processing failed',
          }),
        }),
      );
    });
  });
});
