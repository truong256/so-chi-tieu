export function parseAiJsonObject(raw: string): Record<string, unknown> | null {
  let json = raw.trim();
  if (json.startsWith("```json")) {
    json = json.replace(/^```json\s*/, "").replace(/\s*```$/, "");
  } else if (json.startsWith("```")) {
    json = json.replace(/^```\s*/, "").replace(/\s*```$/, "");
  }

  try {
    const parsed = JSON.parse(json) as unknown;
    return parsed !== null && typeof parsed === "object" && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : null;
  } catch {
    return null;
  }
}

export function cleanText(value: unknown, maxLength: number): string | null {
  if (typeof value !== "string") return null;
  const text = value.trim();
  return text ? text.slice(0, maxLength) : null;
}

export function cleanMoneyAmount(value: unknown, allowZero = true): number | null {
  let numberValue: number;
  if (typeof value === "number") {
    numberValue = value;
  } else if (typeof value === "string") {
    const normalized = value.trim().replace(/[\s₫đVND]/gi, "");
    if (/^\d{1,3}(?:[.,]\d{3})+$/.test(normalized)) {
      numberValue = Number(normalized.replace(/[.,]/g, ""));
    } else if (/^\d+[.,]\d+$/.test(normalized)) {
      numberValue = Number(normalized.replace(",", "."));
    } else if (/^\d+$/.test(normalized)) {
      numberValue = Number(normalized);
    } else {
      return null;
    }
  } else {
    return null;
  }

  if (!Number.isFinite(numberValue) || numberValue < 0 || (!allowZero && numberValue === 0)) return null;
  const rounded = Math.round(numberValue);
  return rounded <= 1_000_000_000_000_000 ? rounded : null;
}

export function normalizeIsoDate(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  let year: number;
  let month: number;
  let day: number;
  const iso = trimmed.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  const local = trimmed.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/);
  if (iso) {
    year = Number(iso[1]);
    month = Number(iso[2]);
    day = Number(iso[3]);
  } else if (local) {
    day = Number(local[1]);
    month = Number(local[2]);
    year = Number(local[3]);
  } else {
    return null;
  }
  const candidate = new Date(Date.UTC(year, month - 1, day));
  if (
    candidate.getUTCFullYear() !== year ||
    candidate.getUTCMonth() !== month - 1 ||
    candidate.getUTCDate() !== day
  ) return null;
  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

export function normalizeTime(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const match = value.trim().match(/^(\d{1,2}):(\d{2})$/);
  if (!match) return null;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (hour > 23 || minute > 59) return null;
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}
