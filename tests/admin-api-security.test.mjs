import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import test from "node:test";
import { join } from "node:path";
import { sanitizeHtml } from "../backend/src/services/admin-notifications.service.ts";
import { updateSystemSetting } from "../backend/src/services/admin-settings.service.ts";

const settingsMigration = await readFile(
  new URL("../database/migrations/011_admin_system_settings.sql", import.meta.url),
  "utf8",
);
const auditMigration = await readFile(
  new URL("../database/migrations/010_admin_audit_and_ai_usage.sql", import.meta.url),
  "utf8",
);
const runtimeConfigRoute = await readFile(
  new URL("../app/api/runtime-config/route.ts", import.meta.url),
  "utf8",
);

test("service role key is never exposed to browser runtime or runtime-config endpoint", async () => {
  // 1. runtime-config route must only return URL and publishable key
  assert.doesNotMatch(
    runtimeConfigRoute,
    /SUPABASE_SERVICE_ROLE_KEY/i,
    "runtime-config must never reference or return SUPABASE_SERVICE_ROLE_KEY",
  );
  assert.doesNotMatch(
    runtimeConfigRoute,
    /service_role/i,
    "runtime-config must never return service_role credentials",
  );

  // 2. Scan frontend directory recursively for any service_role references
  async function scanDirectory(dir) {
    const entries = await readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = join(dir, entry.name);
      if (entry.isDirectory()) {
        await scanDirectory(fullPath);
      } else if (entry.name.endsWith(".ts") || entry.name.endsWith(".tsx") || entry.name.endsWith(".js")) {
        const content = await readFile(fullPath, "utf8");
        assert.doesNotMatch(
          content,
          /NEXT_PUBLIC_.*SERVICE_ROLE/i,
          `File ${fullPath} must not contain NEXT_PUBLIC service role prefix`,
        );
        assert.doesNotMatch(
          content,
          /SUPABASE_SERVICE_ROLE_KEY/i,
          `Frontend file ${fullPath} must never reference SUPABASE_SERVICE_ROLE_KEY`,
        );
      }
    }
  }

  await scanDirectory(new URL("../frontend", import.meta.url).pathname.replace(/^\/([A-Z]:)/, "$1"));
});

test("system settings protects secrets from being saved or modified via UI", async () => {
  // 1. Migration trigger blocks secret keys at database level
  assert.match(
    settingsMigration,
    /LIKE\s+'%secret%'|LIKE\s+'%key%'|LIKE\s+'%token%'|LIKE\s+'%password%'/i,
    "Database trigger must block storing secret/key/token/password",
  );

  // 2. Service level blocks setting disallowed or sensitive keys
  await assert.rejects(
    async () => {
      await updateSystemSetting("admin-1", "GEMINI_API_KEY", "stolen-key");
    },
    /Khóa cấu hình không hợp lệ/i,
  );

  await assert.rejects(
    async () => {
      await updateSystemSetting("admin-1", "SUPABASE_SERVICE_ROLE_KEY", "stolen-key");
    },
    /Khóa cấu hình không hợp lệ/i,
  );
});

test("admin audit logs table enforces admin-only access and append-only immutability", () => {
  assert.match(
    auditMigration,
    /ALTER\s+TABLE\s+public\.admin_audit_logs\s+ENABLE\s+ROW\s+LEVEL\s+SECURITY/i,
  );
  assert.match(
    auditMigration,
    /CREATE\s+POLICY\s+admin_audit_logs_admin_select\s+ON\s+public\.admin_audit_logs\s+FOR\s+SELECT\s+TO\s+authenticated\s+USING\s*\(\s*public\.is_admin\(\)\s*\)/i,
    "Only verified admin can view audit logs",
  );
  assert.doesNotMatch(
    auditMigration,
    /CREATE\s+POLICY[^\n]+FOR\s+(UPDATE|DELETE)\s+ON\s+public\.admin_audit_logs/i,
    "Audit logs must be append-only and cannot be updated or deleted",
  );
});

test("system notification input sanitizer removes HTML and script tags", () => {
  const dirtyTitle = "<script>alert('pwned')</script>Bảo trì hệ thống <b>khẩn</b>";
  const cleanTitle = sanitizeHtml(dirtyTitle);
  assert.equal(cleanTitle, "Bảo trì hệ thống khẩn");

  const dirtyMessage = "<iframe src='evil.com'></iframe>Thông báo: <style>body{display:none}</style>Nâng cấp máy chủ.";
  const cleanMessage = sanitizeHtml(dirtyMessage);
  assert.equal(cleanMessage, "Thông báo: Nâng cấp máy chủ.");
});
