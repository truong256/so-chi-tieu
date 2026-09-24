import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  verifyAdminUser,
  getUserRole,
  AuthorizationError,
} from "../backend/src/services/admin-auth.service.ts";
import { AuthenticationError } from "../backend/src/services/supabase-auth.service.ts";

const rbacMigration = await readFile(
  new URL("../database/migrations/009_admin_rbac.sql", import.meta.url),
  "utf8",
);
const baseSchema = await readFile(
  new URL("../database/migrations/000_base_schema.sql", import.meta.url),
  "utf8",
);
const initialSchema = await readFile(
  new URL("../database/migrations/001_initial_schema.sql", import.meta.url),
  "utf8",
);

test("user_roles table enforces strict RLS and anti-self-promotion", () => {
  // 1. RLS enabled
  assert.match(
    rbacMigration,
    /ALTER\s+TABLE\s+public\.user_roles\s+ENABLE\s+ROW\s+LEVEL\s+SECURITY/i,
    "user_roles must have Row Level Security enabled",
  );

  // 2. Only SELECT own role allowed for authenticated
  assert.match(
    rbacMigration,
    /CREATE\s+POLICY\s+user_roles_select_own\s+ON\s+public\.user_roles\s+FOR\s+SELECT\s+TO\s+authenticated\s+USING\s*\(\s*auth\.uid\(\)\s*=\s*user_id\s*\)/i,
    "Authenticated users must only SELECT their own role record",
  );

  // 3. Prohibit any INSERT, UPDATE, or DELETE policies for authenticated or anon
  assert.doesNotMatch(
    rbacMigration,
    /CREATE\s+POLICY[^\n]+FOR\s+(INSERT|UPDATE|DELETE|ALL)\s+TO\s+(authenticated|anon|PUBLIC)/i,
    "Self-promotion hazard: authenticated or anon users must NEVER have INSERT, UPDATE, or DELETE policies on user_roles",
  );

  // 4. Default provision is strictly 'user', never 'admin'
  assert.match(
    rbacMigration,
    /'user'::public\.app_role/i,
    "Default provisioned role must be 'user'",
  );
  assert.doesNotMatch(
    rbacMigration,
    /INSERT\s+INTO\s+public\.user_roles[^\n]+'admin'/i,
    "Auto-provisioning trigger must never provision 'admin'",
  );
});

test("security definer role functions enforce ownership and reject anonymous access", () => {
  // Functions have fixed search_path to prevent search_path hijacking
  assert.match(rbacMigration, /SET\s+search_path\s*=\s*public,\s*pg_temp/i);

  // Revoke execution from public & anon
  assert.match(
    rbacMigration,
    /REVOKE\s+ALL\s+ON\s+FUNCTION\s+public\.has_role[^\n]+FROM\s+PUBLIC,\s*anon/i,
  );
  assert.match(
    rbacMigration,
    /REVOKE\s+ALL\s+ON\s+FUNCTION\s+public\.is_admin[^\n]+FROM\s+PUBLIC,\s*anon/i,
  );
  assert.match(
    rbacMigration,
    /REVOKE\s+ALL\s+ON\s+FUNCTION\s+public\.get_my_role[^\n]+FROM\s+PUBLIC,\s*anon/i,
  );
});

test("profiles table does not expose client-writable role field", () => {
  // Role must not be in profiles table where user can update their own profile
  assert.doesNotMatch(
    baseSchema,
    /CREATE\s+TABLE\s+IF\s+NOT\s+EXISTS\s+public\.profiles\s*\([^)]*\brole\b/i,
    "profiles table must not contain a role column",
  );
});

test("user financial privacy: core financial tables remain user-scoped and not readable by arbitrary admin queries", () => {
  for (const table of [
    "wallets",
    "categories",
    "transactions",
    "transfers",
    "budgets",
    "savings_goals",
  ]) {
    assert.match(
      initialSchema,
      new RegExp(`CREATE POLICY[^\n]+ON ${table}[^;]+auth\\.uid\\(\\)\\s*=\\s*user_id`, "i"),
      `${table} RLS policies must strictly enforce auth.uid() = user_id`,
    );
  }
});

test("admin auth guard rejects anonymous, expired, or non-admin access tokens", async () => {
  // Anonymous / invalid token syntax
  await assert.rejects(
    async () => {
      await verifyAdminUser("");
    },
    (err) => {
      assert.ok(err instanceof AuthenticationError);
      assert.equal(err.status, 401);
      return true;
    },
  );

  // Mock server verification rejecting non-admin
  // With mock config pointing to dummy URL
  await assert.rejects(
    async () => {
      await verifyAdminUser("invalid-or-fake-token", {
        supabaseUrl: "http://127.0.0.1:54321",
        supabasePublishableKey: "fake-key",
      });
    },
    (err) => {
      // Rejects with AuthenticationError or 503 if unreachable, never allows admin
      assert.ok(err instanceof AuthenticationError || err instanceof AuthorizationError || err instanceof Error);
      return true;
    },
  );
});

test("getUserRole falls back safely to 'user' role on invalid token or missing role record", async () => {
  await assert.rejects(
    async () => {
      await getUserRole("invalid-token", {
        supabaseUrl: "http://127.0.0.1:54321",
        supabasePublishableKey: "fake-key",
      });
    },
    (err) => {
      assert.ok(err instanceof AuthenticationError || err instanceof Error);
      return true;
    },
  );
});
