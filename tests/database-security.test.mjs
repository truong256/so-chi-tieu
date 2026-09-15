import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const initialSchema = await readFile(
  new URL("../database/migrations/001_initial_schema.sql", import.meta.url),
  "utf8",
);
const securityMigration = await readFile(
  new URL(
    "../database/migrations/006_finance_integrity_and_security.sql",
    import.meta.url,
  ),
  "utf8",
);
const indexMigration = await readFile(
  new URL(
    "../database/migrations/007_query_performance_indexes.sql",
    import.meta.url,
  ),
  "utf8",
);
const transactionIntegrityMigration = await readFile(
  new URL(
    "../database/migrations/008_transactions_transfers_integrity_and_indexes.sql",
    import.meta.url,
  ),
  "utf8",
);

test("core financial tables keep row-level security enabled", () => {
  for (const table of [
    "profiles",
    "wallets",
    "categories",
    "transactions",
    "transfers",
    "budgets",
    "savings_goals",
    "recurring_transactions",
  ]) {
    assert.match(
      initialSchema,
      new RegExp(
        `ALTER TABLE(?: IF EXISTS)? ${table} ENABLE ROW LEVEL SECURITY`,
        "i",
      ),
      `RLS must remain enabled for ${table}`,
    );
  }
  assert.match(initialSchema, /auth\.uid\(\)/i);
});

test("privileged finance RPCs reject anonymous execution and enforce ownership", () => {
  assert.match(
    securityMigration,
    /REVOKE ALL ON FUNCTION public\.adjust_budget_funds[\s\S]+FROM PUBLIC, anon/i,
  );
  assert.match(
    securityMigration,
    /REVOKE ALL ON FUNCTION public\.record_recurring_transaction[\s\S]+FROM PUBLIC, anon/i,
  );
  assert.match(securityMigration, /v_user_id uuid := auth\.uid\(\)/i);
  assert.match(securityMigration, /user_id = v_user_id/i);
  assert.doesNotMatch(
    securityMigration,
    /GRANT EXECUTE ON ALL FUNCTIONS/i,
  );
});

test("username lookup cannot enumerate authentication emails", () => {
  assert.match(
    securityMigration,
    /REVOKE EXECUTE ON FUNCTION public\.get_email_by_username\(text\) FROM PUBLIC, anon, authenticated/i,
  );
  assert.doesNotMatch(
    securityMigration,
    /SELECT\s+email\s+FROM\s+auth\.users/i,
  );
});

test("dashboard access patterns have user-scoped indexes", () => {
  for (const fragment of [
    "wallets (user_id, created_at)",
    "categories (user_id, kind, name)",
    "budgets (user_id, created_at)",
    "savings_goals (user_id, deadline)",
    "recurring_transactions (user_id, next_run_at)",
  ]) {
    assert.ok(indexMigration.includes(fragment), `Missing index for ${fragment}`);
  }
  for (const fragment of [
    "transactions (user_id, occurred_at DESC)",
    "transactions (user_id, wallet_id)",
    "transfers (user_id, occurred_at DESC)",
    "transfers (user_id, from_wallet_id, to_wallet_id)",
  ]) {
    assert.ok(transactionIntegrityMigration.includes(fragment), `Missing index for ${fragment}`);
  }
});

test("transactions and transfers deletion triggers protect against negative balance drift", () => {
  assert.match(
    transactionIntegrityMigration,
    /BEFORE DELETE ON public\.transactions/i,
    "Missing BEFORE DELETE trigger on transactions",
  );
  assert.match(
    transactionIntegrityMigration,
    /BEFORE DELETE ON public\.transfers/i,
    "Missing BEFORE DELETE trigger on transfers",
  );
  assert.match(
    transactionIntegrityMigration,
    /check_wallet_available_balance/i,
    "Must verify available balance before deleting income or transfer",
  );
});
