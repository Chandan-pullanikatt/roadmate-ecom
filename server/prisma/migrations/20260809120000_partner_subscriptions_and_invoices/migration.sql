-- Partner subscriptions: the 3-month free trial and the monthly invoice
-- (HANDOFF §7ter). Agreed 2026-08-07, unbuilt until now — which is why the
-- District dashboard's fee rows have been labelled as projections (§7bis.1).
--
-- Additive only. Two new tables and two new enums; no existing table is
-- altered, nothing is dropped and nothing is backfilled.
--
-- ⚠️ **Nothing here creates a subscription for an existing partner.** The trial
-- clock starts at `User.approvedAt`, and every partner approved before that
-- column landed (migration 20260807090000) has it NULL. A backfill would have
-- to invent an approval date, and the date it invented would decide when a real
-- business starts being charged. `ensureSubscription()` in
-- `src/lib/subscription.js` creates a row the first time it sees a partner with
-- a real `approvedAt`, and reports the rest as "trial start unknown" — which is
-- a question for the client's records, not for a migration.

CREATE TYPE "InvoiceStatus" AS ENUM ('DUE', 'PAID', 'VOID');
CREATE TYPE "InvoicePaidVia" AS ENUM ('RAZORPAY_LINK', 'MANUAL');

-- One row per billable partner (SHOP / DISTRIBUTOR / MANUFACTURER).
--
-- There is deliberately no `status` column: trial-vs-active is a function of
-- `trialEndsAt` and the clock, and past-due is a function of an unpaid invoice.
-- A stored status is a second copy of both that drifts the moment a scheduled
-- job does not run, and a partner the database *says* is in good standing
-- because cron died is worse than one that is visibly unbilled.
CREATE TABLE "PartnerSubscription" (
  "id"              SERIAL       NOT NULL,
  "trialStartedAt"  TIMESTAMP(3) NOT NULL,
  "trialEndsAt"     TIMESTAMP(3) NOT NULL,
  "billingAnchorAt" TIMESTAMP(3) NOT NULL,
  "cancelledAt"     TIMESTAMP(3),
  "cancelNote"      TEXT,
  "createdAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"       TIMESTAMP(3) NOT NULL,
  "userId"          INTEGER      NOT NULL,

  CONSTRAINT "PartnerSubscription_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "PartnerSubscription_userId_key" ON "PartnerSubscription"("userId");

ALTER TABLE "PartnerSubscription"
  ADD CONSTRAINT "PartnerSubscription_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

-- One month, one invoice, one frozen amount. The fee is read from
-- `PlatformConfig` at issue and written here, exactly as the commission split is
-- frozen at delivery: editing the fee reprices next month, never a month
-- already invoiced.
CREATE TABLE "SubscriptionInvoice" (
  "id"             SERIAL          NOT NULL,
  "number"         TEXT            NOT NULL,
  "periodStart"    TIMESTAMP(3)    NOT NULL,
  "periodEnd"      TIMESTAMP(3)    NOT NULL,
  "amount"         DECIMAL(12,2)   NOT NULL,
  "status"         "InvoiceStatus" NOT NULL DEFAULT 'DUE',
  "issuedAt"       TIMESTAMP(3)    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "dueAt"          TIMESTAMP(3)    NOT NULL,
  "paidAt"         TIMESTAMP(3),
  "voidedAt"       TIMESTAMP(3),
  "voidNote"       TEXT,
  "paidVia"        "InvoicePaidVia",
  "paymentRef"     TEXT,
  "paymentLinkId"  TEXT,
  "paymentLinkUrl" TEXT,
  "markedPaidById" INTEGER,
  "subscriptionId" INTEGER         NOT NULL,

  CONSTRAINT "SubscriptionInvoice_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "SubscriptionInvoice_number_key" ON "SubscriptionInvoice"("number");
CREATE UNIQUE INDEX "SubscriptionInvoice_paymentLinkId_key" ON "SubscriptionInvoice"("paymentLinkId");

-- What makes `npm run billing` safe to re-run, and safe to run twice in one
-- month: a period already invoiced cannot be invoiced again. Same discipline as
-- Settlement's (shopId, periodStart).
CREATE UNIQUE INDEX "SubscriptionInvoice_subscriptionId_periodStart_key"
  ON "SubscriptionInvoice"("subscriptionId", "periodStart");

-- "What is overdue" is the one query the finance view runs.
CREATE INDEX "SubscriptionInvoice_status_dueAt_idx" ON "SubscriptionInvoice"("status", "dueAt");

ALTER TABLE "SubscriptionInvoice"
  ADD CONSTRAINT "SubscriptionInvoice_subscriptionId_fkey"
  FOREIGN KEY ("subscriptionId") REFERENCES "PartnerSubscription"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "SubscriptionInvoice"
  ADD CONSTRAINT "SubscriptionInvoice_markedPaidById_fkey"
  FOREIGN KEY ("markedPaidById") REFERENCES "User"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
