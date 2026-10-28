import {
  PaymentStatusEnum,
  isValidStatusTransition,
} from './enums/payment-status.enum';

/**
 * Tests for the payment state machine transition rules.
 */
describe('Payment State Machine', () => {
  describe('isValidStatusTransition', () => {
    // Same-status transitions (idempotent)
    it('should allow same-status transitions', () => {
      expect(isValidStatusTransition(PaymentStatusEnum.CREATED, PaymentStatusEnum.CREATED)).toBe(true);
      expect(isValidStatusTransition(PaymentStatusEnum.PENDING, PaymentStatusEnum.PENDING)).toBe(true);
      expect(isValidStatusTransition(PaymentStatusEnum.PAID, PaymentStatusEnum.PAID)).toBe(true);
    });

    // Valid forward transitions
    it('should allow CREATED → PENDING', () => {
      expect(isValidStatusTransition(PaymentStatusEnum.CREATED, PaymentStatusEnum.PENDING)).toBe(true);
    });

    it('should allow CREATED → FAILED', () => {
      expect(isValidStatusTransition(PaymentStatusEnum.CREATED, PaymentStatusEnum.FAILED)).toBe(true);
    });

    it('should allow CREATED → EXPIRED', () => {
      expect(isValidStatusTransition(PaymentStatusEnum.CREATED, PaymentStatusEnum.EXPIRED)).toBe(true);
    });

    it('should allow PENDING → PAID', () => {
      expect(isValidStatusTransition(PaymentStatusEnum.PENDING, PaymentStatusEnum.PAID)).toBe(true);
    });

    it('should allow PENDING → FAILED', () => {
      expect(isValidStatusTransition(PaymentStatusEnum.PENDING, PaymentStatusEnum.FAILED)).toBe(true);
    });

    it('should allow PENDING → CANCELLED', () => {
      expect(isValidStatusTransition(PaymentStatusEnum.PENDING, PaymentStatusEnum.CANCELLED)).toBe(true);
    });

    it('should allow PENDING → EXPIRED', () => {
      expect(isValidStatusTransition(PaymentStatusEnum.PENDING, PaymentStatusEnum.EXPIRED)).toBe(true);
    });

    // Retry transitions
    it('should allow FAILED → PENDING (retry)', () => {
      expect(isValidStatusTransition(PaymentStatusEnum.FAILED, PaymentStatusEnum.PENDING)).toBe(true);
    });

    it('should allow FAILED → PAID (verification after failure)', () => {
      expect(isValidStatusTransition(PaymentStatusEnum.FAILED, PaymentStatusEnum.PAID)).toBe(true);
    });

    // CRITICAL: Terminal state protection
    it('should NEVER allow PAID → FAILED (late failure must not overwrite success)', () => {
      expect(isValidStatusTransition(PaymentStatusEnum.PAID, PaymentStatusEnum.FAILED)).toBe(false);
    });

    it('should NEVER allow PAID → CANCELLED', () => {
      expect(isValidStatusTransition(PaymentStatusEnum.PAID, PaymentStatusEnum.CANCELLED)).toBe(false);
    });

    it('should NEVER allow PAID → EXPIRED', () => {
      expect(isValidStatusTransition(PaymentStatusEnum.PAID, PaymentStatusEnum.EXPIRED)).toBe(false);
    });

    it('should NEVER allow PAID → PENDING', () => {
      expect(isValidStatusTransition(PaymentStatusEnum.PAID, PaymentStatusEnum.PENDING)).toBe(false);
    });

    it('should NEVER allow PAID → CREATED', () => {
      expect(isValidStatusTransition(PaymentStatusEnum.PAID, PaymentStatusEnum.CREATED)).toBe(false);
    });

    // Other terminal states
    it('should not allow CANCELLED → any other state', () => {
      expect(isValidStatusTransition(PaymentStatusEnum.CANCELLED, PaymentStatusEnum.PENDING)).toBe(false);
      expect(isValidStatusTransition(PaymentStatusEnum.CANCELLED, PaymentStatusEnum.PAID)).toBe(false);
      expect(isValidStatusTransition(PaymentStatusEnum.CANCELLED, PaymentStatusEnum.FAILED)).toBe(false);
    });

    it('should not allow EXPIRED → any other state', () => {
      expect(isValidStatusTransition(PaymentStatusEnum.EXPIRED, PaymentStatusEnum.PENDING)).toBe(false);
      expect(isValidStatusTransition(PaymentStatusEnum.EXPIRED, PaymentStatusEnum.PAID)).toBe(false);
      expect(isValidStatusTransition(PaymentStatusEnum.EXPIRED, PaymentStatusEnum.FAILED)).toBe(false);
    });

    // Invalid direct transitions
    it('should not allow CREATED → PAID (must go through PENDING)', () => {
      expect(isValidStatusTransition(PaymentStatusEnum.CREATED, PaymentStatusEnum.PAID)).toBe(false);
    });

    it('should not allow CREATED → CANCELLED', () => {
      expect(isValidStatusTransition(PaymentStatusEnum.CREATED, PaymentStatusEnum.CANCELLED)).toBe(false);
    });
  });
});
