# ProAffluence Client Reporting Portal — Backend API

Internal staff-only authentication and reporting portal backend built with **NestJS 11**, **TypeScript**, **PostgreSQL**, **Prisma ORM 6**, and **Better Auth 1.7**.

---

## Architecture & Authentication Overview

- **Auth Framework**: [Better Auth](https://better-auth.com) integrated directly into NestJS via the official Node HTTP bridge (`toNodeHandler`).
- **Session Strategy**: Stateful HTTP-only cookie sessions stored in PostgreSQL.
- **Access Restrictions**:
  - Internal staff only; public sign-up is strictly disabled (`emailAndPassword.disableSignUp: true`).
  - Passwords require a minimum length of 12 characters.
  - Generic 401 error response on authentication failure to prevent email enumeration.
  - Strict sign-in rate limiting (default: 5 attempts/minute per IP + email bucket).
- **Session Timeout**:
  - Short idle session lifetime (`SESSION_EXPIRES_IN=1800` — 30 minutes).
  - Sliding refresh window (`SESSION_UPDATE_AGE=300` — 5 minutes).
  - Long-lived "remember me" extensions are explicitly prevented.
  - Server-side revocation on sign-out and automatic session revocation on password changes.
- **Roles**:
  - `super_admin`: Initial administrators provisioned via secure seed script.
  - `staff_entry`: Default assigned role for internal portal staff.

---

## Prerequisites

- **Node.js**: v20+ (developed & tested on Node v24)
- **pnpm**: v9+ (or v11)
- **Docker**: Docker Engine / Compose (or OrbStack / Docker Desktop)

---

## Quick Start & Setup Guide

### 1. Environment Configuration

Copy the example environment configuration into `.env`:

```bash
cp .env.example .env
```

Review and adjust variables in `.env` as needed:

| Variable | Description | Default / Example |
|---|---|---|
| `DATABASE_URL` | PostgreSQL connection string | `postgresql://proaffluence:proaffluence_secret@localhost:5433/proaffluence_dev?schema=public` |
| `PORT` | API server port | `8002` |
| `NODE_ENV` | Environment mode | `development` |
| `BETTER_AUTH_SECRET` | 32+ character high-entropy secret | `pRoAfFlUeNcE_sEcReT_kEy_32_bYtEs_mIn_12345` |
| `BETTER_AUTH_URL` | Base URL of backend | `http://localhost:8002` |
| `FRONTEND_ORIGINS` | Comma-separated trusted origins for CORS & CSRF | `http://localhost:3000` |
| `COOKIE_SAMESITE` | Cookie SameSite policy (`lax`, `strict`, `none`) | `lax` |
| `SESSION_EXPIRES_IN` | Idle session expiry in seconds (default 30m) | `1800` |
| `SESSION_UPDATE_AGE` | Sliding refresh window in seconds (default 5m) | `300` |
| `SIGNIN_RATE_LIMIT_MAX` | Max sign-in attempts within window | `5` |
| `SIGNIN_RATE_LIMIT_WINDOW`| Rate limit window in seconds | `60` |

---

### 2. Start PostgreSQL Container

Start the local PostgreSQL 16 container:

```bash
docker compose up -d
```

Check container health:
```bash
docker compose ps
```

---

### 3. Install Dependencies

```bash
pnpm install
```

---

### 4. Database Migrations

Run Prisma migrations to create the database schema:

```bash
pnpm prisma migrate dev
```

> **Note on Schema Generation**:
> The Better Auth models (`users`, `sessions`, `accounts`, `verifications`, `rate_limits`) were generated using:
> ```bash
> npx @better-auth/cli generate --adapter prisma
> ```
> and mapped with `@@map` to snake_case table names in `prisma/schema.prisma`. Production deployments run migrations exclusively via:
> ```bash
> pnpm prisma migrate deploy
> ```

---

### 5. Seed Users

User accounts and roles (`super_admin`, `staff_entry`, etc.) are configured in [`prisma/seeds/users.json`](file:///Users/adityarajaramgaikar/Documents/Metaminds/proaffluence/backend/prisma/seeds/users.json):

```json
[
  {
    "email": "admin1@proaffluence.com",
    "name": "Super Admin One",
    "password": "SuperAdmin1SecurePassword2026!",
    "role": "super_admin",
    "emailVerified": true
  },
  {
    "email": "admin2@proaffluence.com",
    "name": "Super Admin Two",
    "password": "SuperAdmin2SecurePassword2026!",
    "role": "super_admin",
    "emailVerified": true
  },
  {
    "email": "staff1@proaffluence.com",
    "name": "Staff Entry User One",
    "password": "StaffEntry1SecurePassword2026!",
    "role": "staff_entry",
    "emailVerified": true
  }
]
```

Run the seed script:

```bash
pnpm run seed:users
# or
pnpm prisma db seed
```

This provisions each user with their specified role and fields directly from the JSON file using Better Auth's internal adapter and password hasher. It is completely independent of environment variables and safe to run repeatedly (idempotent).

---

### 6. Run the Application

#### Development Mode:
```bash
pnpm run start:dev
```

#### Production Build & Run:
```bash
pnpm run build
pnpm run start:prod
```

---

## API Documentation

Both documentation interfaces are active in development (and whenever `SWAGGER_ENABLED=true`):

1. **NestJS Swagger UI**: [http://localhost:8002/docs](http://localhost:8002/docs)
   - Documents custom endpoints (`GET /me`, `GET /health`) with DTO response models and cookie security schemes (`proaffluence.session_token`).
2. **Better Auth Reference UI (Scalar)**: [http://localhost:8002/api/auth/reference](http://localhost:8002/api/auth/reference)
   - Interactive OpenAPI 3.1 reference for all Better Auth endpoints (`/api/auth/sign-in/email`, `/api/auth/sign-out`, `/api/auth/get-session`, admin plugin endpoints).

Run documentation inspection:
```bash
# Verify both documentation endpoints are reachable
curl -s http://localhost:8002/docs | grep -i "swagger"
curl -s http://localhost:8002/api/auth/reference | grep -i "scalar"
```

---

## Authentication Workflow (cURL Examples)

Here is a step-by-step example using a cookie jar file (`cookies.txt`):

### 1. Check Service Health (Public)
```bash
curl -X GET http://localhost:8002/health
```
**Response:**
```json
{"status":"ok","timestamp":"2026-10-22T08:00:00.000Z"}
```

---

### 2. Sign In (Sets HttpOnly Cookie)
```bash
curl -X POST http://localhost:8002/api/auth/sign-in/email \
  -H "Content-Type: application/json" \
  -c cookies.txt \
  -d '{
    "email": "admin1@proaffluence.com",
    "password": "SuperAdmin1SecurePassword2026!"
  }'
```
**Response:**
```json
{
  "user": {
    "id": "DJjcjoDiDmOQImrxkCAIJ66y1ftJy13q",
    "email": "admin1@proaffluence.com",
    "name": "Super Admin One",
    "role": "super_admin",
    "emailVerified": true,
    "createdAt": "2026-10-22T07:46:27.000Z",
    "updatedAt": "2026-10-22T07:46:27.000Z"
  }
}
```

The session cookie `proaffluence.session_token` is stored in `cookies.txt`.

---

### 3. Fetch Current Profile (`/me`)
```bash
curl -X GET http://localhost:8002/me \
  -b cookies.txt
```
**Response (200 OK):**
```json
{
  "id": "DJjcjoDiDmOQImrxkCAIJ66y1ftJy13q",
  "email": "admin1@proaffluence.com",
  "name": "Super Admin One",
  "role": "super_admin"
}
```

---

### 4. Attempt Access Without Cookie (Unauthorized)
```bash
curl -i -X GET http://localhost:8002/me
```
**Response (401 Unauthorized):**
```json
{"statusCode":401,"message":"Authentication required"}
```

---

### 5. Sign Out
```bash
curl -X POST http://localhost:8002/api/auth/sign-out \
  -b cookies.txt \
  -c cookies.txt
```
**Response (200 OK):**
```json
{"success":true}
```

---

### 6. Verify Session is Revoked Server-Side
```bash
curl -i -X GET http://localhost:8002/me \
  -b cookies.txt
```
**Response (401 Unauthorized):**
```json
{"statusCode":401,"message":"Authentication required"}
```

---

### 7. Public Sign-Up Attempt (Forbidden)
```bash
curl -i -X POST http://localhost:8002/api/auth/sign-up/email \
  -H "Content-Type: application/json" \
  -d '{
    "email": "intruder@domain.com",
    "name": "Intruder",
    "password": "Password123456!"
  }'
```
**Response (403 Forbidden):**
```json
{"error":"Sign up is disabled","status":false}
```

---

## Running Tests

Run the end-to-end authentication test suite:

```bash
pnpm run test:e2e
```

The test suite validates:
1. `GET /health` accessibility without cookies.
2. Sign-up endpoint rejection when public registration is disabled.
3. Generic 401 response on incorrect password or non-existent email (no user enumeration).
4. Successful credential authentication and signed HTTP-only cookie issuing.
5. `GET /me` authorization and accurate role return.
6. Server-side session invalidation on sign-out.
7. Sign-in rate limiting triggering 429 Too Many Requests after threshold.

---

## Project Structure

```
backend/
├── docker-compose.yml              # PostgreSQL 16 Alpine container
├── .env.example                    # Reference environment configuration
├── .env                            # Local environment configuration
├── package.json                    # Pinned package versions & npm scripts
├── tsconfig.json                   # TypeScript configuration
├── tsconfig.build.json             # Production build configuration
├── prisma/
│   ├── schema.prisma               # Better Auth PostgreSQL models
│   ├── migrations/                 # Versioned SQL migrations
│   ├── seed.ts                     # Idempotent super_admin provisioning script
│   └── seeds/
│       └── users.json              # Seed users & roles JSON file
├── test/
│   ├── jest-e2e.json               # E2E test configuration
│   └── auth.e2e-spec.ts            # E2E authentication & session test suite
└── src/
    ├── main.ts                     # Bootstrap: body parser handling, helmet, CORS, Swagger
    ├── app.module.ts               # Root application module
    ├── core/
    │   ├── config/
    │   │   ├── app.config.ts       # Application config loader
    │   │   ├── auth.config.ts      # Auth config loader
    │   │   └── env.validation.ts   # Class-validator startup env validation
    │   └── prisma/
    │       ├── prisma.service.ts   # Singleton Prisma client lifecycle service
    │       └── prisma.module.ts    # Global PrismaModule
    ├── auth/
    │   ├── auth.ts                 # Better Auth instance, adapter, rate limiter & plugins
    │   ├── auth.module.ts          # Auth module with global AuthGuard registration
    │   ├── guards/
    │   │   └── auth.guard.ts       # Session validation guard with Better Auth
    │   └── decorators/
    │       ├── public.decorator.ts # @Public() bypass decorator
    │       └── current-user.decorator.ts # @CurrentUser() param decorator
    ├── health/
    │   ├── health.controller.ts    # Public health probe controller
    │   ├── health.module.ts        # Health module
    │   └── dto/
    │       └── health-response.dto.ts # Health response DTO
    └── me/
        ├── me.controller.ts        # Authenticated profile controller
        ├── me.module.ts            # Me module
        └── dto/
            └── me-response.dto.ts  # Me response DTO
```
