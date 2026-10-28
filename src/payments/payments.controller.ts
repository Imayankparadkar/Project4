import {
  Controller,
  Post,
  Get,
  Param,
  Body,
  UseGuards,
  HttpCode,
  HttpStatus,
  Headers,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
  ApiHeader,
  ApiParam,
} from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { PaymentsService } from './payments.service';
import { CreatePaymentDto } from './dto/create-payment.dto';
import {
  CreatePaymentResponseDto,
  PaymentResponseDto,
  VerifyPaymentResponseDto,
} from './dto/payment-response.dto';
import { DevAuthGuard } from '../common/guards/dev-auth.guard';
import { CurrentStudent } from '../common/decorators/current-student.decorator';

@ApiTags('Payments')
@ApiBearerAuth('bearer')
@UseGuards(DevAuthGuard)
@Controller('payments')
export class PaymentsController {
  constructor(private readonly paymentsService: PaymentsService) {}

  /**
   * Create a new payment for an ERP fee.
   *
   * The amount is resolved from the trusted ERP fee record, NOT from the client.
   * Use the idempotency key to safely retry this request.
   */
  @Post()
  @HttpCode(HttpStatus.CREATED)
  @Throttle({ default: { limit: 10, ttl: 60000 } }) // Stricter rate limit for payment creation
  @ApiOperation({
    summary: 'Create a new payment',
    description:
      'Initiates a payment for the specified ERP fee. Returns a Cashfree payment session ID ' +
      'for the frontend checkout SDK. The amount is always resolved from the trusted fee record. ' +
      'Supports idempotent requests via the idempotencyKey field.',
  })
  @ApiHeader({
    name: 'Authorization',
    description: 'Bearer <studentId> (development auth)',
    required: true,
  })
  @ApiResponse({
    status: 201,
    description: 'Payment created successfully',
    type: CreatePaymentResponseDto,
  })
  @ApiResponse({ status: 400, description: 'Invalid request body' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 404, description: 'Fee reference not found' })
  @ApiResponse({
    status: 409,
    description: 'Fee already paid or idempotency key conflict',
  })
  @ApiResponse({ status: 429, description: 'Rate limit exceeded' })
  @ApiResponse({
    status: 500,
    description: 'Payment gateway error',
  })
  async createPayment(
    @Body() dto: CreatePaymentDto,
    @CurrentStudent() studentId: string,
  ): Promise<CreatePaymentResponseDto> {
    return this.paymentsService.createPayment(dto, studentId);
  }

  /**
   * Get the current status of a payment.
   */
  @Get(':orderId')
  @ApiOperation({
    summary: 'Get payment status',
    description:
      'Returns the current status and details of a payment. ' +
      'Only the student who created the payment can view it.',
  })
  @ApiParam({
    name: 'orderId',
    description: 'Internal order ID (e.g., TXN-a1b2c3d4)',
    example: 'TXN-a1b2c3d4e5f6',
  })
  @ApiResponse({
    status: 200,
    description: 'Payment details',
    type: PaymentResponseDto,
  })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden - not your payment' })
  @ApiResponse({ status: 404, description: 'Payment not found' })
  async getPaymentStatus(
    @Param('orderId') orderId: string,
    @CurrentStudent() studentId: string,
  ): Promise<PaymentResponseDto> {
    return this.paymentsService.getPaymentStatus(orderId, studentId);
  }

  /**
   * Verify payment status from Cashfree's server-side API.
   *
   * This endpoint fetches authoritative payment information from Cashfree
   * and updates the local database. Use this after the customer completes
   * checkout to confirm the payment was actually successful.
   *
   * NEVER trust a client-submitted {"status":"PAID"} assertion.
   */
  @Post(':orderId/verify')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Verify payment status',
    description:
      'Fetches authoritative payment status from Cashfree and updates the local database. ' +
      'Validates amount, currency, and order identity. ' +
      'Settles the ERP fee if payment is confirmed successful. ' +
      'Safe to call multiple times (idempotent).',
  })
  @ApiParam({
    name: 'orderId',
    description: 'Internal order ID to verify',
    example: 'TXN-a1b2c3d4e5f6',
  })
  @ApiResponse({
    status: 200,
    description: 'Verification result',
    type: VerifyPaymentResponseDto,
  })
  @ApiResponse({ status: 400, description: 'Payment has no Cashfree order' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden - not your payment' })
  @ApiResponse({ status: 404, description: 'Payment not found' })
  @ApiResponse({
    status: 500,
    description: 'Verification failed (gateway error or data mismatch)',
  })
  async verifyPayment(
    @Param('orderId') orderId: string,
    @CurrentStudent() studentId: string,
  ): Promise<VerifyPaymentResponseDto> {
    return this.paymentsService.verifyPayment(orderId, studentId);
  }
}
