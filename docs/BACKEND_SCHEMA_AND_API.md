# ProAffluence Backend Architecture, Prisma Database Schema & API Specification

> **Target Systems**: `proaffluence-backend` (NestJS 11 + Prisma ORM + PostgreSQL + BetterAuth)  
> **Frontend Integration**: `proaffluence-frontend` (React 19, TanStack Table, Zustand)  
> **Scope**: Master Cashflows, Closing Balances, Group Head Registry, Market Benchmarks, Hybrid Allocation Rules, Reporting Freeze Gates, and Email Dispatch Hub  
> **Status**: Production Architecture Blueprint & Schema Specification

---

## 1. System Overview & Hybrid Architecture

In the ProAffluence platform, portfolio intelligence and investor reporting operate on a **hybrid architectural model**:

```
 ┌────────────────────────────────────────────────────────────────────────┐
 │                     ProAffluence React Frontend                        │
 │  • Master Cashflows Ledger (Single Entry & Broker Upload)             │
 │  • Closing Balances Spreadsheet Matrix (Inline Editing & Verification) │
 │  • Executive Dashboard (KPIs, Charts, Group Head Directory)            │
 │  • Pre-Flight Audit Gate & Month-End Reporting Freeze                  │
 │  • Email Design, Approval & SMTP Sending Hub                           │
 └───────────────────────────────────┬────────────────────────────────────┘
                                     │
                     HTTPS / JSON REST API (Port 8002)
                     Cookie-Based Session (BetterAuth)
                                     │
                                     ▼
 ┌────────────────────────────────────────────────────────────────────────┐
 │                      NestJS Modular Backend API                        │
 │  • Modules: Cashflows, ClosingBalances, GroupHeads, Benchmarks,        │
 │             HybridAllocations, ReportingRuns, Communications, Audit    │
 │  • Guards: AuthGuard, RolesGuard (Staff Entry / Manager / Super Admin) │
 │  • Business Rules: Maker-Checker Approvals, Pre-Flight Gating          │
 └──────────────────┬─────────────────────────────────┬───────────────────┘
                    │                                 │
     Prisma ORM     ▼                                 ▼  Headless Excel Worker
 ┌──────────────────────┐                    ┌────────────────────────────┐
 │  PostgreSQL Database │                    │     O_Template.xlsx        │
 │  • System of Record  │                    │  • XIRR vs P2P Formulas    │
 │  • ACID Transactions │                    │  • Asset Allocation Splits │
 │  • Audit Ledgers     │                    │  • Password Encrypted PDF  │
 └──────────────────────┘                    └────────────────────────────┘
```

1. **PostgreSQL (via Prisma ORM)** is the **System of Record**:
   - Stores authenticated staff credentials, roles, and sessions.
   - Stores client entity hierarchies (Group Heads, Family Members, Mandates, PANs).
   - Stores raw cashflow ledger entries and monthly NAV valuations.
   - Stores immutable audit logs (who created, corrected, approved, voided, or returned any record).
2. **`O_Template.xlsx` / `.xlsb`** is the **Master Calculation & Formatting Engine**:
   - Ingests verified and approved records from PostgreSQL.
   - Evaluates portfolio return formulas: **XIRR** for periods $\ge$ 12 months and **Point-to-Point (Absolute Return)** for periods $<$ 12 months.
   - Splits hybrid instruments according to default 50/50 or custom override rules.
   - Generates the client-facing **A4 FY Annual Dashboard Statement** encrypted with the client's PAN.

---

## 2. Recommended NestJS Backend Folder Structure

Aligning with the existing `proaffluence-backend` codebase (`src/core/`, `src/auth/`, `src/health/`, `src/me/`), the recommended modular structure is:

```
proaffluence-backend/
├── prisma/
│   ├── schema.prisma                  # Master database schema (Auth + Business Models)
│   ├── seed.ts                        # Seed execution runner
│   ├── seeds/
│   │   ├── users.json                 # Seed staff & manager accounts
│   │   ├── group-heads.json           # Seed client entities & family members
│   │   ├── benchmarks.json            # Seed benchmark metadata & historical quotes
│   │   └── hybrid-rules.json          # Seed hybrid allocation default rules
│   └── migrations/                    # Prisma migration SQL files
│
└── src/
    ├── app.module.ts                  # Root NestJS module importing domain modules
    ├── main.ts                        # Bootstrap, Swagger, Helmet, CookieParser, ValidationPipe
    │
    ├── core/                          # Cross-cutting foundational infrastructure
    │   ├── config/                    # App, Auth, Database environment configurations
    │   ├── database/                  # Prisma service & client lifecycle
    │   ├── filters/                   # AllExceptionsFilter (sanitized error output)
    │   ├── mail/                      # Nodemailer SMTP gateway service
    │   └── common/                    # Common pagination DTOs, interceptors, decorators
    │
    ├── auth/                          # BetterAuth authentication & session management
    │   ├── guards/                    # AuthGuard, RolesGuard (Staff / Manager / Admin)
    │   ├── decorators/                # @CurrentUser(), @Roles(), @Public()
    │   └── auth.ts                    # BetterAuth engine configuration
    │
    ├── cashflows/                     # Master Cashflows Domain
    │   ├── cashflows.module.ts
    │   ├── cashflows.controller.ts    # REST endpoints for single entry, lists, void, approve
    │   ├── cashflows.service.ts       # Business rules, sequence calculation, maker-checker
    │   ├── dto/
    │   │   ├── create-cashflow.dto.ts # Single trade entry payload ("Add trade entry" modal)
    │   │   ├── update-cashflow.dto.ts # Correction payload with mandatory reason
    │   │   ├── query-cashflow.dto.ts  # Filtering, pagination, status tabs
    │   │   ├── void-cashflow.dto.ts   # Void payload with mandatory reason
    │   │   ├── return-cashflow.dto.ts # Manager return payload with reason
    │   │   └── bulk-import.dto.ts     # Broker Excel mapped rows validation DTO
    │   └── entities/
    │       └── cashflow.entity.ts
    │
    ├── closing-balances/              # Month-End Valuation Matrix Domain
    │   ├── closing-balances.module.ts
    │   ├── closing-balances.controller.ts
    │   ├── closing-balances.service.ts # Grid state, missing NAV alerts, cell updates
    │   └── dto/
    │       ├── create-closing-balance.dto.ts
    │       ├── update-amounts.dto.ts  # Batch inline updates from spreadsheet grid
    │       ├── query-closing-balance.dto.ts
    │       └── return-balance.dto.ts
    │
    ├── group-heads/                   # Client Master Registry Domain
    │   ├── group-heads.module.ts
    │   ├── group-heads.controller.ts  # Entities, family members, PAN management
    │   ├── group-heads.service.ts
    │   └── dto/
    │       ├── create-group-head.dto.ts
    │       ├── update-group-head.dto.ts
    │       └── create-family-member.dto.ts
    │
    ├── benchmarks/                    # Market Indices & Price Feeds Domain
    │   ├── benchmarks.module.ts
    │   ├── benchmarks.controller.ts   # Quotes ledger, manual fallback, feed sync
    │   ├── benchmarks.service.ts      # Quote ingestion & historical lookup
    │   └── dto/
    │       ├── create-quote.dto.ts    # Manual fallback quote payload
    │       └── bulk-quotes.dto.ts     # Tab/CSV bulk paste payload
    │
    ├── hybrid-allocations/            # Asset Allocation Overrides Domain
    │   ├── hybrid-allocations.module.ts
    │   ├── hybrid-allocations.controller.ts
    │   ├── hybrid-allocations.service.ts
    │   └── dto/
    │       ├── create-hybrid-rule.dto.ts
    │       └── update-hybrid-rule.dto.ts
    │
    ├── reporting/                     # Pipeline Runs & Freeze Gate Domain
    │   ├── reporting.module.ts
    │   ├── reporting.controller.ts    # Pre-flight audit, freeze/unfreeze, calculate
    │   ├── reporting.service.ts       # Audit gate checks, O_Template runner
    │   └── dto/
    │       ├── freeze-period.dto.ts
    │       ├── unfreeze-period.dto.ts # Mandatory manager justification
    │       └── run-pipeline.dto.ts
    │
    ├── communications/                # Email Hub Domain
    │   ├── communications.module.ts
    │   ├── communications.controller.ts # Campaigns, batch dispatch, delivery logs
    │   ├── communications.service.ts  # Nodemailer worker, PDF encryption, warmup pace
    │   └── dto/
    │       ├── batch-action.dto.ts    # Batch mark ready / approve / send
    │       ├── retry-log.dto.ts
    │       └── reroute-log.dto.ts
    │
    └── audit-trail/                   # Cross-Cutting Audit Log Ledger
        ├── audit-trail.module.ts
        ├── audit-trail.service.ts     # Generic entity diff recorder
        └── audit-trail.controller.ts  # Audit query endpoint for drawers
```

---

## 3. Production Prisma Database Schema (`schema.prisma`)

Below is the complete database schema extending the existing `BetterAuth` models with the business domain models:

```prisma
// =============================================================================
// PRISMA CONFIGURATION & DATASOURCE
// =============================================================================

generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

// =============================================================================
// ENUMS
// =============================================================================

enum UserRole {
  SUPER_ADMIN @map("super_admin")
  MANAGER     @map("manager")
  STAFF_ENTRY @map("staff_entry")
}

enum ApprovalStatus {
  PENDING  @map("Pending")
  APPROVED @map("Approved")
  RETURNED @map("Rejected/Returned")
}

enum TransactionType {
  PURCHASE   @map("Purchase")
  REDEMPTION @map("Redemption")
}

enum AssetCategory {
  MF     @map("MF")
  PMS    @map("PMS")
  STOCKS @map("Stocks")
  EQUITY @map("Equity")
  DEBT   @map("Debt")
  OTHER  @map("Other")
}

enum BenchmarkCode {
  NIFTY_50_TRI @map("NIFTY_50_TRI")
  NIFTY_50_PR  @map("NIFTY_50_PR")
  BSE_500      @map("BSE_500")
  SENSEX       @map("SENSEX")
}

enum BenchmarkReturnType {
  TRI
  PR
}

enum QuoteSource {
  FEED        @map("feed")
  MANUAL      @map("manual")
  BULK_UPLOAD @map("bulk_upload")
}

enum EmailCampaignStatus {
  DRAFT     @map("Draft")
  READY     @map("Ready")
  APPROVED  @map("Approved")
  QUEUED    @map("Queued")
  SENT      @map("Sent")
  DELIVERED @map("Delivered")
  FAILED    @map("Failed")
  BOUNCED   @map("Bounced")
}

enum AuditAction {
  CREATED   @map("Created")
  CORRECTED @map("Corrected")
  VOIDED    @map("Voided")
  APPROVED  @map("Approved")
  RETURNED  @map("Returned")
  IMPORTED  @map("Imported")
  FROZEN    @map("Frozen")
  UNFROZEN  @map("Unfrozen")
}

// =============================================================================
// BETTER-AUTH AUTHENTICATION MODELS
// =============================================================================

model User {
  id            String    @id @default(uuid())
  name          String
  email         String    @unique
  emailVerified Boolean   @default(false)
  image         String?
  createdAt     DateTime  @default(now())
  updatedAt     DateTime  @updatedAt

  role          String?   @default("staff_entry")
  banned        Boolean?  @default(false)
  banReason     String?
  banExpires    DateTime?

  sessions      Session[]
  accounts      Account[]

  // Domain Relations
  submittedCashflows MasterCashflow[] @relation("CashflowSubmitter")
  approvedCashflows  MasterCashflow[] @relation("CashflowApprover")
  submittedBalances  ClosingBalance[] @relation("BalanceSubmitter")
  approvedBalances   ClosingBalance[] @relation("BalanceApprover")
  auditEntries       AuditTrail[]     @relation("AuditUser")
  frozenRuns         ReportingRun[]   @relation("RunFreezer")
  unfrozenRuns       ReportingRun[]   @relation("RunUnfreezer")

  @@map("users")
}

model Session {
  id             String   @id @default(uuid())
  expiresAt      DateTime
  token          String   @unique
  createdAt      DateTime @default(now())
  updatedAt      DateTime @updatedAt
  ipAddress      String?
  userAgent      String?
  userId         String
  user           User     @relation(fields: [userId], references: [id], onDelete: Cascade)
  impersonatedBy String?

  @@index([userId])
  @@map("sessions")
}

model Account {
  id                    String    @id @default(uuid())
  accountId             String
  providerId            String
  userId                String
  user                  User      @relation(fields: [userId], references: [id], onDelete: Cascade)
  accessToken           String?
  refreshToken          String?
  idToken               String?
  accessTokenExpiresAt  DateTime?
  refreshTokenExpiresAt DateTime?
  scope                 String?
  password              String?
  createdAt             DateTime  @default(now())
  updatedAt             DateTime  @updatedAt

  @@unique([providerId, accountId])
  @@index([userId])
  @@map("accounts")
}

model Verification {
  id         String    @id @default(uuid())
  identifier String
  value      String
  expiresAt  DateTime
  createdAt  DateTime? @default(now())
  updatedAt  DateTime? @updatedAt

  @@index([identifier])
  @@map("verifications")
}

model RateLimit {
  id          String   @id @default(uuid())
  key         String
  count       Int
  lastRequest BigInt

  @@index([key])
  @@map("rate_limits")
}

// =============================================================================
// DOMAIN: GROUP HEADS & FAMILY REGISTRY
// =============================================================================

model GroupHead {
  id              String        @id @default(uuid())
  customId        String        @unique @map("custom_id") // e.g. "GH-0101"
  name            String                                  // e.g. "ABC Family Office"
  contactPerson   String?       @map("contact_person")
  email           String                                  // Primary dispatch email
  secondaryEmail  String?       @map("secondary_email")
  inceptionDate   String        @map("inception_date")   // "dd-MM-yyyy"
  pan             String                                  // Encrypted or uppercase PAN
  status          String        @default("Active")        // "Active" | "Inactive"
  notes           String?       @db.Text
  categories      AssetCategory[]
  totalAum        Decimal       @default(0) @db.Decimal(18, 2)
  netInvestment   Decimal       @default(0) @db.Decimal(18, 2)

  createdAt       DateTime      @default(now()) @map("created_at")
  updatedAt       DateTime      @updatedAt @map("updated_at")

  familyMembers   FamilyMember[]
  cashflows       MasterCashflow[]
  closingBalances ClosingBalance[]
  emailCampaigns  EmailCampaign[]

  @@map("group_heads")
}

model FamilyMember {
  id              String        @id @default(uuid())
  groupHeadId     String        @map("group_head_id")
  groupHead       GroupHead     @relation(fields: [groupHeadId], references: [id], onDelete: Cascade)
  name            String                                  // e.g. "Rajesh ABC"
  relationship    String?                                 // e.g. "Karta", "Self", "Spouse", "Trust"
  pan             String?
  createdAt       DateTime      @default(now()) @map("created_at")
  updatedAt       DateTime      @updatedAt @map("updated_at")

  cashflows       MasterCashflow[]
  closingBalances ClosingBalance[]

  @@unique([groupHeadId, name])
  @@map("family_members")
}

// =============================================================================
// DOMAIN: MASTER CASHFLOWS LEDGER
// =============================================================================

model MasterCashflow {
  id                 String          @id @default(uuid())
  srNo               Int             @unique @map("sr_no") // Auto-sequenced positive integer
  dateOfEntry        String          @map("date_of_entry") // "dd-MM-yyyy"
  userId             String          @map("user_id")       // "USR-001"
  month              String                                // "October 2026"
  clientOwner        String          @map("client_owner")  // RM Name

  groupHeadId        String          @map("group_head_id")
  groupHead          GroupHead       @relation(fields: [groupHeadId], references: [id], onDelete: Restrict)
  groupHeadName      String          @map("group_head_name") // Denormalized for template sync

  familyMemberId     String?         @map("family_member_id")
  familyMember       FamilyMember?   @relation(fields: [familyMemberId], references: [id], onDelete: SetNull)
  familyMemberName   String          @map("family_member_name")

  transactionDate    String          @map("transaction_date") // "dd-MM-yyyy"
  transactionType    TransactionType @map("transaction_type") // Purchase | Redemption
  category           AssetCategory
  subCategory        String          @map("sub_category")

  amounts            Decimal         @db.Decimal(18, 2)
  newInvestments     Decimal         @default(0) @db.Decimal(18, 2)
  profitLoss         Decimal         @default(0) @db.Decimal(18, 2)
  xirr               Decimal         @default(0) @db.Decimal(8, 4)

  // Maker-Checker & State Management
  voided             Boolean         @default(false)
  voidReason         String?         @map("void_reason")
  approvalStatus     ApprovalStatus  @default(PENDING) @map("approval_status")
  returnReason       String?         @map("return_reason")

  submittedById      String          @map("submitted_by_id")
  submittedBy        User            @relation("CashflowSubmitter", fields: [submittedById], references: [id])
  submittedByName    String          @map("submitted_by_name")
  submittedAt        DateTime        @default(now()) @map("submitted_at")

  approvedById       String?         @map("approved_by_id")
  approvedBy         User?           @relation("CashflowApprover", fields: [approvedById], references: [id])
  approvedByName     String?         @map("approved_by_name")
  approvedAt         DateTime?       @map("approved_at")

  createdAt          DateTime        @default(now()) @map("created_at")
  updatedAt          DateTime        @updatedAt @map("updated_at")

  auditEntries       AuditTrail[]    @relation("CashflowAudits")

  @@index([month])
  @@index([groupHeadId])
  @@index([approvalStatus])
  @@index([transactionDate])
  @@map("master_cashflows")
}

// =============================================================================
// DOMAIN: CLOSING BALANCES SPREADSHEET MATRIX
// =============================================================================

model ClosingBalance {
  id                 String          @id @default(uuid())
  srNo               Int             @map("sr_no")
  dateOfEntry        String          @map("date_of_entry") // "dd-MM-yyyy"
  userId             String          @map("user_id")
  monthKey           String          @map("month_key")     // "YYYY-MM" (e.g. "2026-09")
  month              String                                // "September 2026"

  groupHeadId        String          @map("group_head_id")
  groupHead          GroupHead       @relation(fields: [groupHeadId], references: [id], onDelete: Restrict)
  groupHeadName      String          @map("group_head_name")

  familyMemberId     String?         @map("family_member_id")
  familyMember       FamilyMember?   @relation(fields: [familyMemberId], references: [id], onDelete: SetNull)
  familyMemberName   String          @map("family_member_name")

  category           AssetCategory
  subCategory        String          @map("sub_category")
  closingAmount      Decimal?        @map("closing_amount") @db.Decimal(18, 2) // Nullable if missing

  voided             Boolean         @default(false)
  approvalStatus     ApprovalStatus  @default(PENDING) @map("approval_status")
  returnReason       String?         @map("return_reason")

  submittedById      String          @map("submitted_by_id")
  submittedBy        User            @relation("BalanceSubmitter", fields: [submittedById], references: [id])
  submittedByName    String          @map("submitted_by_name")
  submittedAt        DateTime        @default(now()) @map("submitted_at")

  approvedById       String?         @map("approved_by_id")
  approvedBy         User?           @relation("BalanceApprover", fields: [approvedById], references: [id])
  approvedByName     String?         @map("approved_by_name")
  approvedAt         DateTime?       @map("approved_at")

  createdAt          DateTime        @default(now()) @map("created_at")
  updatedAt          DateTime        @updatedAt @map("updated_at")

  auditEntries       AuditTrail[]    @relation("BalanceAudits")

  @@unique([monthKey, groupHeadId, familyMemberName, category, subCategory])
  @@index([monthKey])
  @@index([approvalStatus])
  @@map("closing_balances")
}

// =============================================================================
// DOMAIN: MARKET BENCHMARKS & INDICES DATA RECORDS
// =============================================================================

model Benchmark {
  code              BenchmarkCode       @id
  name              String
  shortName         String              @map("short_name")
  returnType        BenchmarkReturnType @map("return_type")
  exchange          String              // "NSE" | "BSE"
  provider          String
  description       String
  isDefault         Boolean             @default(false) @map("is_default")
  methodologyLabel  String              @map("methodology_label")

  records           IndicesDataRecord[]

  @@map("benchmarks")
}

model IndicesDataRecord {
  id           String        @id @default(uuid())
  date         String                             // "dd-MM-yyyy" or "YYYY-MM-DD"
  indexCode    BenchmarkCode @map("index_code")
  benchmark    Benchmark     @relation(fields: [indexCode], references: [code], onDelete: Restrict)
  closingValue Decimal       @map("closing_value") @db.Decimal(14, 4)
  source       QuoteSource   @default(FEED)
  updatedBy    String        @map("updated_by")
  notes        String?       @db.Text
  createdAt    DateTime      @default(now()) @map("created_at")

  @@unique([date, indexCode])
  @@index([date])
  @@map("indices_data_records")
}

// =============================================================================
// DOMAIN: HYBRID ASSET ALLOCATION OVERRIDES
// =============================================================================

model HybridAllocationRule {
  id          String        @id @default(uuid())
  schemeName  String        @unique @map("scheme_name")
  category    AssetCategory @default(MF)
  equityRatio Int           @default(50) @map("equity_ratio") // 0 to 100
  debtRatio   Int           @default(50) @map("debt_ratio")   // 100 - equityRatio
  isCustom    Boolean       @default(false) @map("is_custom")
  notes       String?       @db.Text
  updatedBy   String        @map("updated_by")
  updatedAt   DateTime      @updatedAt @map("updated_at")

  @@map("hybrid_allocation_rules")
}

// =============================================================================
// DOMAIN: REPORTING RUNS & PRE-FLIGHT AUDIT SEALS
// =============================================================================

model ReportingRun {
  id                   String       @id @default(uuid())
  period               String       @unique // e.g. "30-09-2026"
  monthKey             String       @map("month_key") // "2026-09"
  isFrozen             Boolean      @default(false) @map("is_frozen")
  frozenAt             DateTime?    @map("frozen_at")
  frozenById           String?      @map("frozen_by_id")
  frozenBy             User?        @relation("RunFreezer", fields: [frozenById], references: [id])
  frozenByName         String?      @map("frozen_by_name")

  unfrozenAt           DateTime?    @map("unfrozen_at")
  unfrozenById         String?      @map("unfrozen_by_id")
  unfrozenBy           User?        @relation("RunUnfreezer", fields: [unfrozenById], references: [id])
  unfreezeReason       String?      @map("unfreeze_reason")

  calculationStatus    String       @default("idle") @map("calculation_status") // idle | running | completed | failed
  lastCalculatedAt     DateTime?    @map("last_calculated_at")
  calculationSummary   Json?        @map("calculation_summary") // Detailed metrics snapshot

  createdAt            DateTime     @default(now()) @map("created_at")
  updatedAt            DateTime     @updatedAt @map("updated_at")

  auditEntries         AuditTrail[] @relation("RunAudits")

  @@map("reporting_runs")
}

// =============================================================================
// DOMAIN: EMAIL DISPATCH & DELIVERY AUDIT HUB
// =============================================================================

model EmailCampaign {
  id                 String              @id @default(uuid())
  groupHeadId        String              @map("group_head_id")
  groupHead          GroupHead           @relation(fields: [groupHeadId], references: [id], onDelete: Cascade)
  reportDate         String              @map("report_date") // "30-09-2026"
  status             EmailCampaignStatus @default(DRAFT)

  approvedById       String?             @map("approved_by_id")
  approvedByName     String?             @map("approved_by_name")
  approvedAt         DateTime?           @map("approved_at")
  queuedAt           DateTime?           @map("queued_at")
  sentAt             DateTime?           @map("sent_at")
  deliveredAt        DateTime?           @map("delivered_at")
  failedAt           DateTime?           @map("failed_at")
  failureReason      String?             @map("failure_reason")
  bounceCode         String?             @map("bounce_code")
  providerMessageId  String?             @map("provider_message_id")
  retryCount         Int                 @default(0) @map("retry_count")

  createdAt          DateTime            @default(now()) @map("created_at")
  updatedAt          DateTime            @updatedAt @map("updated_at")

  deliveryLogs       DeliveryLog[]

  @@unique([groupHeadId, reportDate])
  @@index([status])
  @@map("email_campaigns")
}

model DeliveryLog {
  id                 String              @id @default(uuid())
  campaignId         String              @map("campaign_id")
  campaign           EmailCampaign       @relation(fields: [campaignId], references: [id], onDelete: Cascade)
  groupHeadId        String              @map("group_head_id")
  clientName         String              @map("client_name")
  recipientEmail     String              @map("recipient_email")
  attachmentFilename String              @map("attachment_filename")
  status             EmailCampaignStatus
  timestamp          DateTime            @default(now())
  provider           String              // "AWS SES Relay"
  providerMessageId  String?             @map("provider_message_id")
  failureReason      String?             @map("failure_reason")
  bounceCode         String?             @map("bounce_code")
  retryCount         Int                 @default(0) @map("retry_count")

  @@index([campaignId])
  @@index([recipientEmail])
  @@map("delivery_logs")
}

// =============================================================================
// DOMAIN: CROSS-CUTTING ENTITY AUDIT TRAIL
// =============================================================================

model AuditTrail {
  id             String          @id @default(uuid())
  action         AuditAction
  timestamp      DateTime        @default(now())
  userId         String          @map("user_id")
  user           User            @relation("AuditUser", fields: [userId], references: [id])
  userName       String          @map("user_name")
  reason         String?         @db.Text
  changes        Json?           // Array of { field, from, to }

  cashflowId     String?         @map("cashflow_id")
  cashflow       MasterCashflow? @relation("CashflowAudits", fields: [cashflowId], references: [id], onDelete: Cascade)

  balanceId      String?         @map("balance_id")
  balance        ClosingBalance? @relation("BalanceAudits", fields: [balanceId], references: [id], onDelete: Cascade)

  reportingRunId String?         @map("reporting_run_id")
  reportingRun   ReportingRun?   @relation("RunAudits", fields: [reportingRunId], references: [id], onDelete: Cascade)

  @@index([cashflowId])
  @@index([balanceId])
  @@index([reportingRunId])
  @@map("audit_trails")
}
```

---

## 4. API Endpoints Specification

All endpoints are prefixed with `/api/v1/` and protected by cookie-based BetterAuth sessions.

### 4.1 Master Cashflows (`/api/v1/cashflows`)

| Method | Endpoint | Allowed Roles | Description |
| :--- | :--- | :--- | :--- |
| `POST` | `/api/v1/cashflows` | Staff Entry, Manager, Super Admin | **Adds a single trade entry** (called by frontend "Save entry" modal). |
| `GET` | `/api/v1/cashflows` | All Authenticated | Paginated query: filters by `status` (ALL/PENDING/APPROVED/RETURNED), `search`, `groupHeadId`, `category`, and `month`. |
| `GET` | `/api/v1/cashflows/:id` | All Authenticated | Fetch single cashflow record with full audit trail history. |
| `PATCH` | `/api/v1/cashflows/:id/correct` | Staff Entry, Manager, Super Admin | Correct trade entry fields with mandatory `correctionReason`. |
| `POST` | `/api/v1/cashflows/:id/void` | Manager, Super Admin | Void entry (marks `voided: true` with mandatory `voidReason`). |
| `POST` | `/api/v1/cashflows/:id/approve` | Manager, Super Admin | Approve single pending trade entry. |
| `POST` | `/api/v1/cashflows/:id/return` | Manager, Super Admin | Return entry for correction with mandatory `returnReason`. |
| `POST` | `/api/v1/cashflows/bulk-approve` | Manager, Super Admin | Batch approve multiple trade IDs `{"ids": ["id1", "id2"]}`. |
| `POST` | `/api/v1/cashflows/bulk-return` | Manager, Super Admin | Batch return multiple trade IDs with `{"ids": [...], "reason": "..."}`. |
| `POST` | `/api/v1/cashflows/bulk-import` | Staff Entry, Manager, Super Admin | Ingest validated rows from Broker Excel Upload modal. |

---

### 4.2 Closing Balances (`/api/v1/closing-balances`)

| Method | Endpoint | Allowed Roles | Description |
| :--- | :--- | :--- | :--- |
| `GET` | `/api/v1/closing-balances` | All Authenticated | Query month-end valuation matrix by `monthKey` (e.g. `2026-09`). |
| `POST` | `/api/v1/closing-balances` | Staff Entry, Manager, Super Admin | Add single closing balance row. |
| `PATCH` | `/api/v1/closing-balances/amounts` | Staff Entry, Manager, Super Admin | **Batch update NAV amounts** directly from frontend spreadsheet grid. |
| `POST` | `/api/v1/closing-balances/:id/approve` | Manager, Super Admin | Approve single closing balance row. |
| `POST` | `/api/v1/closing-balances/:id/return` | Manager, Super Admin | Return closing balance row with reason. |
| `POST` | `/api/v1/closing-balances/bulk-approve` | Manager, Super Admin | Batch approve closing balance IDs. |
| `POST` | `/api/v1/closing-balances/bulk-return` | Manager, Super Admin | Batch return closing balance IDs. |

---

### 4.3 Group Head Client Registry (`/api/v1/group-heads`)

| Method | Endpoint | Allowed Roles | Description |
| :--- | :--- | :--- | :--- |
| `GET` | `/api/v1/group-heads` | All Authenticated | List all client group heads, family members, PANs, and AUM totals. |
| `POST` | `/api/v1/group-heads` | Manager, Super Admin | Register new Group Head mandate. |
| `GET` | `/api/v1/group-heads/:id` | All Authenticated | Fetch mandate details, review notes, and family list. |
| `PATCH` | `/api/v1/group-heads/:id` | Manager, Super Admin | Update contact, emails, PAN, notes, or active status. |
| `POST` | `/api/v1/group-heads/:id/family-members` | Manager, Super Admin | Add family member / HUF beneficiary to mandate. |
| `DELETE` | `/api/v1/group-heads/:id/family-members/:memberId` | Manager, Super Admin | Remove family member from mandate. |

---

### 4.4 Market Benchmarks & Price Feeds (`/api/v1/benchmarks`)

| Method | Endpoint | Allowed Roles | Description |
| :--- | :--- | :--- | :--- |
| `GET` | `/api/v1/benchmarks` | All Authenticated | Get all index metadata and feed sync health (`synced`/`stale`/`gap`). |
| `GET` | `/api/v1/benchmarks/records` | All Authenticated | Historical index closing quotes ledger. |
| `POST` | `/api/v1/benchmarks/records` | Staff Entry, Manager, Super Admin | **Manual fallback quote entry** for missing dates. |
| `POST` | `/api/v1/benchmarks/records/bulk` | Staff Entry, Manager, Super Admin | Bulk quote paste (TSV/CSV parsing). |
| `POST` | `/api/v1/benchmarks/sync` | Manager, Super Admin | Trigger live market feed sync. |

---

### 4.5 Hybrid Asset Allocation Overrides (`/api/v1/hybrid-allocations`)

| Method | Endpoint | Allowed Roles | Description |
| :--- | :--- | :--- | :--- |
| `GET` | `/api/v1/hybrid-allocations` | All Authenticated | List all active product equity/debt split rules. |
| `POST` | `/api/v1/hybrid-allocations` | Manager, Super Admin | Create custom scheme ratio override (e.g. 65% Eq / 35% Debt). |
| `PATCH` | `/api/v1/hybrid-allocations/:id` | Manager, Super Admin | Adjust slider ratio or investment rationale notes. |
| `DELETE` | `/api/v1/hybrid-allocations/:id` | Manager, Super Admin | Delete rule (reverts product to 50/50 baseline). |

---

### 4.6 Reporting Runs, Pre-Flight Audit & Freeze Gates (`/api/v1/reporting`)

| Method | Endpoint | Allowed Roles | Description |
| :--- | :--- | :--- | :--- |
| `GET` | `/api/v1/reporting/pre-flight-audit` | All Authenticated | Evaluates 4 prerequisite gates (missing NAVs, unapproved trades, unapproved balances, missing client emails) for period `?period=30-09-2026`. |
| `POST` | `/api/v1/reporting/freeze` | Manager, Super Admin | **Seals month-end reporting run**: locks cashflows and valuations against modification. |
| `POST` | `/api/v1/reporting/unfreeze` | Manager, Super Admin | **Breaks period seal**: requires mandatory manager audit justification. |
| `POST` | `/api/v1/reporting/calculate-pipeline` | Manager, Super Admin | **Runs 5-stage O_Template calculation pipeline** and formula synchronization. |
| `GET` | `/api/v1/reporting/fy-dashboard` | All Authenticated | Returns annual performance payload: Header, Summary, XIRR breakup, Asset allocation movements, and KPIs. |

---

### 4.7 Email Hub & Dispatch Logs (`/api/v1/communications`)

| Method | Endpoint | Allowed Roles | Description |
| :--- | :--- | :--- | :--- |
| `GET` | `/api/v1/communications/campaigns` | All Authenticated | List client report email statuses for selected period. |
| `POST` | `/api/v1/communications/batch-mark-ready` | Staff Entry, Manager, Super Admin | Move selected draft emails to `Ready` status. |
| `POST` | `/api/v1/communications/batch-approve` | Manager, Super Admin | Manager sign-off on ready email campaigns. |
| `POST` | `/api/v1/communications/batch-send` | Manager, Super Admin | **Dispatches PAN-encrypted PDF emails** via SMTP gateway adhering to warmup quotas. |
| `GET` | `/api/v1/communications/logs` | All Authenticated | Query delivery logs with status filters (`Sent`, `Queued`, `Failed`, `Bounced`). |
| `POST` | `/api/v1/communications/logs/:id/retry` | Staff Entry, Manager, Super Admin | Retry failed transmission. |
| `POST` | `/api/v1/communications/logs/:id/reroute` | Staff Entry, Manager, Super Admin | Resend report to alternate email address. |
| `GET` | `/api/v1/communications/provider-status` | All Authenticated | SMTP gateway connectivity, latency, and today's warmup quota counter. |

---

## 5. End-to-End "Add Trade Entry" Workflow Implementation

### 5.1 Request DTO: `CreateCashflowDto`

```typescript
import {
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsPositive,
  IsString,
  Matches,
} from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import { TransactionType, AssetCategory } from '@prisma/client';

export class CreateCashflowDto {
  @ApiProperty({ example: 46, description: 'Sequential row number' })
  @IsInt()
  @IsPositive()
  Sr_No: number;

  @ApiProperty({ example: '26-10-2026', description: 'System date of entry' })
  @IsString()
  @Matches(/^\d{2}-\d{2}-\d{4}$/, { message: 'Date_Of_Entry must be in dd-MM-yyyy format' })
  Date_Of_Entry: string;

  @ApiProperty({ example: 'USR-001', description: 'Operator User ID' })
  @IsString()
  @IsNotEmpty()
  User_Id: string;

  @ApiProperty({ example: 'October 2026', description: 'Derived reporting month' })
  @IsString()
  @IsNotEmpty()
  Month: string;

  @ApiProperty({ example: 'ABC Family Office', description: 'Client Group Head Name' })
  @IsString()
  @IsNotEmpty()
  Group_Head_Name: string;

  @ApiProperty({ example: 'Rajesh ABC', description: 'Beneficiary family member' })
  @IsString()
  @IsNotEmpty()
  Family_Member_Name: string;

  @ApiProperty({ example: 'Anil K.', description: 'Relationship Manager / Owner' })
  @IsString()
  @IsNotEmpty()
  Client_Owner: string;

  @ApiProperty({ example: '26-10-2026', description: 'Trade execution date' })
  @IsString()
  @Matches(/^\d{2}-\d{2}-\d{4}$/, { message: 'Transaction_Date must be in dd-MM-yyyy format' })
  Transaction_Date: string;

  @ApiProperty({ enum: TransactionType, example: 'Purchase' })
  @IsEnum(TransactionType)
  Transaction_Type: TransactionType;

  @ApiProperty({ enum: AssetCategory, example: 'MF' })
  @IsEnum(AssetCategory)
  Category: AssetCategory;

  @ApiProperty({ example: 'Nippon India Multi Cap Fund - Growth' })
  @IsString()
  @IsNotEmpty()
  Sub_Category: string;

  @ApiProperty({ example: 150000, description: 'Monetary amount in INR' })
  @IsNumber()
  Amounts: number;

  @ApiProperty({ example: 150000, description: 'New capital inflow' })
  @IsNumber()
  New_Investments: number;

  @ApiProperty({ example: 0, description: 'Realized profit or loss' })
  @IsNumber()
  Profit_Loss: number;

  @ApiProperty({ example: 12.5, description: 'Historical XIRR percentage' })
  @IsNumber()
  XIRR: number;
}
```

---

### 5.2 Service Logic: `CashflowsService.create`

```typescript
import { Injectable, BadRequestException, ConflictException } from '@nestjs/common';
import { PrismaService } from '../core/prisma/prisma.service';
import { CreateCashflowDto } from './dto/create-cashflow.dto';
import { ApprovalStatus, AuditAction } from '@prisma/client';

@Injectable()
export class CashflowsService {
  constructor(private readonly prisma: PrismaService) {}

  async create(dto: CreateCashflowDto, currentUser: { id: string; name: string }) {
    return this.prisma.$transaction(async (tx) => {
      // 1. Resolve Group Head
      const groupHead = await tx.groupHead.findFirst({
        where: { name: { equals: dto.Group_Head_Name.trim(), mode: 'insensitive' } },
        include: { familyMembers: true },
      });

      if (!groupHead) {
        throw new BadRequestException(`Group Head "${dto.Group_Head_Name}" is not registered.`);
      }

      // 2. Resolve Family Member
      const familyMember = groupHead.familyMembers.find(
        (m) => m.name.toLowerCase() === dto.Family_Member_Name.trim().toLowerCase(),
      );

      // 3. Compute or verify sequential Sr_No
      const highestEntry = await tx.masterCashflow.findFirst({
        orderBy: { srNo: 'desc' },
        select: { srNo: true },
      });
      const nextSrNo = (highestEntry?.srNo ?? 0) + 1;

      // 4. Create Master Cashflow Record
      const cashflow = await tx.masterCashflow.create({
        data: {
          srNo: nextSrNo,
          dateOfEntry: dto.Date_Of_Entry,
          userId: dto.User_Id || currentUser.id,
          month: dto.Month,
          clientOwner: dto.Client_Owner,
          groupHeadId: groupHead.id,
          groupHeadName: groupHead.name,
          familyMemberId: familyMember?.id ?? null,
          familyMemberName: dto.Family_Member_Name,
          transactionDate: dto.Transaction_Date,
          transactionType: dto.Transaction_Type,
          category: dto.Category,
          subCategory: dto.Sub_Category,
          amounts: dto.Amounts,
          newInvestments: dto.New_Investments,
          profitLoss: dto.Profit_Loss,
          xirr: dto.XIRR,
          approvalStatus: ApprovalStatus.PENDING,
          submittedById: currentUser.id,
          submittedByName: currentUser.name,
          submittedAt: new Date(),
        },
      });

      // 5. Create Initial Immutable Audit Trail Entry
      await tx.auditTrail.create({
        data: {
          action: AuditAction.CREATED,
          userId: currentUser.id,
          userName: currentUser.name,
          reason: 'Initial staff trade entry via portal form.',
          cashflowId: cashflow.id,
          changes: {
            Sr_No: nextSrNo,
            Amounts: dto.Amounts,
            Transaction_Type: dto.Transaction_Type,
            Category: dto.Category,
            Sub_Category: dto.Sub_Category,
          },
        },
      });

      return cashflow;
    });
  }
}
```

---

### 5.3 Controller Route: `CashflowsController.create`

```typescript
import { Controller, Post, Body, UseGuards, HttpCode, HttpStatus } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiCookieAuth } from '@nestjs/swagger';
import { CashflowsService } from './cashflows.service';
import { CreateCashflowDto } from './dto/create-cashflow.dto';
import { AuthGuard } from '../auth/guards/auth.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';

@ApiTags('Master Cashflows')
@ApiCookieAuth('proaffluence.session_token')
@UseGuards(AuthGuard)
@Controller('api/v1/cashflows')
export class CashflowsController {
  constructor(private readonly cashflowsService: CashflowsService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Record a new trade cashflow entry (Maker Entry)' })
  @ApiResponse({ status: 201, description: 'Trade entry successfully queued for review.' })
  @ApiResponse({ status: 400, description: 'Invalid group head or validation error.' })
  async create(
    @Body() dto: CreateCashflowDto,
    @CurrentUser() user: { id: string; name: string },
  ) {
    return this.cashflowsService.create(dto, user);
  }
}
```

---

## 6. Prisma Migrator Workflow & Commands

All database schema evolutions must be tracked through **Prisma Migrator** to guarantee repeatable, version-controlled SQL migrations across environments:

```bash
# 1. Create and apply a new migration in development
pnpm run migrate:dev --name <migration_name>
# Example: pnpm run migrate:dev --name init_business_domain_models

# 2. Check the current status of applied and pending migrations
pnpm run migrate:status

# 3. Apply all pending migrations in staging/production (CI/CD pipeline)
pnpm run migrate:deploy

# 4. Re-generate Prisma Client types after schema updates
pnpm run prisma:generate

# 5. Open visual database browser to inspect tables and data
pnpm run prisma:studio

# 6. Reset database and re-run all migrations from scratch (Development only)
pnpm run migrate:reset
```

The migration history is stored in the `prisma/migrations/` directory:
- [`20261022075327_init_better_auth/migration.sql`](file:///Users/metamac/Development/proaffluence%20/proaffluence-backend/prisma/migrations/20261022075327_init_better_auth/migration.sql): Initial BetterAuth tables (`users`, `sessions`, `accounts`, `verifications`, `rate_limits`).
- [`20261022111225_add_security_and_performance_indexes/migration.sql`](file:///Users/metamac/Development/proaffluence%20/proaffluence-backend/prisma/migrations/20261022111225_add_security_and_performance_indexes/migration.sql): Security rate limiting and token indexes.
- [`20261026120914_init_business_domain_models/migration.sql`](file:///Users/metamac/Development/proaffluence%20/proaffluence-backend/prisma/migrations/20261026120914_init_business_domain_models/migration.sql): Core business models (`group_heads`, `family_members`, `master_cashflows`, `closing_balances`, `benchmarks`, `indices_data_records`, `hybrid_allocation_rules`, `reporting_runs`, `email_campaigns`, `delivery_logs`, `audit_trails`).

---

## 7. Implementation Checklist & Next Steps

1. **Step 1 — Update Prisma Schema**:
   - Merge the domain models into `proaffluence-backend/prisma/schema.prisma`.
   - Run `pnpm exec prisma migrate dev --name init_business_domain_models`.
2. **Step 2 — Seed Initial Master Data**:
   - Seed `group_heads`, `family_members`, `benchmarks`, and default `hybrid_allocation_rules`.
   - Run `pnpm run seed`.
3. **Step 3 — Generate Domain Modules in NestJS**:
   - Create `src/cashflows/`, `src/closing-balances/`, `src/group-heads/`, `src/reporting/`.
   - Implement `CreateCashflowDto` with `class-validator` and register routes in `app.module.ts`.
4. **Step 4 — Wire Frontend Service**:
   - Update `cashflow.service.ts` in `proaffluence-frontend` to replace mock store mutation with `fetch('/api/v1/cashflows', { method: 'POST', body: JSON.stringify(values) })`.
5. **Step 5 — Verify Pre-Flight Freeze & O_Template Recalculation**:
   - Confirm that frozen reporting periods lock records against modification and trigger the formula recalculation pipeline.
