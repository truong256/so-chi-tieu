export class HttpInputError extends Error {
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = "HttpInputError";
    this.status = status;
  }
}

export async function readJsonBody(request: Request, maxBytes: number): Promise<unknown> {
  const contentType = request.headers.get("content-type")?.toLowerCase() ?? "";
  if (!contentType.includes("application/json")) {
    throw new HttpInputError("Content-Type phải là application/json.", 415);
  }

  const declaredLength = Number(request.headers.get("content-length") ?? 0);
  if (Number.isFinite(declaredLength) && declaredLength > maxBytes) {
    throw new HttpInputError("Dữ liệu gửi lên vượt quá giới hạn cho phép.", 413);
  }

  const raw = await request.text();
  if (new TextEncoder().encode(raw).byteLength > maxBytes) {
    throw new HttpInputError("Dữ liệu gửi lên vượt quá giới hạn cho phép.", 413);
  }

  try {
    return JSON.parse(raw) as unknown;
  } catch {
    throw new HttpInputError("Dữ liệu gửi lên không đúng định dạng JSON.", 400);
  }
}

export function asRecord(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}
