# TrainX Payment Module

> **Cashfree Payment Integration for University Management System (UMS/ERP)**

A production-minded backend payment module built with NestJS, TypeScript, Prisma, and PostgreSQL (Supabase). Handles payment creation, lifecycle tracking, webhook processing, and server-side verification through the Cashfree Payments API.

---

## Table of Contents

- [Architecture](#architecture)
- [Tech Stack](#tech-stack)
- [Project Structure](#project-structure)
- [Setup & Installation](#setup--installation)
- [Database Setup](#database-setup)
- [API Reference](#api-reference)
- [Payment Flow](#payment-flow)
- [Security Measures](#security-measures)
- [Testing](#testing)
- [Docker](#docker)
- [Design Decisions](#design-decisions)
- [Test Scenario Coverage](#test-scenario-coverage)

---

## Architecture

```
┌─────────────┐     ┌──────────────────────────────────────────────────┐
│   Frontend   │     │              TrainX Payment Module               │
│   (Client)   │     │                                                  │
│              │────▶│  ┌──────────┐  ┌──────────┐  ┌───────────────┐  │
│              │     │  │ Payments │  │ Webhooks │  │    Health      │  │
│              │◀────│  │Controller│  │Controller│  │  Controller    │  │
└─────────────┘     │  └────┬─────┘  └────┬─────┘  └───────────────┘  │
                    │       │             │                             │
                    │  ┌────▼─────┐  ┌────▼─────┐                      │
                    │  │ Payments │  │ Webhooks │                      │
                    │  │ Service  │  │ Service  │                      │
                    │  └────┬─────┘  └──────────┘                      │
                    │       │                                          │
                    │  ┌────▼──────────┐  ┌───────────────┐            │
                    │  │   Payments    │  │   Cashfree    │            │
                    │  │  Repository   │  │   Service     │───▶ Cashfree API
                    │  └────┬──────────┘  └───────────────┘            │
                    │       │                                          │
                    │  ┌────▼──────────┐  ┌───────────────┐            │
                    │  │    Prisma     │  │  Mock Fee     │            │
                    │  │   Service     │  │  Repository   │            │
                    │  └────┬──────────┘  └───────────────┘            │
                    │       │                                          │
                    └───────┼──────────────────────────────────────────┘
                            │
                    ┌───────▼──────────┐
                    │   PostgreSQL     │
                    │   (Supabase)     │
                    └──────────────────┘
```

---

## Tech Stack

| Technology | Purpose |
|---|---|
| **NestJS 10.x** | Framework (modules, DI, guards, pipes) |
| **TypeScript 5.x** | Type safety |
| **Prisma 6.x** | ORM with type-safe queries and migrations |
| **PostgreSQL** | Database (via Supabase with PgBouncer pooling) |
| **Cashfree PG API** | Payment gateway (API version `2025-01-01`) |
| **class-validator** | Request DTO validation |
| **Swagger/OpenAPI** | API documentation |
| **Jest** | Testing (51 unit tests) |
| **Helmet** | Security headers |
| **@nestjs/throttler** | Rate limiting |
| **Docker** | Containerized deployment |

---

## Project Structure

```
src/
├── main.ts                          # Bootstrap with raw body, Helmet, CORS, Swagger
├── app.module.ts                    # Root module with all imports
├── config/
│   └── env.validation.ts            # Environment variable validation with class-validator
├── prisma/
│   ├── prisma.module.ts             # Global Prisma module
│   └── prisma.service.ts            # Connection lifecycle & health check
├── cashfree/
│   ├── cashfree.module.ts
│   ├── cashfree.service.ts          # Cashfree API client (orders, payments, signatures)
│   ├── cashfree.service.spec.ts     # Webhook signature verification tests
│   └── cashfree.types.ts            # Cashfree API type definitions
├── common/
│   ├── common.module.ts
│   ├── decorators/
│   │   └── current-student.decorator.ts  # Extract student ID from request
│   ├── filters/
│   │   └── http-exception.filter.ts      # Structured error responses
│   ├── guards/
│   │   └── dev-auth.guard.ts             # Development auth (Bearer <studentId>)
│   └── repositories/
│       ├── fee.repository.ts             # Abstract fee repository interface
│       └── mock-fee.repository.ts        # In-memory fee data for testing
├── payments/
│   ├── payments.module.ts
│   ├── payments.controller.ts       # POST /payments, GET /:orderId, POST /:orderId/verify
│   ├── payments.service.ts          # Core payment business logic
│   ├── payments.service.spec.ts     # 20 unit tests
│   ├── payments.repository.ts       # Data access layer with optimistic locking
│   ├── dto/
│   │   ├── create-payment.dto.ts    # Validated request DTO
│   │   └── payment-response.dto.ts  # Response DTOs with Swagger decorators
│   ├── enums/
│   │   └── payment-status.enum.ts   # Payment state machine
│   └── payment-status.spec.ts       # 19 state machine transition tests
├── webhooks/
│   ├── webhooks.module.ts
│   ├── webhooks.controller.ts       # POST /webhooks/cashfree
│   ├── webhooks.service.ts          # Signature verification, dedup, event processing
│   └── webhooks.service.spec.ts     # 8 webhook tests
├── health/
│   ├── health.module.ts
│   └── health.controller.ts         # GET /health
prisma/
│   └── schema.prisma                # Payment, PaymentAttempt, WebhookEvent models
```

---

## Setup & Installation

### Prerequisites

- **Node.js** ≥ 22.x
- **npm** ≥ 9.x
- **PostgreSQL** (via Supabase or local Docker)

### 1. Install Dependencies

```bash
npm install
```

### 2. Configure Environment

```bash
cp .env.example .env
# Edit .env with your actual values:
# - DATABASE_URL and DIRECT_URL from your Supabase project
# - Cashfree sandbox credentials
```

### 3. Generate Prisma Client

```bash
npx prisma generate
```

### 4. Run Database Migrations

```bash
npx prisma migrate dev --name init
```

### 5. Start Development Server

```bash
npm run start:dev
```

The API runs at `http://localhost:3000` with Swagger docs at `http://localhost:3000/api/docs`.

---

## Database Setup

### Using Supabase

1. Create a Supabase project at [supabase.com](https://supabase.com)
2. Go to **Connect → Session pooler** and copy the connection string
3. Set both `DATABASE_URL` and `DIRECT_URL` in `.env` to this value

### Database Models

| Model | Purpose |
|---|---|
| **Payment** | Core payment record linked to an ERP fee. Tracks lifecycle from CREATED → PAID/FAILED/EXPIRED. Uses `Decimal(12,2)` for money. |
| **PaymentAttempt** | Individual payment attempt (card, UPI, etc.). Multiple attempts per Payment. |
| **WebhookEvent** | Audit trail of every Cashfree webhook received. Unique `eventKey` prevents duplicate processing. |

---

## API Reference

### Authentication (Development)

All endpoints except `/health` and `/webhooks/cashfree` require the `Authorization` header:

```
Authorization: Bearer STU-001
```

The value after `Bearer` is used as the `studentId`. In production, replace `DevAuthGuard` with a real JWT/OAuth guard.

### Endpoints

#### `POST /payments` — Create Payment

Creates a payment for an ERP fee. The amount is resolved server-side from the trusted fee record (never from the client).

```bash
curl -X POST http://localhost:3000/payments \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer STU-001" \
  -d '{
    "feeReference": "FEE-2024-SEM1-001",
    "idempotencyKey": "550e8400-e29b-41d4-a716-446655440000"
  }'
```

**Response (201):**
```json
{
  "orderId": "TXN-a1b2c3d4e5f6",
  "feeReference": "FEE-2024-SEM1-001",
  "amount": "15000.00",
  "currency": "INR",
  "status": "PENDING",
  "paymentSessionId": "session_abc123...",
  "createdAt": "2024-01-15T10:30:00.000Z",
  "updatedAt": "2024-01-15T10:30:00.000Z"
}
```

#### `GET /payments/:orderId` — Get Payment Status

```bash
curl http://localhost:3000/payments/TXN-a1b2c3d4e5f6 \
  -H "Authorization: Bearer STU-001"
```

#### `POST /payments/:orderId/verify` — Verify Payment

Fetches authoritative payment status from Cashfree's server-side API. Validates amount, currency, and order identity. Settles the ERP fee on confirmed success.

```bash
curl -X POST http://localhost:3000/payments/TXN-a1b2c3d4e5f6/verify \
  -H "Authorization: Bearer STU-001"
```

**Response (200):**
```json
{
  "orderId": "TXN-a1b2c3d4e5f6",
  "status": "PAID",
  "verified": true,
  "feeSettled": true,
  "paidAt": "2024-01-15T10:35:00.000Z",
  "attempts": [
    {
      "cashfreePaymentId": "cf_pay_123456",
      "attemptNumber": 1,
      "status": "SUCCESS",
      "paymentMethod": "upi"
    }
  ]
}
```

#### `POST /webhooks/cashfree` — Cashfree Webhook

Receives payment status webhooks. Signature is verified before processing.

#### `GET /health` — Health Check

Returns application status and database connectivity.

### Swagger UI

Full interactive API documentation is available at:
```
http://localhost:3000/api/docs
```

---

## Payment Flow

```
┌──────────┐  1. POST /payments    ┌──────────────┐  2. Create Order  ┌──────────┐
│  Client   │─────────────────────▶│  TrainX API   │─────────────────▶│ Cashfree │
│           │◀─────────────────────│               │◀─────────────────│   API    │
│           │  paymentSessionId    │               │  cf_order_id     │          │
│           │                      │               │  session_id      │          │
│           │  3. Checkout SDK     │               │                  │          │
│           │─────────────────────────────────────────────────────────▶│          │
│           │◀────────────────────────────────────────────────────────│          │
│           │  Payment complete    │               │                  │          │
│           │                      │               │  4. Webhook       │          │
│           │                      │               │◀─────────────────│          │
│           │                      │               │  Verify sig +     │          │
│           │                      │               │  update status    │          │
│           │  5. POST /verify     │               │                  │          │
│           │─────────────────────▶│               │  6. Fetch order  │          │
│           │                      │               │─────────────────▶│          │
│           │                      │               │◀─────────────────│          │
│           │◀─────────────────────│               │  7. Settle ERP   │          │
│           │  verified: true      │               │     fee          │          │
└──────────┘                      └──────────────┘                  └──────────┘
```

### Payment State Machine

```
CREATED ──▶ PENDING ──▶ PAID ✓ (terminal)
   │           │
   │           ├──▶ FAILED ──▶ PENDING (retry)
   │           │                 │
   │           ├──▶ CANCELLED    └──▶ PAID ✓
   │           │
   │           └──▶ EXPIRED
   │
   ├──▶ FAILED
   └──▶ EXPIRED

KEY RULE: Once PAID, the status NEVER changes.
Late failure webhooks are safely ignored.
```

---

## Security Measures

| Measure | Implementation |
|---|---|
| **Server-side amount resolution** | Amount comes from trusted ERP fee record, never from the client |
| **HMAC-SHA256 webhook verification** | `timestamp + rawBody` signed with webhook secret, verified via `crypto.timingSafeEqual` |
| **Raw body preservation** | NestJS `rawBody: true` ensures exact byte-for-byte verification |
| **Helmet** | Security headers (CSP, HSTS, X-Frame-Options, etc.) |
| **CORS** | Restricted to configured `FRONTEND_ORIGIN` |
| **Rate limiting** | 60 req/min global, 10 req/min for payment creation |
| **Env validation** | All required env vars validated at startup with `class-validator` |
| **Optimistic concurrency** | Prisma `where` clause on status prevents stale/concurrent updates |
| **State machine** | `PAID` is terminal — late `FAILED` webhooks never overwrite it |
| **Idempotency** | Unique DB constraint on `idempotencyKey` prevents duplicate payments |
| **Webhook deduplication** | Unique `eventKey` constraint prevents processing the same event twice |
| **Payload sanitization** | Webhook payloads are stripped of sensitive data before storage |
| **Authorization** | Students can only view/verify their own payments |

---

## Testing

### Run All Tests

```bash
npm test
```

### Run Tests with Coverage

```bash
npm run test:cov
```

### Test Results (51 tests, 4 suites)

```
✓ Payment State Machine         — 19 tests (all transition rules)
✓ CashfreeService               —  4 tests (signature verification)
✓ PaymentsService               — 20 tests (creation, verification, webhooks)
✓ WebhooksService               —  8 tests (sig, dedup, processing, errors)
```

---

### Dockerfile

The Dockerfile uses a 3-stage build:
1. **deps** — Install production dependencies
2. **builder** — Compile TypeScript
3. **runner** — Minimal production image with non-root user

```bash
docker build -t trainx-payment-module .
docker run -p 3000:3000 --env-file .env trainx-payment-module
```

---

## Design Decisions

### 1. Why `Decimal` for Money (Not `Float`)

Floating-point arithmetic causes rounding errors (`0.1 + 0.2 = 0.30000000000000004`). Financial calculations require exact precision, so we use `Decimal(12, 2)`.

### 2. Why Server-Side Amount Resolution

The client never sends the payment amount. It only sends a `feeReference` pointing to an ERP fee record. The server resolves the amount from the trusted fee repository. This prevents price manipulation attacks.

### 3. Why Optimistic Concurrency (Not Pessimistic Locks)

Database row locks (`SELECT FOR UPDATE`) can cause deadlocks under high concurrency. Instead, we use Prisma's `where` clause to atomically check-and-update: `UPDATE ... WHERE id = ? AND status = ?`. If the status has already changed (stale update), the operation is safely rejected.

### 4. Why Composite Deduplication Keys for Webhooks

Cashfree doesn't guarantee a unique event ID in every webhook payload. We construct a composite key from `eventType + orderId + paymentId` and enforce uniqueness at the database level. This prevents duplicate processing even under retry storms.

### 5. Why Webhooks Always Return 200

If we return an error to Cashfree, it retries the webhook. If processing fails but we've recorded the event, retrying would cause duplicates or confusion. We always return 200 after accepting the event, and mark failed events for manual reconciliation.

### 6. Why an Abstract FeeRepository

The `FeeRepository` abstract class decouples payment logic from the real ERP system. The `MockFeeRepository` provides in-memory test data. In production, swap it for a real implementation that calls the ERP API.

---

## Test Scenario Coverage

| # | Scenario | Status |
|---|---|---|
| 1 | Successful payment creation | ✅ |
| 2 | Invalid fee reference | ✅ |
| 3 | Already-paid fee | ✅ |
| 4 | Cashfree order creation | ✅ |
| 5 | Idempotent duplicate request | ✅ |
| 6 | Idempotency key conflict | ✅ |
| 7 | Cashfree API failure | ✅ |
| 8 | Database race condition (P2002) | ✅ |
| 9 | Pending payment verification | ✅ |
| 10 | Successful payment verification + fee settlement | ✅ |
| 11 | Failed payment attempt (no fee settlement) | ✅ |
| 12 | Invalid webhook signature rejection | ✅ |
| 13 | Valid webhook processing | ✅ |
| 14 | Duplicate webhook delivery ignored | ✅ |
| 15 | Webhook signature tamper detection | ✅ |
| 16 | Out-of-order: FAILED after PAID blocked | ✅ |
| 17 | Amount mismatch rejection | ✅ |
| 18 | Unauthorized payment access | ✅ |
| 19 | Database failure during webhook | ✅ |
| 20 | ERP fee settlement failure (graceful) | ✅ |

---

## Available NPM Scripts

| Script | Description |
|---|---|
| `npm run start:dev` | Start dev server with hot reload |
| `npm run build` | Compile TypeScript |
| `npm start` | Run compiled production build |
| `npm test` | Run all unit tests |
| `npm run test:watch` | Run tests in watch mode |
| `npm run test:cov` | Run tests with coverage report |
| `npm run lint` | Run ESLint |
| `npm run format` | Run Prettier |

---

## License

This project was built for the TrainX Full Stack Development Intern technical assessment.
