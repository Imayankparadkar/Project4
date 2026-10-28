import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class PaymentAttemptResponseDto {
  @ApiProperty({ example: 'cf_pay_123456' })
  cashfreePaymentId!: string | null;

  @ApiProperty({ example: 1 })
  attemptNumber!: number;

  @ApiProperty({ example: 'SUCCESS' })
  status!: string;

  @ApiPropertyOptional({ example: 'upi' })
  paymentMethod?: string | null;

  @ApiPropertyOptional({ example: 'TRANSACTION_DECLINED' })
  failureCode?: string | null;

  @ApiPropertyOptional({ example: 'Insufficient funds' })
  failureMessage?: string | null;

  @ApiProperty({ example: '2024-01-15T10:30:00.000Z' })
  createdAt!: Date;
}

export class PaymentResponseDto {
  @ApiProperty({ example: 'TXN-a1b2c3d4' })
  orderId!: string;

  @ApiProperty({ example: 'FEE-2024-SEM1-001' })
  feeReference!: string;

  @ApiProperty({ example: '15000.00' })
  amount!: string;

  @ApiProperty({ example: 'INR' })
  currency!: string;

  @ApiProperty({
    example: 'PENDING',
    enum: ['CREATED', 'PENDING', 'PAID', 'FAILED', 'CANCELLED', 'EXPIRED'],
  })
  status!: string;

  @ApiPropertyOptional({
    description: 'Cashfree payment session ID for frontend checkout. Only returned on creation.',
    example: 'session_abc123...',
  })
  paymentSessionId?: string;

  @ApiPropertyOptional({ example: 'Semester 1 Tuition Fee' })
  description?: string | null;

  @ApiProperty({ example: '2024-01-15T10:30:00.000Z' })
  createdAt!: Date;

  @ApiProperty({ example: '2024-01-15T10:30:00.000Z' })
  updatedAt!: Date;

  @ApiPropertyOptional({ example: '2024-01-15T10:35:00.000Z' })
  paidAt?: Date | null;

  @ApiPropertyOptional({ type: [PaymentAttemptResponseDto] })
  attempts?: PaymentAttemptResponseDto[];
}

export class CreatePaymentResponseDto extends PaymentResponseDto {
  @ApiProperty({
    description: 'Cashfree payment session ID to pass to the frontend checkout SDK',
    example: 'session_a1VXIPJo8kh7IBigVXX8LgTMupQW...',
  })
  override paymentSessionId!: string;
}

export class VerifyPaymentResponseDto extends PaymentResponseDto {
  @ApiProperty({
    description: 'Whether the payment was verified as successful',
    example: true,
  })
  verified!: boolean;

  @ApiPropertyOptional({
    description: 'Whether the ERP fee was successfully settled',
    example: true,
  })
  feeSettled?: boolean;
}
