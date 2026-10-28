import { Test, TestingModule } from '@nestjs/testing';
import { CashfreeService } from './cashfree.service';
import { ConfigService } from '@nestjs/config';
import * as crypto from 'crypto';

describe('CashfreeService', () => {
  let service: CashfreeService;

  const mockConfigValues: Record<string, string> = {
    CASHFREE_BASE_URL: 'https://sandbox.cashfree.com/pg',
    CASHFREE_CLIENT_ID: 'test_client_id',
    CASHFREE_CLIENT_SECRET: 'test_client_secret',
    CASHFREE_API_VERSION: '2025-01-01',
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CashfreeService,
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn((key: string, defaultValue?: string) => {
              return mockConfigValues[key] || defaultValue;
            }),
          },
        },
      ],
    }).compile();

    service = module.get<CashfreeService>(CashfreeService);
  });

  describe('verifyWebhookSignature', () => {
    it('should verify a valid webhook signature', () => {
      const rawBody = '{"type":"PAYMENT_SUCCESS_WEBHOOK","data":{}}';
      const timestamp = '1705302300000';
      const secret = 'test_client_secret';

      // Compute expected signature
      const signatureData = timestamp + rawBody;
      const expectedSignature = crypto
        .createHmac('sha256', secret)
        .update(signatureData)
        .digest('base64');

      const result = service.verifyWebhookSignature(rawBody, timestamp, expectedSignature);
      expect(result).toBe(true);
    });

    it('should reject an invalid webhook signature', () => {
      const rawBody = '{"type":"PAYMENT_SUCCESS_WEBHOOK","data":{}}';
      const timestamp = '1705302300000';

      const result = service.verifyWebhookSignature(rawBody, timestamp, 'invalid_signature');
      expect(result).toBe(false);
    });

    it('should reject when raw body has been tampered with', () => {
      const originalBody = '{"type":"PAYMENT_SUCCESS_WEBHOOK","data":{}}';
      const tamperedBody = '{"type":"PAYMENT_SUCCESS_WEBHOOK","data":{"hacked":true}}';
      const timestamp = '1705302300000';
      const secret = 'test_client_secret';

      // Compute signature for original body
      const signatureData = timestamp + originalBody;
      const signature = crypto
        .createHmac('sha256', secret)
        .update(signatureData)
        .digest('base64');

      // Verify with tampered body
      const result = service.verifyWebhookSignature(tamperedBody, timestamp, signature);
      expect(result).toBe(false);
    });

    it('should reject when timestamp has been modified', () => {
      const rawBody = '{"type":"PAYMENT_SUCCESS_WEBHOOK","data":{}}';
      const originalTimestamp = '1705302300000';
      const modifiedTimestamp = '9999999999999';
      const secret = 'test_client_secret';

      // Compute signature for original timestamp
      const signatureData = originalTimestamp + rawBody;
      const signature = crypto
        .createHmac('sha256', secret)
        .update(signatureData)
        .digest('base64');

      // Verify with modified timestamp
      const result = service.verifyWebhookSignature(rawBody, modifiedTimestamp, signature);
      expect(result).toBe(false);
    });
  });
});
