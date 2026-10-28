import { Injectable, Logger } from '@nestjs/common';
import { Decimal } from '@prisma/client/runtime/library';
import { FeeRepository, FeeRecord } from './fee.repository';

/**
 * Mock fee repository for development and testing.
 *
 * ⚠️ This is NOT a production implementation. It provides static fee data
 * so the payment module can be tested standalone without a real UMS/ERP.
 *
 * To integrate with a real ERP:
 * 1. Create a new class implementing FeeRepository
 * 2. Query the ERP database or call its API for fee lookups
 * 3. Replace MockFeeRepository with your implementation in CommonModule
 */
@Injectable()
export class MockFeeRepository extends FeeRepository {
  private readonly logger = new Logger(MockFeeRepository.name);

  // In-memory store of settled fees (simulates ERP state)
  private readonly settledFees = new Set<string>();

  // Static fee data for development/testing
  private readonly fees: FeeRecord[] = [
    {
      feeReference: 'FEE-2024-SEM1-001',
      studentId: 'STU-001',
      amount: new Decimal('15000.00'),
      currency: 'INR',
      description: 'Semester 1 Tuition Fee - Computer Science',
      isPaid: false,
    },
    {
      feeReference: 'FEE-2024-SEM1-002',
      studentId: 'STU-001',
      amount: new Decimal('5000.00'),
      currency: 'INR',
      description: 'Semester 1 Library Fee',
      isPaid: false,
    },
    {
      feeReference: 'FEE-2024-SEM1-003',
      studentId: 'STU-002',
      amount: new Decimal('15000.00'),
      currency: 'INR',
      description: 'Semester 1 Tuition Fee - Electronics',
      isPaid: false,
    },
    {
      feeReference: 'FEE-2024-EXAM-001',
      studentId: 'STU-001',
      amount: new Decimal('2500.00'),
      currency: 'INR',
      description: 'Mid-term Examination Fee',
      isPaid: false,
    },
    {
      feeReference: 'FEE-ALREADY-PAID',
      studentId: 'STU-001',
      amount: new Decimal('1000.00'),
      currency: 'INR',
      description: 'Registration Fee (Already Paid)',
      isPaid: true,
    },
  ];

  async findFee(feeReference: string, studentId: string): Promise<FeeRecord | null> {
    this.logger.debug(`Looking up fee: ${feeReference} for student: ${studentId}`);

    const fee = this.fees.find(
      (f) => f.feeReference === feeReference && f.studentId === studentId,
    );

    if (!fee) {
      return null;
    }

    // Check if fee was settled at runtime
    const isSettled = this.settledFees.has(`${feeReference}:${studentId}`);
    return {
      ...fee,
      isPaid: fee.isPaid || isSettled,
    };
  }

  async settleFee(feeReference: string, studentId: string): Promise<boolean> {
    const key = `${feeReference}:${studentId}`;

    // Idempotent: if already settled, just return true
    if (this.settledFees.has(key)) {
      this.logger.log(`Fee ${feeReference} already settled for student ${studentId}`);
      return true;
    }

    this.settledFees.add(key);
    this.logger.log(`✅ Fee ${feeReference} settled for student ${studentId}`);
    return true;
  }
}
