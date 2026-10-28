/**
 * Type definitions for Cashfree PG API v2025-01-01.
 * Based on official Cashfree documentation.
 */

// ============================================================================
// Create Order Request/Response
// ============================================================================

export interface CashfreeCustomerDetails {
  customer_id: string;
  customer_phone: string;
  customer_email?: string;
  customer_name?: string;
}

export interface CashfreeOrderMeta {
  return_url?: string;
  notify_url?: string;
  payment_methods?: string;
}

export interface CashfreeCreateOrderRequest {
  order_id: string;
  order_amount: number;
  order_currency: string;
  customer_details: CashfreeCustomerDetails;
  order_meta?: CashfreeOrderMeta;
  order_note?: string;
}

export interface CashfreeCreateOrderResponse {
  cf_order_id: string;
  order_id: string;
  entity: string;
  order_currency: string;
  order_amount: number;
  order_status: CashfreeOrderStatus;
  payment_session_id: string;
  order_expiry_time: string;
  customer_details: CashfreeCustomerDetails & { customer_uid?: string };
  order_meta?: CashfreeOrderMeta;
  order_note?: string;
  created_at: string;
}

// ============================================================================
// Fetch Order Response
// ============================================================================

export interface CashfreeFetchOrderResponse {
  cf_order_id: string;
  order_id: string;
  entity: string;
  order_currency: string;
  order_amount: number;
  order_status: CashfreeOrderStatus;
  order_expiry_time: string;
  customer_details: CashfreeCustomerDetails;
  order_note?: string;
  created_at: string;
}

// ============================================================================
// Payment Details
// ============================================================================

export interface CashfreePaymentDetail {
  cf_payment_id: string;
  order_id: string;
  entity: string;
  payment_currency: string;
  payment_amount: number;
  payment_status: CashfreePaymentStatus;
  payment_method?: {
    [key: string]: unknown;
  };
  payment_time?: string;
  payment_message?: string;
  payment_group?: string;
  bank_reference?: string;
  error_details?: {
    error_code?: string;
    error_description?: string;
    error_reason?: string;
    error_source?: string;
  };
}

// ============================================================================
// Webhook Payload
// ============================================================================

export interface CashfreeWebhookPayload {
  type: string;
  data: {
    order: {
      order_id: string;
      order_amount: number;
      order_currency: string;
      order_status?: CashfreeOrderStatus;
    };
    payment: {
      cf_payment_id: string;
      payment_status: CashfreePaymentStatus;
      payment_amount: number;
      payment_currency: string;
      payment_method?: {
        [key: string]: unknown;
      };
      payment_time?: string;
      payment_message?: string;
      error_details?: {
        error_code?: string;
        error_description?: string;
        error_reason?: string;
        error_source?: string;
      };
    };
    customer_details?: {
      customer_id?: string;
      customer_phone?: string;
      customer_email?: string;
      customer_name?: string;
    };
  };
  event_time: string;
}

// ============================================================================
// Enums - Cashfree-defined statuses
// ============================================================================

export type CashfreeOrderStatus = 'ACTIVE' | 'PAID' | 'EXPIRED';

export type CashfreePaymentStatus =
  | 'SUCCESS'
  | 'PENDING'
  | 'FAILED'
  | 'USER_DROPPED'
  | 'CANCELLED'
  | 'VOID'
  | 'NOT_ATTEMPTED';

// ============================================================================
// Webhook Event Types
// ============================================================================

export enum CashfreeWebhookEventType {
  PAYMENT_SUCCESS = 'PAYMENT_SUCCESS_WEBHOOK',
  PAYMENT_FAILED = 'PAYMENT_FAILED_WEBHOOK',
  PAYMENT_USER_DROPPED = 'PAYMENT_USER_DROPPED_WEBHOOK',
}
