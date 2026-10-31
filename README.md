# ProAffluence Client Reporting Portal — Backend API

## Overview
Internal staff-only authentication, financial ledger, and portfolio reporting backend built with **NestJS 11**, **TypeScript**, **PostgreSQL 16**, **Prisma ORM 6**, and **Better Auth 1.7**. It replaces legacy MS Access database workflows with a centralized system of record, strict maker-checker governance, and automated calculation pipelines matching the specifications in `docs/REQUIREMENTS.md`.

## Subdirectories & Boundaries
- `src/`: Core NestJS application services, domain controllers (`auth`, `cashflows`, `group-heads`, `health`), global filters, and pagination helpers.
- `prisma/`: PostgreSQL relational database schema slices, seed datasets (`users.json`, `group-heads.json`, `benchmarks.json`), standalone runners, and versioned DDL migrations.
- [docs](./docs/REQUIREMENTS.md): System Requirements Specification (SRS), legacy template explanations, and backend architectural planning artifacts.

## Architecture & Authentication Overview
- **Auth Framework**: [Better Auth](https://better-auth.com) integrated directly into NestJS via the official Node HTTP bridge (`toNodeHandler`).
- **Session Strategy**: Stateful HTTP-only cookie sessions (`proaffluence.session_token`) stored in PostgreSQL.
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
- **Roles (RBAC)**:
  - `super_admin`: Initial administrators provisioned via secure seed script.
  - `manager`: Operations Manager (Checker) reviewing trade entries, closing balances, and report dispatches.
  - `staff_entry`: Operations Staff (Maker) for day-to-day transaction input and preview.

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
Production deployments run migrations exclusively via:
```bash
pnpm prisma migrate deploy
```

---

### 5. Seed Users & Master Data
User accounts and roles (`super_admin`, `manager`, `staff_entry`) are configured in [`prisma/seeds/users.json`](./prisma/seeds/users.json):
```bash
pnpm run seed:users
# or
pnpm prisma db seed
```
This provisions each user directly from the JSON file using Better Auth's internal adapter and password hasher. It is completely independent of environment variables and safe to run repeatedly (idempotent).

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
   - Documents custom endpoints (`GET /me`, `GET /health`, `/api/group-heads`, `/api/cashflows`) with DTO response models and cookie security schemes (`proaffluence.session_token`).
2. **Better Auth Reference UI (Scalar)**: [http://localhost:8002/api/auth/reference](http://localhost:8002/api/auth/reference)
   - Interactive OpenAPI 3.1 reference for all Better Auth endpoints (`/api/auth/sign-in/email`, `/api/auth/sign-out`, `/api/auth/get-session`).

---

## Verification
- Run tests: `pnpm run test:e2e`
- Run build: `pnpm run build`
