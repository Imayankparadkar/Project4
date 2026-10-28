import { Injectable, Logger } from '@nestjs/common';
import { Decimal } from '@prisma/client/runtime/library';

/**
 * Fee record as provided by the ERP system.
 */
export interface FeeRecord {
  feeReference: string;
  studentId: string;
  amount: Decimal;
  currency: string;
  description: string;
  isPaid: boolean;
}

/**
 * Abstract fee repository interface.
 *
 * This defines the boundary between the payment module and the ERP system.
 * In production, implement this interface to query the real UMS/ERP database
 * or call the ERP's fee service API.
 *
 * The payment module NEVER trusts client-supplied amounts - it always
 * resolves the authoritative fee record through this repository.
 */
@Injectable()
export abstract class FeeRepository {
  /**
   * Look up a fee by its reference ID and the student who owns it.
   * Returns null if the fee doesn't exist or doesn't belong to the student.
   */
  abstract findFee(feeReference: string, studentId: string): Promise<FeeRecord | null>;

  /**
   * Mark a fee as paid in the ERP system.
   * This is called ONLY after payment is verified as successful.
   *
   * Must be idempotent: calling it multiple times for the same fee
   * must not produce errors or duplicate settlements.
   *
   * @returns true if the fee was settled (or was already settled), false on failure
   */
  abstract settleFee(feeReference: string, studentId: string): Promise<boolean>;
}
