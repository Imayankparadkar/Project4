import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios, { AxiosInstance, AxiosError } from 'axios';
import {
  CashfreeCreateOrderRequest,
  CashfreeCreateOrderResponse,
  CashfreeFetchOrderResponse,
  CashfreePaymentDetail,
} from './cashfree.types';

/**
 * Cashfree Payment Gateway service.
 *
 * Handles all HTTP communication with the Cashfree API.
 * Uses documented API version headers and proper timeout handling.
 *
 * SECURITY NOTES:
 * - Never log the client secret or full response payloads
 * - Never expose gateway errors verbatim to end users
 * - Always use server-side verification, never trust client assertions
 */
@Injectable()
export class CashfreeService {
  private readonly logger = new Logger(CashfreeService.name);
  private readonly httpClient: AxiosInstance;
  private readonly apiVersion: string;
  private readonly clientSecret: string;

  constructor(private readonly configService: ConfigService) {
    const baseUrl = this.configService.get<string>('CASHFREE_BASE_URL')!;
    const clientId = this.configService.get<string>('CASHFREE_CLIENT_ID')!;
    const clientSecret = this.configService.get<string>('CASHFREE_CLIENT_SECRET')!;
    this.clientSecret = clientSecret;
    this.apiVersion = this.configService.get<string>('CASHFREE_API_VERSION', '2025-01-01');

    this.httpClient = axios.create({
      baseURL: baseUrl,
      timeout: 30000, // 30 second timeout
      headers: {
        'Content-Type': 'application/json',
        'x-api-version': this.apiVersion,
        'x-client-id': clientId,
        'x-client-secret': clientSecret,
      },
    });

    // Log requests at debug level (never log secrets)
    this.httpClient.interceptors.request.use((config) => {
      this.logger.debug(`Cashfree API: ${config.method?.toUpperCase()} ${config.url}`);
      return config;
    });
  }

  /**
   * Create a Cashfree payment order.
   *
   * @throws Error with sanitized message on failure
   */
  async createOrder(
    request: CashfreeCreateOrderRequest,
  ): Promise<CashfreeCreateOrderResponse> {
    try {
      const response = await this.httpClient.post<CashfreeCreateOrderResponse>(
        '/orders',
        request,
      );
      this.logger.log(
        `Cashfree order created: ${response.data.cf_order_id} for merchant order: ${response.data.order_id}`,
      );
      return response.data;
    } catch (error) {
      this.handleApiError(error, 'createOrder');
      throw error; // TypeScript flow - handleApiError always throws
    }
  }

  /**
   * Fetch order details from Cashfree.
   * Used for server-side payment verification.
   */
  async fetchOrder(orderId: string): Promise<CashfreeFetchOrderResponse> {
    try {
      const response = await this.httpClient.get<CashfreeFetchOrderResponse>(
        `/orders/${orderId}`,
      );
      return response.data;
    } catch (error) {
      this.handleApiError(error, 'fetchOrder');
      throw error;
    }
  }

  /**
   * Fetch payment details for an order from Cashfree.
   * Returns all payment attempts for the given order.
   */
  async fetchPaymentsForOrder(orderId: string): Promise<CashfreePaymentDetail[]> {
    try {
      const response = await this.httpClient.get<CashfreePaymentDetail[]>(
        `/orders/${orderId}/payments`,
      );
      return response.data;
    } catch (error) {
      this.handleApiError(error, 'fetchPaymentsForOrder');
      throw error;
    }
  }

  /**
   * Verify webhook signature using HMAC-SHA256.
   *
   * Per Cashfree documentation, webhook signatures are verified using
   * the Client Secret (same as CASHFREE_CLIENT_SECRET):
   * 1. Concatenate timestamp + rawBody
   * 2. Compute HMAC-SHA256 with the client secret
   * 3. Base64 encode the result
   * 4. Compare with the x-webhook-signature header
   *
   * Uses timing-safe comparison to prevent timing attacks.
   */
  verifyWebhookSignature(
    rawBody: string,
    timestamp: string,
    receivedSignature: string,
  ): boolean {
    const crypto = require('crypto');

    const signatureData = timestamp + rawBody;
    const computedSignature = crypto
      .createHmac('sha256', this.clientSecret)
      .update(signatureData)
      .digest('base64');

    // Timing-safe comparison to prevent timing attacks
    try {
      return crypto.timingSafeEqual(
        Buffer.from(computedSignature),
        Buffer.from(receivedSignature),
      );
    } catch {
      // Buffers of different lengths will throw - that means signatures don't match
      return false;
    }
  }

  /**
   * Sanitize and rethrow Cashfree API errors.
   * Never exposes full gateway error payloads to the caller.
   */
  private handleApiError(error: unknown, operation: string): never {
    if (error instanceof AxiosError) {
      const status = error.response?.status;
      const code = error.code;

      // Log enough for debugging without exposing secrets
      this.logger.error(
        `Cashfree ${operation} failed: HTTP ${status || 'N/A'}, code: ${code || 'N/A'}`,
      );

      if (code === 'ECONNABORTED' || code === 'ETIMEDOUT') {
        throw new Error(`Cashfree API timeout during ${operation}`);
      }

      if (status === 429) {
        throw new Error('Cashfree API rate limit exceeded. Please retry later.');
      }

      if (status === 409) {
        throw new Error(`Cashfree order conflict during ${operation}`);
      }

      const errorMessage =
        error.response?.data && typeof error.response.data === 'object'
          ? (error.response.data as Record<string, unknown>).message || 'Gateway error'
          : 'Gateway error';

      throw new Error(`Cashfree ${operation} failed: ${errorMessage}`);
    }

    this.logger.error(`Unexpected error in Cashfree ${operation}`, error);
    throw new Error(`Cashfree ${operation} failed unexpectedly`);
  }
}
