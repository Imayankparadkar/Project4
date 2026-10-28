import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsNotEmpty, IsString, MaxLength, MinLength, IsOptional } from 'class-validator';

/**
 * DTO for creating a new payment.
 *
 * The client provides:
 * - feeReference: which ERP fee to pay
 * - idempotencyKey: prevents duplicate payment creation
 * - description: optional human-readable note
 *
 * The amount, currency, and student identity are resolved server-side.
 * The client NEVER submits an amount - this prevents price manipulation attacks.
 */
export class CreatePaymentDto {
  @ApiProperty({
    description: 'ERP fee reference identifier',
    example: 'FEE-2024-SEM1-001',
    minLength: 1,
    maxLength: 100,
  })
  @IsString()
  @IsNotEmpty()
  @MinLength(1)
  @MaxLength(100)
  feeReference!: string;

  @ApiProperty({
    description:
      'Client-generated idempotency key (UUID recommended). ' +
      'Reusing the same key with the same payload returns the existing payment. ' +
      'Reusing with a different payload returns 409 Conflict.',
    example: '550e8400-e29b-41d4-a716-446655440000',
    minLength: 1,
    maxLength: 255,
  })
  @IsString()
  @IsNotEmpty()
  @MinLength(1)
  @MaxLength(255)
  idempotencyKey!: string;

  @ApiPropertyOptional({
    description: 'Optional payment description or note',
    example: 'Semester 1 tuition payment',
    maxLength: 500,
  })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  description?: string;
}
