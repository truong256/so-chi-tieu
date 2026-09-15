import { strFromU8, unzipSync } from "fflate";
import type { Category, Transaction, TransactionType, Wallet } from "../types/finance.types";
import { detectDuplicateTransaction } from "./duplicate-detection.service.ts";

export interface ImportedRowPreview {
  rowIndex: number;
  raw: Record<string, string>;
  title: string;
  amount: number;
  type: TransactionType;
  occurredAt: string; // ISO string
  categoryName?: string;
  categoryId?: string;
  walletName?: string;
  walletId?: string;
  note?: string;
  status: "valid" | "invalid" | "duplicate";
  errorMessage?: string;
  duplicateReason?: string;
}

export interface ColumnMapping {
  titleColumn?: string;
  amountColumn?: string;
  typeColumn?: string;
  dateColumn?: string;
  categoryColumn?: string;
  walletColumn?: string;
  noteColumn?: string;
}

/**
 * Standard RFC 4180 CSV parser supporting quotes, multiline cells, and auto delimiter detection (, ; \t).
 */
export function parseCsvText(text: string): string[][] {
  // Strip BOM if present
  let cleanText = text;
  if (cleanText.charCodeAt(0) === 0xfeff) {
    cleanText = cleanText.slice(1);
  }

  // Detect delimiter based on header line
  const firstLine = cleanText.split(/\r?\n/)[0] || "";
  let delimiter = ",";
  const commaCount = (firstLine.match(/,/g) || []).length;
  const semicolonCount = (firstLine.match(/;/g) || []).length;
  const tabCount = (firstLine.match(/\t/g) || []).length;

  if (semicolonCount > commaCount && semicolonCount >= tabCount) {
    delimiter = ";";
  } else if (tabCount > commaCount && tabCount > semicolonCount) {
    delimiter = "\t";
  }

  const rows: string[][] = [];
  let currentRow: string[] = [];
  let currentCell = "";
  let insideQuotes = false;

  for (let i = 0; i < cleanText.length; i++) {
    const char = cleanText[i];
    const nextChar = cleanText[i + 1];

    if (char === '"') {
      if (insideQuotes && nextChar === '"') {
        currentCell += '"';
        i++; // skip escaped quote
      } else {
        insideQuotes = !insideQuotes;
      }
    } else if (char === delimiter && !insideQuotes) {
      currentRow.push(currentCell.trim());
      currentCell = "";
    } else if ((char === "\r" || char === "\n") && !insideQuotes) {
      if (char === "\r" && nextChar === "\n") i++; // handle CRLF
      currentRow.push(currentCell.trim());
      // Only push non-empty rows
      if (currentRow.some((c) => c.length > 0)) {
        rows.push(currentRow);
      }
      currentRow = [];
      currentCell = "";
    } else {
      currentCell += char;
    }
  }

  if (currentCell.length > 0 || currentRow.length > 0) {
    currentRow.push(currentCell.trim());
    if (currentRow.some((c) => c.length > 0)) {
      rows.push(currentRow);
    }
  }

  return rows;
}

/**
 * Native, lightweight XLSX parser using fflate.
 * Extracts sheet data from OpenXML sheets and sharedStrings without external sheetjs bloat.
 */
export function parseXlsxBuffer(buffer: Uint8Array): string[][] {
  const archive = unzipSync(buffer);

  // Parse shared strings table if present
  const sharedStrings: string[] = [];
  if (archive["xl/sharedStrings.xml"]) {
    const sstXml = strFromU8(archive["xl/sharedStrings.xml"]);
    const siMatches = sstXml.match(/<si>[\s\S]*?<\/si>/g) || [];
    for (const si of siMatches) {
      const tMatches = si.match(/<t[^>]*>([\s\S]*?)<\/t>/g) || [];
      const text = tMatches
        .map((t) => t.replace(/<[^>]+>/g, ""))
        .join("")
        .replace(/&amp;/g, "&")
        .replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">")
        .replace(/&quot;/g, '"')
        .replace(/&apos;/g, "'");
      sharedStrings.push(text);
    }
  }

  // Find first worksheet
  let sheetXmlStr = "";
  const sheetKeys = Object.keys(archive).filter((k) => k.startsWith("xl/worksheets/sheet"));
  if (sheetKeys.length > 0 && archive[sheetKeys[0]]) {
    sheetXmlStr = strFromU8(archive[sheetKeys[0]]);
  } else {
    throw new Error("Không tìm thấy trang tính (worksheet) hợp lệ trong tệp Excel.");
  }

  const rows: string[][] = [];
  const rowMatches = sheetXmlStr.match(/<row[^>]*>[\s\S]*?<\/row>/g) || [];

  for (const rowXml of rowMatches) {
    const rowValues: string[] = [];
    const cellMatches = rowXml.match(/<c[^>]*>[\s\S]*?<\/c>/g) || [];

    for (const cellXml of cellMatches) {
      const isSharedString = cellXml.includes('t="s"');
      const isInlineStr = cellXml.includes('t="inlineStr"');

      if (isInlineStr) {
        const tMatch = cellXml.match(/<t[^>]*>([\s\S]*?)<\/t>/);
        const text = tMatch
          ? tMatch[1]
              .replace(/&amp;/g, "&")
              .replace(/&lt;/g, "<")
              .replace(/&gt;/g, ">")
              .replace(/&quot;/g, '"')
              .replace(/&apos;/g, "'")
          : "";
        rowValues.push(text.trim());
      } else if (isSharedString) {
        const vMatch = cellXml.match(/<v>(\d+)<\/v>/);
        if (vMatch) {
          const index = parseInt(vMatch[1], 10);
          rowValues.push(sharedStrings[index] || "");
        } else {
          rowValues.push("");
        }
      } else {
        const vMatch = cellXml.match(/<v>([\s\S]*?)<\/v>/);
        rowValues.push(vMatch ? vMatch[1].trim() : "");
      }
    }

    if (rowValues.some((c) => c.length > 0)) {
      rows.push(rowValues);
    }
  }

  return rows;
}

/**
 * Auto-detect column mappings from header names.
 */
export function autoDetectColumnMapping(headers: string[]): ColumnMapping {
  const mapping: ColumnMapping = {};

  const clean = (s: string) =>
    s
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^a-z0-9]/g, "");

  for (const header of headers) {
    const norm = clean(header);

    if (!mapping.titleColumn && /^(tieude|title|ten|mota|description|noidung|giaodich|name)/.test(norm)) {
      mapping.titleColumn = header;
    } else if (!mapping.amountColumn && /^(sotien|amount|tien|value|price|tongtien|cost)/.test(norm)) {
      mapping.amountColumn = header;
    } else if (!mapping.typeColumn && /^(loai|type|loaigiaodich|thuchi|khoan)/.test(norm)) {
      mapping.typeColumn = header;
    } else if (!mapping.dateColumn && /^(ngay|date|thoigian|time|occurredat|ngaythang)/.test(norm)) {
      mapping.dateColumn = header;
    } else if (!mapping.categoryColumn && /^(danhmuc|category|nhom|chuyenmuc)/.test(norm)) {
      mapping.categoryColumn = header;
    } else if (!mapping.walletColumn && /^(vi|wallet|taikhoan|account|nguontien)/.test(norm)) {
      mapping.walletColumn = header;
    } else if (!mapping.noteColumn && /^(ghichu|note|memo|chuthich)/.test(norm)) {
      mapping.noteColumn = header;
    }
  }

  return mapping;
}

/**
 * Parses numeric currency values from various Vietnamese / international formats.
 */
export function parseImportAmount(raw: string): number | null {
  if (!raw || typeof raw !== "string") return null;

  // Clean currency symbols, whitespace
  let clean = raw.replace(/[đ₫VNDvndUSD$€\s]/g, "").trim();

  // If format is like "1.500.000,50" -> 1500000.5
  if (/\.\d{3},\d+$/.test(clean)) {
    clean = clean.replace(/\./g, "").replace(",", ".");
  }
  // If format is like "1,500,000.50" -> 1500000.5
  else if (/,\d{3}\.\d+$/.test(clean)) {
    clean = clean.replace(/,/g, "");
  }
  // If format is like "1.500.000" (Vietnamese thousands dots)
  else if (/\.\d{3}/.test(clean) && !clean.includes(",")) {
    clean = clean.replace(/\./g, "");
  }
  // If format is like "1,500,000" (International comma separator)
  else if (/,\d{3}/.test(clean) && !clean.includes(".")) {
    clean = clean.replace(/,/g, "");
  } else if (clean.includes(",")) {
    clean = clean.replace(",", ".");
  }

  const num = Number(clean);
  return Number.isFinite(num) && num > 0 ? num : null;
}

/**
 * Parses dates from formats: YYYY-MM-DD, DD/MM/YYYY, DD-MM-YYYY, MM/DD/YYYY, Excel serial.
 */
export function parseImportDate(raw: string): string | null {
  if (!raw || typeof raw !== "string") return null;
  const str = raw.trim();

  // Excel serial date number (e.g. 45550)
  if (/^\d{5}$/.test(str)) {
    const serial = parseInt(str, 10);
    const date = new Date((serial - 25569) * 86400 * 1000);
    if (!isNaN(date.getTime())) return date.toISOString();
  }

  // DD/MM/YYYY or DD-MM-YYYY
  const dmyMatch = str.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})(?:\s+(\d{1,2}):(\d{1,2}))?/);
  if (dmyMatch) {
    const day = parseInt(dmyMatch[1], 10);
    const month = parseInt(dmyMatch[2], 10) - 1;
    const year = parseInt(dmyMatch[3], 10);
    const hour = dmyMatch[4] ? parseInt(dmyMatch[4], 10) : 12;
    const minute = dmyMatch[5] ? parseInt(dmyMatch[5], 10) : 0;
    const date = new Date(year, month, day, hour, minute, 0);
    if (!isNaN(date.getTime()) && date.getDate() === day) {
      return date.toISOString();
    }
  }

  // Standard ISO / YYYY-MM-DD
  const isoDate = new Date(str);
  if (!isNaN(isoDate.getTime())) {
    return isoDate.toISOString();
  }

  return null;
}

/**
 * Validates, normalizes, and classifies imported table rows into preview items.
 */
export function prepareImportPreview(params: {
  rows: string[][];
  mapping: ColumnMapping;
  categories: Category[];
  wallets: Wallet[];
  existingTransactions: Transaction[];
  defaultWalletId?: string;
}): ImportedRowPreview[] {
  const { rows, mapping, categories, wallets, existingTransactions, defaultWalletId } = params;
  if (rows.length <= 1) return [];

  const headers = rows[0];
  const titleIdx = headers.indexOf(mapping.titleColumn || "");
  const amountIdx = headers.indexOf(mapping.amountColumn || "");
  const typeIdx = headers.indexOf(mapping.typeColumn || "");
  const dateIdx = headers.indexOf(mapping.dateColumn || "");
  const catIdx = headers.indexOf(mapping.categoryColumn || "");
  const walletIdx = headers.indexOf(mapping.walletColumn || "");
  const noteIdx = headers.indexOf(mapping.noteColumn || "");

  const categoryNameMap = new Map(
    categories.map((c) => [c.name.toLowerCase().trim(), c]),
  );
  const walletNameMap = new Map(
    wallets.map((w) => [w.name.toLowerCase().trim(), w]),
  );

  const previews: ImportedRowPreview[] = [];

  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    const rawMap: Record<string, string> = {};
    headers.forEach((h, colIdx) => {
      rawMap[h] = row[colIdx] || "";
    });

    const rawTitle = titleIdx >= 0 ? (row[titleIdx] || "").trim() : "";
    const rawAmount = amountIdx >= 0 ? (row[amountIdx] || "").trim() : "";
    const rawType = typeIdx >= 0 ? (row[typeIdx] || "").trim() : "";
    const rawDate = dateIdx >= 0 ? (row[dateIdx] || "").trim() : "";
    const rawCat = catIdx >= 0 ? (row[catIdx] || "").trim() : "";
    const rawWallet = walletIdx >= 0 ? (row[walletIdx] || "").trim() : "";
    const rawNote = noteIdx >= 0 ? (row[noteIdx] || "").trim() : "";

    // Parse amount
    const amount = parseImportAmount(rawAmount);

    // Parse type
    let type: TransactionType = "expense";
    const lowerType = rawType.toLowerCase();
    if (
      lowerType.includes("thu") ||
      lowerType.includes("income") ||
      lowerType.includes("nạp") ||
      lowerType.includes("lương")
    ) {
      type = "income";
    }

    // Parse date
    const parsedDate = parseImportDate(rawDate) || new Date().toISOString();

    // Map Category
    let categoryId: string | undefined;
    if (rawCat) {
      const match = categoryNameMap.get(rawCat.toLowerCase());
      if (match) categoryId = match.id;
    }
    if (!categoryId) {
      categoryId = categories.find((c) => c.kind === type)?.id;
    }

    // Map Wallet
    let walletId: string | undefined;
    if (rawWallet) {
      const match = walletNameMap.get(rawWallet.toLowerCase());
      if (match) walletId = match.id;
    }
    if (!walletId) {
      walletId = defaultWalletId || wallets[0]?.id;
    }

    // Title fallback
    const title = rawTitle || rawCat || (type === "income" ? "Khoản thu" : "Khoản chi");

    // Validation checks
    let status: "valid" | "invalid" | "duplicate" = "valid";
    let errorMessage: string | undefined;

    if (!amount || amount <= 0) {
      status = "invalid";
      errorMessage = "Số tiền không hợp lệ hoặc bằng 0";
    } else if (!title) {
      status = "invalid";
      errorMessage = "Thiếu tiêu đề / mô tả giao dịch";
    } else if (!walletId) {
      status = "invalid";
      errorMessage = "Không tìm thấy ví tương ứng";
    }

    // Check duplicate
    let duplicateReason: string | undefined;
    if (status === "valid" && amount) {
      const dupCheck = detectDuplicateTransaction(
        {
          title,
          amount,
          type,
          walletId,
          occurredAt: parsedDate,
        },
        existingTransactions,
      );

      if (dupCheck.isDuplicate) {
        status = "duplicate";
        duplicateReason = dupCheck.reason;
      }
    }

    previews.push({
      rowIndex: i,
      raw: rawMap,
      title,
      amount: amount || 0,
      type,
      occurredAt: parsedDate,
      categoryName: rawCat || categories.find((c) => c.id === categoryId)?.name,
      categoryId,
      walletName: rawWallet || wallets.find((w) => w.id === walletId)?.name,
      walletId,
      note: rawNote,
      status,
      errorMessage,
      duplicateReason,
    });
  }

  return previews;
}
