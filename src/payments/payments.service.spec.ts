import { Test, TestingModule } from '@nestjs/testing';
import { PaymentsService } from './payments.service';
import { PaymentsRepository } from './payments.repository';
import { CashfreeService } from '../cashfree/cashfree.service';
import { FeeRepository } from '../common/repositories/fee.repository';
import {
  ConflictException,
  NotFoundException,
  ForbiddenException,
  BadRequestException,
  InternalServerErrorException,
} from '@nestjs/common';
import { Decimal } from '@prisma/client/runtime/library';
import { PaymentStatusEnum } from './enums/payment-status.enum';

/**
 * Unit tests for PaymentsService.
 *
 * All Cashfree HTTP requests and database operations are mocked.
 * These tests verify business logic, state machine rules, and error handling.
 */
describe('PaymentsService', () => {
  let service: PaymentsService;
  let paymentsRepository: jest.Mocked<PaymentsRepository>;
  let cashfreeService: jest.Mocked<CashfreeService>;
  let feeRepository: jest.Mocked<FeeRepository>;

  // Test data factories
  const mockFeeRecord = {
    feeReference: 'FEE-2024-SEM1-001',
    studentId: 'STU-001',
    amount: new Decimal('15000.00'),
    currency: 'INR',
    description: 'Semester 1 Tuition Fee',
    isPaid: false,
  };

  const mockPayment = {
    id: 'pay-uuid-1',
    orderId: 'TXN-abc123def456',
    feeReference: 'FEE-2024-SEM1-001',
    studentId: 'STU-001',
    amount: new Decimal('15000.00'),
    currency: 'INR',
    status: 'CREATED' as const,
    cashfreeOrderId: null,
    idempotencyKey: 'idem-key-1',
    description: 'Semester 1 Tuition Fee',
    feeSettled: false,
    failureReason: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    paidAt: null,
  };

  const mockCashfreeOrderResponse = {
    cf_order_id: 'cf_order_123',
    order_id: 'TXN-abc123def456',
    entity: 'order',
    order_currency: 'INR',
    order_amount: 15000.0,
    order_status: 'ACTIVE' as const,
    payment_session_id: 'session_test_abc123',
    order_expiry_time: '2024-01-16T10:30:00+05:30',
    customer_details: {
      customer_id: 'STU-001',
      customer_phone: '9999999999',
    },
    created_at: '2024-01-15T10:30:00+05:30',
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PaymentsService,
        {
          provide: PaymentsRepository,
          useValue: {
            createPayment: jest.fn(),
            findByOrderId: jest.fn(),
            findByIdempotencyKey: jest.fn(),
            findByCashfreeOrderId: jest.fn(),
            updatePaymentStatus: jest.fn(),
            updateWithCashfreeOrder: jest.fn(),
            createPaymentAttempt: jest.fn(),
            getNextAttemptNumber: jest.fn(),
            updatePaymentAttempt: jest.fn(),
            executeInTransaction: jest.fn(),
          },
        },
        {
          provide: CashfreeService,
          useValue: {
            createOrder: jest.fn(),
            fetchOrder: jest.fn(),
            fetchPaymentsForOrder: jest.fn(),
            verifyWebhookSignature: jest.fn(),
          },
        },
        {
          provide: FeeRepository,
          useValue: {
            findFee: jest.fn(),
            settleFee: jest.fn(),
          },
        },
      ],
    }).compile();

    service = module.get<PaymentsService>(PaymentsService);
    paymentsRepository = module.get(PaymentsRepository);
    cashfreeService = module.get(CashfreeService);
    feeRepository = module.get(FeeRepository);
  });

  // =========================================================================
  // 1. Successful payment creation
  // =========================================================================
  describe('createPayment', () => {
    it('should create a payment successfully', async () => {
      feeRepository.findFee.mockResolvedValue(mockFeeRecord);
      paymentsRepository.findByIdempotencyKey.mockResolvedValue(null);
      paymentsRepository.createPayment.mockResolvedValue(mockPayment);
      cashfreeService.createOrder.mockResolvedValue(mockCashfreeOrderResponse);
      paymentsRepository.updateWithCashfreeOrder.mockResolvedValue({
        ...mockPayment,
        cashfreeOrderId: 'cf_order_123',
        status: 'PENDING',
      });

      const result = await service.createPayment(
        { feeReference: 'FEE-2024-SEM1-001', idempotencyKey: 'idem-key-1' },
        'STU-001',
      );

      expect(result.orderId).toBe('TXN-abc123def456');
      expect(result.paymentSessionId).toBe('session_test_abc123');
      expect(result.amount).toBe('15000');
      expect(result.currency).toBe('INR');
      expect(cashfreeService.createOrder).toHaveBeenCalledWith(
        expect.objectContaining({
          order_amount: 15000,
          order_currency: 'INR',
          customer_details: expect.objectContaining({
            customer_id: 'STU-001',
          }),
        }),
      );
    });

    // =========================================================================
    // 2. Invalid fee reference
    // =========================================================================
    it('should throw NotFoundException for invalid fee reference', async () => {
      feeRepository.findFee.mockResolvedValue(null);

      await expect(
        service.createPayment(
          { feeReference: 'INVALID-FEE', idempotencyKey: 'idem-key-2' },
          'STU-001',
        ),
      ).rejects.toThrow(NotFoundException);
    });

    // =========================================================================
    // 3. Already-paid fee
    // =========================================================================
    it('should throw ConflictException for already paid fee', async () => {
      feeRepository.findFee.mockResolvedValue({
        ...mockFeeRecord,
        isPaid: true,
      });

      await expect(
        service.createPayment(
          { feeReference: 'FEE-2024-SEM1-001', idempotencyKey: 'idem-key-3' },
          'STU-001',
        ),
      ).rejects.toThrow(ConflictException);
    });

    // =========================================================================
    // 5. Repeated request with same idempotency key (same payload)
    // =========================================================================
    it('should return existing payment for same idempotency key and payload', async () => {
      feeRepository.findFee.mockResolvedValue(mockFeeRecord);
      paymentsRepository.findByIdempotencyKey.mockResolvedValue({
        ...mockPayment,
        cashfreeOrderId: 'cf_order_123',
        status: 'PENDING',
      });

      const result = await service.createPayment(
        { feeReference: 'FEE-2024-SEM1-001', idempotencyKey: 'idem-key-1' },
        'STU-001',
      );

      expect(result.orderId).toBe('TXN-abc123def456');
      // Should NOT create a new payment
      expect(paymentsRepository.createPayment).not.toHaveBeenCalled();
      expect(cashfreeService.createOrder).not.toHaveBeenCalled();
    });

    // =========================================================================
    // 6. Idempotency key reused with different payload
    // =========================================================================
    it('should throw ConflictException when idempotency key reused with different fee', async () => {
      feeRepository.findFee.mockResolvedValue(mockFeeRecord);
      paymentsRepository.findByIdempotencyKey.mockResolvedValue({
        ...mockPayment,
        feeReference: 'FEE-DIFFERENT', // Different fee reference
      });

      await expect(
        service.createPayment(
          { feeReference: 'FEE-2024-SEM1-001', idempotencyKey: 'idem-key-1' },
          'STU-001',
        ),
      ).rejects.toThrow(ConflictException);
    });

    // =========================================================================
    // 7. Cashfree order creation failure
    // =========================================================================
    it('should handle Cashfree order creation failure', async () => {
      feeRepository.findFee.mockResolvedValue(mockFeeRecord);
      paymentsRepository.findByIdempotencyKey.mockResolvedValue(null);
      paymentsRepository.createPayment.mockResolvedValue(mockPayment);
      cashfreeService.createOrder.mockRejectedValue(new Error('Cashfree API error'));
      paymentsRepository.updatePaymentStatus.mockResolvedValue({
        ...mockPayment,
        status: 'FAILED',
      });

      await expect(
        service.createPayment(
          { feeReference: 'FEE-2024-SEM1-001', idempotencyKey: 'idem-key-4' },
          'STU-001',
        ),
      ).rejects.toThrow(InternalServerErrorException);

      // Should mark payment as FAILED
      expect(paymentsRepository.updatePaymentStatus).toHaveBeenCalledWith(
        mockPayment.id,
        PaymentStatusEnum.CREATED,
        PaymentStatusEnum.FAILED,
        expect.objectContaining({ failureReason: expect.any(String) }),
      );
    });

    // =========================================================================
    // 8. Database race condition on idempotency key (P2002)
    // =========================================================================
    it('should handle database unique constraint violation on idempotency key', async () => {
      feeRepository.findFee.mockResolvedValue(mockFeeRecord);
      paymentsRepository.findByIdempotencyKey.mockResolvedValue(null);
      paymentsRepository.createPayment.mockRejectedValue(
        Object.assign(new Error('Unique constraint'), { code: 'P2002' }),
      );

      await expect(
        service.createPayment(
          { feeReference: 'FEE-2024-SEM1-001', idempotencyKey: 'idem-key-5' },
          'STU-001',
        ),
      ).rejects.toThrow(ConflictException);
    });
  });

  // =========================================================================
  // Get Payment Status
  // =========================================================================
  describe('getPaymentStatus', () => {
    it('should return payment status for authorized student', async () => {
      paymentsRepository.findByOrderId.mockResolvedValue({
        ...mockPayment,
        attempts: [],
      });

      const result = await service.getPaymentStatus('TXN-abc123def456', 'STU-001');

      expect(result.orderId).toBe('TXN-abc123def456');
      expect(result.status).toBe('CREATED');
    });

    it('should throw NotFoundException for non-existent payment', async () => {
      paymentsRepository.findByOrderId.mockResolvedValue(null);

      await expect(
        service.getPaymentStatus('TXN-nonexistent', 'STU-001'),
      ).rejects.toThrow(NotFoundException);
    });

    // =========================================================================
    // 18. Unauthorized payment access
    // =========================================================================
    it('should throw ForbiddenException for unauthorized access', async () => {
      paymentsRepository.findByOrderId.mockResolvedValue({
        ...mockPayment,
        attempts: [],
      });

      await expect(
        service.getPaymentStatus('TXN-abc123def456', 'STU-OTHER'),
      ).rejects.toThrow(ForbiddenException);
    });
  });

  // =========================================================================
  // Verify Payment
  // =========================================================================
  describe('verifyPayment', () => {
    const pendingPayment = {
      ...mockPayment,
      status: 'PENDING' as const,
      cashfreeOrderId: 'cf_order_123',
      attempts: [],
    };

    // =========================================================================
    // 10. Successful payment verification
    // =========================================================================
    it('should verify a successful payment and settle the fee', async () => {
      paymentsRepository.findByOrderId.mockResolvedValue(pendingPayment);
      cashfreeService.fetchOrder.mockResolvedValue({
        cf_order_id: 'cf_order_123',
        order_id: 'TXN-abc123def456',
        entity: 'order',
        order_currency: 'INR',
        order_amount: 15000.0,
        order_status: 'PAID',
        order_expiry_time: '2024-01-16T10:30:00+05:30',
        customer_details: { customer_id: 'STU-001', customer_phone: '9999999999' },
        created_at: '2024-01-15T10:30:00+05:30',
      });
      cashfreeService.fetchPaymentsForOrder.mockResolvedValue([
        {
          cf_payment_id: 'cf_pay_001',
          order_id: 'TXN-abc123def456',
          entity: 'payment',
          payment_currency: 'INR',
          payment_amount: 15000.0,
          payment_status: 'SUCCESS',
          payment_group: 'upi',
        },
      ]);
      paymentsRepository.updatePaymentAttempt.mockResolvedValue(null);
      paymentsRepository.createPaymentAttempt.mockResolvedValue({
        id: 'attempt-1',
        paymentId: 'pay-uuid-1',
        cashfreePaymentId: 'cf_pay_001',
        attemptNumber: 1,
        status: 'SUCCESS',
        paymentMethod: 'upi',
        failureCode: null,
        failureMessage: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      });
      paymentsRepository.getNextAttemptNumber.mockResolvedValue(1);
      paymentsRepository.updatePaymentStatus.mockResolvedValue({
        ...pendingPayment,
        status: 'PAID',
        paidAt: new Date(),
      });
      feeRepository.settleFee.mockResolvedValue(true);

      // Return updated payment on second find
      paymentsRepository.findByOrderId.mockResolvedValueOnce(pendingPayment);
      paymentsRepository.findByOrderId.mockResolvedValueOnce({
        ...pendingPayment,
        status: 'PAID',
        paidAt: new Date(),
        feeSettled: true,
        attempts: [],
      });

      const result = await service.verifyPayment('TXN-abc123def456', 'STU-001');

      expect(result.verified).toBe(true);
      expect(feeRepository.settleFee).toHaveBeenCalledWith('FEE-2024-SEM1-001', 'STU-001');
    });

    // =========================================================================
    // 9. Pending payment verification
    // =========================================================================
    it('should return unverified for pending payment', async () => {
      paymentsRepository.findByOrderId.mockResolvedValue(pendingPayment);
      cashfreeService.fetchOrder.mockResolvedValue({
        cf_order_id: 'cf_order_123',
        order_id: 'TXN-abc123def456',
        entity: 'order',
        order_currency: 'INR',
        order_amount: 15000.0,
        order_status: 'ACTIVE',
        order_expiry_time: '2024-01-16T10:30:00+05:30',
        customer_details: { customer_id: 'STU-001', customer_phone: '9999999999' },
        created_at: '2024-01-15T10:30:00+05:30',
      });
      cashfreeService.fetchPaymentsForOrder.mockResolvedValue([]);

      const result = await service.verifyPayment('TXN-abc123def456', 'STU-001');

      expect(result.verified).toBe(false);
    });

    // =========================================================================
    // 17. Payment amount mismatch
    // =========================================================================
    it('should throw on amount mismatch during verification', async () => {
      paymentsRepository.findByOrderId.mockResolvedValue(pendingPayment);
      cashfreeService.fetchOrder.mockResolvedValue({
        cf_order_id: 'cf_order_123',
        order_id: 'TXN-abc123def456',
        entity: 'order',
        order_currency: 'INR',
        order_amount: 999.0, // WRONG AMOUNT
        order_status: 'PAID',
        order_expiry_time: '2024-01-16T10:30:00+05:30',
        customer_details: { customer_id: 'STU-001', customer_phone: '9999999999' },
        created_at: '2024-01-15T10:30:00+05:30',
      });
      cashfreeService.fetchPaymentsForOrder.mockResolvedValue([]);

      await expect(
        service.verifyPayment('TXN-abc123def456', 'STU-001'),
      ).rejects.toThrow(InternalServerErrorException);
    });

    it('should throw BadRequestException when payment has no Cashfree order', async () => {
      paymentsRepository.findByOrderId.mockResolvedValue({
        ...mockPayment,
        cashfreeOrderId: null,
        attempts: [],
      });

      await expect(
        service.verifyPayment('TXN-abc123def456', 'STU-001'),
      ).rejects.toThrow(BadRequestException);
    });

    it('should return immediately for already PAID payment', async () => {
      paymentsRepository.findByOrderId.mockResolvedValue({
        ...mockPayment,
        status: 'PAID',
        cashfreeOrderId: 'cf_order_123',
        feeSettled: true,
        attempts: [],
      });

      const result = await service.verifyPayment('TXN-abc123def456', 'STU-001');

      expect(result.verified).toBe(true);
      expect(result.feeSettled).toBe(true);
      // Should NOT call Cashfree API
      expect(cashfreeService.fetchOrder).not.toHaveBeenCalled();
    });
  });

  // =========================================================================
  // Webhook payment update processing
  // =========================================================================
  describe('processWebhookPaymentUpdate', () => {
    // =========================================================================
    // 11. Failed payment attempt
    // =========================================================================
    it('should handle failed payment attempt without marking fee as paid', async () => {
      const pendingPayment = {
        ...mockPayment,
        status: 'PENDING' as const,
        cashfreeOrderId: 'cf_order_123',
        attempts: [],
      };
      paymentsRepository.findByCashfreeOrderId.mockResolvedValue(null);
      paymentsRepository.findByOrderId.mockResolvedValue(pendingPayment);
      paymentsRepository.getNextAttemptNumber.mockResolvedValue(1);
      paymentsRepository.updatePaymentAttempt.mockResolvedValue(null);
      paymentsRepository.createPaymentAttempt.mockResolvedValue({
        id: 'attempt-1',
        paymentId: 'pay-uuid-1',
        cashfreePaymentId: 'cf_pay_fail',
        attemptNumber: 1,
        status: 'FAILED',
        paymentMethod: 'card',
        failureCode: 'TRANSACTION_DECLINED',
        failureMessage: 'Insufficient funds',
        createdAt: new Date(),
        updatedAt: new Date(),
      });
      paymentsRepository.updatePaymentStatus.mockResolvedValue({
        ...pendingPayment,
        status: 'FAILED',
      });

      const result = await service.processWebhookPaymentUpdate(
        'TXN-abc123def456',
        'cf_pay_fail',
        'FAILED',
        'card',
        'TRANSACTION_DECLINED',
        'Insufficient funds',
        15000,
        'INR',
      );

      expect(result.updated).toBe(true);
      // Should NOT settle the fee
      expect(feeRepository.settleFee).not.toHaveBeenCalled();
    });

    // =========================================================================
    // 16. Out-of-order webhook: FAILED after PAID
    // =========================================================================
    it('should block FAILED transition when payment is already PAID', async () => {
      const paidPayment = {
        ...mockPayment,
        status: 'PAID' as const,
        cashfreeOrderId: 'cf_order_123',
        feeSettled: true,
        attempts: [],
      };
      paymentsRepository.findByCashfreeOrderId.mockResolvedValue(null);
      paymentsRepository.findByOrderId.mockResolvedValue(paidPayment);
      paymentsRepository.getNextAttemptNumber.mockResolvedValue(2);
      paymentsRepository.updatePaymentAttempt.mockResolvedValue(null);
      paymentsRepository.createPaymentAttempt.mockResolvedValue({
        id: 'attempt-2',
        paymentId: 'pay-uuid-1',
        cashfreePaymentId: 'cf_pay_late_fail',
        attemptNumber: 2,
        status: 'FAILED',
        paymentMethod: null,
        failureCode: null,
        failureMessage: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      const result = await service.processWebhookPaymentUpdate(
        'TXN-abc123def456',
        'cf_pay_late_fail',
        'FAILED',
        null,
        null,
        null,
        15000,
        'INR',
      );

      // Transition should be blocked
      expect(result.updated).toBe(false);
      // Should NOT call updatePaymentStatus (state machine prevents it)
      expect(paymentsRepository.updatePaymentStatus).not.toHaveBeenCalled();
    });

    // =========================================================================
    // Amount mismatch in webhook
    // =========================================================================
    it('should reject webhook with amount mismatch', async () => {
      const pendingPayment = {
        ...mockPayment,
        status: 'PENDING' as const,
        cashfreeOrderId: 'cf_order_123',
        attempts: [],
      };
      paymentsRepository.findByCashfreeOrderId.mockResolvedValue(null);
      paymentsRepository.findByOrderId.mockResolvedValue(pendingPayment);

      const result = await service.processWebhookPaymentUpdate(
        'TXN-abc123def456',
        'cf_pay_001',
        'SUCCESS',
        'upi',
        null,
        null,
        999, // WRONG AMOUNT
        'INR',
      );

      expect(result.updated).toBe(false);
    });

    // Unknown order
    it('should handle webhook for unknown order', async () => {
      paymentsRepository.findByCashfreeOrderId.mockResolvedValue(null);
      paymentsRepository.findByOrderId.mockResolvedValue(null);

      const result = await service.processWebhookPaymentUpdate(
        'UNKNOWN-ORDER',
        'cf_pay_001',
        'SUCCESS',
        null,
        null,
        null,
        1000,
        'INR',
      );

      expect(result.paymentId).toBeNull();
      expect(result.updated).toBe(false);
    });
  });

  // =========================================================================
  // 20. ERP fee update failure
  // =========================================================================
  describe('fee settlement', () => {
    it('should handle ERP fee settlement failure gracefully', async () => {
      const pendingPayment = {
        ...mockPayment,
        status: 'PENDING' as const,
        cashfreeOrderId: 'cf_order_123',
        feeSettled: false,
        attempts: [],
      };
      paymentsRepository.findByCashfreeOrderId.mockResolvedValue(null);
      paymentsRepository.findByOrderId.mockResolvedValue(pendingPayment);
      paymentsRepository.getNextAttemptNumber.mockResolvedValue(1);
      paymentsRepository.updatePaymentAttempt.mockResolvedValue(null);
      paymentsRepository.createPaymentAttempt.mockResolvedValue({
        id: 'attempt-1',
        paymentId: 'pay-uuid-1',
        cashfreePaymentId: 'cf_pay_001',
        attemptNumber: 1,
        status: 'SUCCESS',
        paymentMethod: 'upi',
        failureCode: null,
        failureMessage: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      });
      paymentsRepository.updatePaymentStatus.mockResolvedValue({
        ...pendingPayment,
        status: 'PAID',
        paidAt: new Date(),
      });

      // Fee settlement FAILS
      feeRepository.settleFee.mockRejectedValue(new Error('ERP unavailable'));

      const result = await service.processWebhookPaymentUpdate(
        'TXN-abc123def456',
        'cf_pay_001',
        'SUCCESS',
        'upi',
        null,
        null,
        15000,
        'INR',
      );

      // Payment status should still be updated
      expect(result.updated).toBe(true);
      // Fee settlement failure is logged but doesn't fail the webhook
    });
  });
});
