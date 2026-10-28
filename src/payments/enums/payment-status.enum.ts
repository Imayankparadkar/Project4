/**
 * Payment status enum matching the Prisma schema.
 * Defines the payment state machine.
 *
 * State Machine Transitions:
 * ──────────────────────────
 * CREATED  → PENDING   (Cashfree order successfully created)
 * CREATED  → FAILED    (Cashfree order creation failed)
 * CREATED  → EXPIRED   (Timeout before order creation)
 * PENDING  → PAID      (Payment verified as successful)
 * PENDING  → FAILED    (All payment attempts failed)
 * PENDING  → CANCELLED (User/system cancelled)
 * PENDING  → EXPIRED   (Order expired without payment)
 * FAILED   → PENDING   (New payment attempt started - only if retries allowed)
 *
 * Terminal states: PAID, CANCELLED, EXPIRED
 * PAID can NEVER transition to any other state.
 * A late FAILED webhook must NOT overwrite PAID.
 */
export enum PaymentStatusEnum {
  CREATED = 'CREATED',
  PENDING = 'PENDING',
  PAID = 'PAID',
  FAILED = 'FAILED',
  CANCELLED = 'CANCELLED',
  EXPIRED = 'EXPIRED',
}

/**
 * Validates whether a payment status transition is allowed.
 * This prevents invalid state changes, especially from stale/out-of-order events.
 *
 * KEY SAFETY RULE: Once PAID, the status NEVER changes.
 * This protects against late failure webhooks overwriting verified payments.
 */
export function isValidStatusTransition(
  currentStatus: PaymentStatusEnum,
  newStatus: PaymentStatusEnum,
): boolean {
  // Same status transitions are always allowed (idempotent)
  if (currentStatus === newStatus) return true;

  const allowedTransitions: Record<PaymentStatusEnum, PaymentStatusEnum[]> = {
    [PaymentStatusEnum.CREATED]: [
      PaymentStatusEnum.PENDING,
      PaymentStatusEnum.FAILED,
      PaymentStatusEnum.EXPIRED,
    ],
    [PaymentStatusEnum.PENDING]: [
      PaymentStatusEnum.PAID,
      PaymentStatusEnum.FAILED,
      PaymentStatusEnum.CANCELLED,
      PaymentStatusEnum.EXPIRED,
    ],
    [PaymentStatusEnum.FAILED]: [
      // Allow retry: FAILED → PENDING (new attempt)
      PaymentStatusEnum.PENDING,
      // Direct verification can mark as PAID if gateway says success
      PaymentStatusEnum.PAID,
    ],
    // Terminal states - no transitions out
    [PaymentStatusEnum.PAID]: [],
    [PaymentStatusEnum.CANCELLED]: [],
    [PaymentStatusEnum.EXPIRED]: [],
  };

  return allowedTransitions[currentStatus]?.includes(newStatus) ?? false;
}
