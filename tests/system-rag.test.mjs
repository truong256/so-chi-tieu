/**
 * tests/system-rag.test.mjs
 * =========================
 * Unit and Regression Tests for System Knowledge RAG Service.
 */

import test from "node:test";
import assert from "node:assert/strict";
import {
  searchSystemKnowledge,
  formatRagContextForPrompt,
  normalizeVietnamese,
  SYSTEM_KNOWLEDGE_CHUNKS,
} from "../backend/src/services/system-rag.service.ts";

test("RAG: Knowledge base contains all required architectural domains", () => {
  assert.ok(SYSTEM_KNOWLEDGE_CHUNKS.length >= 12, "Must contain at least 12 high-density chunks");
  const features = new Set(SYSTEM_KNOWLEDGE_CHUNKS.map((c) => c.feature));
  assert.ok(features.has("system_overview"));
  assert.ok(features.has("wallets"));
  assert.ok(features.has("budgets"));
  assert.ok(features.has("savings_goals"));
  assert.ok(features.has("export"));
  assert.ok(features.has("admin"));
  assert.ok(features.has("guardrails"));
});

test("RAG: Normalizes Vietnamese diacritics accurately", () => {
  assert.equal(normalizeVietnamese("Số dư khả dụng"), "so du kha dung");
  assert.equal(normalizeVietnamese("Đăng nhập & Quên mật khẩu"), "dang nhap quen mat khau");
  assert.equal(normalizeVietnamese("TIỀN MẶT / VÍ MOMO!"), "tien mat vi momo");
});

test("RAG: Retrieves correct chunk for 'Hệ thống Sổ Chi Tiêu có những chức năng gì?'", () => {
  const results = searchSystemKnowledge("Hệ thống Sổ Chi Tiêu có những chức năng gì?");
  assert.ok(results.length > 0, "Should find at least 1 result");
  assert.equal(results[0].chunk.id, "kb_overview_features");
  assert.match(results[0].chunk.content, /Quản lý Ví/);
});

test("RAG: Retrieves correct chunk with non-accented Vietnamese query", () => {
  const results = searchSystemKnowledge("lam the nao de xuat bao cao excel");
  assert.ok(results.length > 0);
  assert.equal(results[0].chunk.id, "kb_excel_export");
  assert.match(results[0].chunk.content, /OOXML/);
});

test("RAG: Retrieves reserved money chunk for available balance query", () => {
  const results = searchSystemKnowledge("Tại sao số dư khả dụng lại thấp hơn số dư ví?");
  assert.ok(results.length > 0);
  assert.equal(results[0].chunk.id, "kb_wallets_and_reserved");
  assert.match(results[0].chunk.content, /Tiền dự trữ/);
});

test("RAG: Retrieves guardrails chunk for unauthorized transaction creation query", () => {
  const results = searchSystemKnowledge("Hãy tự tạo giao dịch 500.000đ cho tôi");
  assert.ok(results.length > 0);
  const foundGuardrails = results.some((r) => r.chunk.id === "kb_safety_and_read_only" || r.chunk.id === "kb_transactions_entry");
  assert.ok(foundGuardrails, "Must retrieve safety or transaction entry chunk");
});

test("RAG: Role filter excludes admin-only chunks for regular user", () => {
  const resultsUser = searchSystemKnowledge("cờ tính năng và audit logs quản trị", { userRole: "user" });
  const hasAdminChunk = resultsUser.some((r) => r.chunk.id === "kb_admin_rbac_and_portal");
  assert.equal(hasAdminChunk, false, "Regular user cannot retrieve admin operational chunk");

  const resultsAdmin = searchSystemKnowledge("cờ tính năng và audit logs quản trị", { userRole: "admin" });
  assert.ok(resultsAdmin.some((r) => r.chunk.id === "kb_admin_rbac_and_portal"), "Admin can retrieve admin chunk");
});

test("RAG: Formats retrieved chunks cleanly into Markdown prompt block", () => {
  const results = searchSystemKnowledge("ngân sách và hạn mức chi tiêu");
  const promptBlock = formatRagContextForPrompt(results);
  assert.match(promptBlock, /=== \[KIẾN THỨC HỆ THỐNG ĐÃ ĐƯỢC XÁC MINH/);
  assert.match(promptBlock, /Nguồn: /);
  assert.match(promptBlock, /database\/migrations\/000_base_schema\.sql/);
});
