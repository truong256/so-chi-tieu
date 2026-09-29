/**
 * backend/src/services/ollama-client.ts
 * =====================================
 * Centralized, robust client for Ollama local/self-hosted AI.
 * 
 * Responsibilities:
 * 1. Health check & model capability inspection via /api/tags (with 30s cache).
 * 2. Typed error codes with localized Vietnamese messages.
 * 3. Strict request deadline enforcement across retries/fallbacks.
 * 4. Client AbortSignal forwarding.
 * 5. In-process concurrency limiter to avoid machine overload.
 * 6. Zero leakage of internal tokens, stack traces, or raw image data.
 */

import {
  OLLAMA_TEXT_MODELS,
  OLLAMA_VISION_MODELS,
  DEFAULT_OLLAMA_BASE_URL,
} from "./ollama-models.ts";

export type OllamaErrorCode =
  | "OLLAMA_OFFLINE"
  | "ENDPOINT_UNREACHABLE"
  | "CHAT_MODEL_MISSING"
  | "VISION_MODEL_MISSING"
  | "MODEL_UNSUPPORTED"
  | "TIMEOUT"
  | "OVERLOADED"
  | "EMPTY_RESPONSE"
  | "INVALID_JSON";

export interface OllamaClientError {
  code: OllamaErrorCode;
  messageVi: string;
  statusCode: number;
  details?: string;
}

export interface OllamaTagModel {
  name: string;
  model: string;
  size?: number;
  details?: {
    family?: string;
    families?: string[];
    parameter_size?: string;
  };
  capabilities?: string[];
}

export interface OllamaHealthResult {
  online: boolean;
  version?: string;
  installedModels: string[];
  hasChatModel: boolean;
  hasVisionModel: boolean;
  suggestedChatModel?: string;
  suggestedVisionModel?: string;
  error?: OllamaClientError;
}

// ---------------------------------------------------------------------------
// In-memory cache for /api/tags (30s TTL)
// ---------------------------------------------------------------------------
interface TagsCacheEntry {
  timestamp: number;
  models: OllamaTagModel[];
  online: boolean;
}

let tagsCache: TagsCacheEntry | null = null;
const TAGS_CACHE_TTL_MS = 30_000;

// ---------------------------------------------------------------------------
// Concurrency Limiter (Semaphore) — Max concurrent calls to Ollama
// ---------------------------------------------------------------------------
const MAX_CONCURRENT_OLLAMA_CALLS = 3;
const MAX_WAITING_QUEUE_LENGTH = 10;
let activeOllamaCalls = 0;
const waitingQueue: Array<() => void> = [];

export function getOllamaConcurrencyState(): { activeCalls: number; queueLength: number } {
  return { activeCalls: activeOllamaCalls, queueLength: waitingQueue.length };
}

export function _resetOllamaConcurrencyForTest(): void {
  activeOllamaCalls = 0;
  waitingQueue.length = 0;
}

async function acquireOllamaSlot(signal?: AbortSignal): Promise<() => void> {
  if (activeOllamaCalls < MAX_CONCURRENT_OLLAMA_CALLS) {
    activeOllamaCalls++;
    return () => releaseOllamaSlot();
  }

  // Reject immediately if the queue has reached capacity
  if (waitingQueue.length >= MAX_WAITING_QUEUE_LENGTH) {
    const err = new Error("Hệ thống AI đang quá tải với hàng đợi đầy. Vui lòng thử lại sau.");
    (err as unknown as { code: string; statusCode: number }).code = "OVERLOADED";
    (err as unknown as { code: string; statusCode: number }).statusCode = 429;
    throw err;
  }

  // Queue if busy
  return new Promise((resolve, reject) => {
    let handled = false;

    const onAbort = () => {
      if (handled) return;
      handled = true;
      const idx = waitingQueue.indexOf(proceed);
      if (idx !== -1) waitingQueue.splice(idx, 1);
      const err = new Error("Request aborted while waiting for Ollama concurrency slot");
      (err as unknown as { code: string; statusCode: number }).code = "CLIENT_ABORTED";
      (err as unknown as { code: string; statusCode: number }).statusCode = 499;
      reject(err);
    };

    if (signal?.aborted) {
      const err = new Error("Request already aborted");
      (err as unknown as { code: string; statusCode: number }).code = "CLIENT_ABORTED";
      (err as unknown as { code: string; statusCode: number }).statusCode = 499;
      reject(err);
      return;
    }

    signal?.addEventListener("abort", onAbort, { once: true });

    function proceed() {
      if (handled) return;
      handled = true;
      signal?.removeEventListener("abort", onAbort);
      activeOllamaCalls++;
      resolve(() => releaseOllamaSlot());
    }

    waitingQueue.push(proceed);
  });
}

function releaseOllamaSlot(): void {
  activeOllamaCalls = Math.max(0, activeOllamaCalls - 1);
  const next = waitingQueue.shift();
  if (next) {
    next();
  }
}

// ---------------------------------------------------------------------------
// Helper: Clean Base URL
// ---------------------------------------------------------------------------
export function getOllamaBaseUrl(overrideUrl?: string): string {
  const url = overrideUrl || process.env.OLLAMA_BASE_URL || DEFAULT_OLLAMA_BASE_URL;
  return url.trim().replace(/\/$/, "");
}

// ---------------------------------------------------------------------------
// Helper: Check Ollama Tags
// ---------------------------------------------------------------------------
export async function getInstalledModels(
  baseUrl: string,
  forceRefresh = false,
): Promise<{ online: boolean; models: OllamaTagModel[]; error?: OllamaClientError }> {
  const now = Date.now();
  if (!forceRefresh && tagsCache && now - tagsCache.timestamp < TAGS_CACHE_TTL_MS) {
    return { online: tagsCache.online, models: tagsCache.models };
  }

  try {
    const res = await fetch(`${baseUrl}/api/tags`, {
      method: "GET",
      signal: AbortSignal.timeout(4000),
    });

    if (!res.ok) {
      const err: OllamaClientError = {
        code: "ENDPOINT_UNREACHABLE",
        messageVi: `Không thể kết nối với dịch vụ AI tại ${baseUrl} (HTTP ${res.status}).`,
        statusCode: 502,
      };
      tagsCache = { timestamp: now, models: [], online: false };
      return { online: false, models: [], error: err };
    }

    const data = (await res.json()) as { models?: OllamaTagModel[] };
    const models = Array.isArray(data.models) ? data.models : [];
    tagsCache = { timestamp: now, models, online: true };
    return { online: true, models };
  } catch (err) {
    const isConnRefused =
      err instanceof Error &&
      (err.message.includes("ECONNREFUSED") ||
        err.message.includes("fetch failed") ||
        err.message.includes("connect"));

    const code: OllamaErrorCode = isConnRefused ? "OLLAMA_OFFLINE" : "TIMEOUT";
    const messageVi = isConnRefused
      ? "Dịch vụ AI nội bộ (Ollama) chưa khởi động. Vui lòng kiểm tra ứng dụng Ollama đang chạy trên máy chủ."
      : "Kiểm tra kết nối dịch vụ AI quá thời gian chờ.";

    const clientErr: OllamaClientError = {
      code,
      messageVi,
      statusCode: isConnRefused ? 503 : 504,
      details: err instanceof Error ? err.message : String(err),
    };

    tagsCache = { timestamp: now, models: [], online: false };
    return { online: false, models: [], error: clientErr };
  }
}

/**
 * Detailed Health Check for Ollama
 */
export async function checkOllamaHealth(customBaseUrl?: string): Promise<OllamaHealthResult> {
  const baseUrl = getOllamaBaseUrl(customBaseUrl);
  const { online, models, error } = await getInstalledModels(baseUrl, true);

  if (!online || error) {
    return {
      online: false,
      installedModels: [],
      hasChatModel: false,
      hasVisionModel: false,
      error: error || {
        code: "OLLAMA_OFFLINE",
        messageVi: "Dịch vụ AI nội bộ (Ollama) chưa khởi động.",
        statusCode: 503,
      },
    };
  }

  const installedNames = models.map((m) => m.name.toLowerCase());

  // Find chat model: Check user configured env -> default list -> any installed text model
  const envChat = (process.env.OLLAMA_CHAT_MODEL || "").trim().toLowerCase();
  let suggestedChatModel: string | undefined;

  if (envChat && installedNames.some((n) => n === envChat || n.startsWith(`${envChat}:`))) {
    suggestedChatModel = envChat;
  } else {
    for (const m of OLLAMA_TEXT_MODELS) {
      const match = installedNames.find((n) => n === m.toLowerCase() || n.startsWith(`${m.toLowerCase()}:`));
      if (match) {
        suggestedChatModel = match;
        break;
      }
    }
  }

  // If none of our preferred list matched, but there is ANY model installed (e.g. qwen2.5-coder:7b)
  if (!suggestedChatModel && models.length > 0) {
    suggestedChatModel = models[0].name;
  }

  // Find vision model
  const envVision = (process.env.OLLAMA_VISION_MODEL || "").trim().toLowerCase();
  let suggestedVisionModel: string | undefined;

  if (envVision && installedNames.some((n) => n === envVision || n.startsWith(`${envVision}:`))) {
    suggestedVisionModel = envVision;
  } else {
    for (const m of OLLAMA_VISION_MODELS) {
      const match = installedNames.find((n) => n === m.toLowerCase() || n.startsWith(`${m.toLowerCase()}:`));
      if (match) {
        suggestedVisionModel = match;
        break;
      }
    }
  }

  return {
    online: true,
    installedModels: models.map((m) => m.name),
    hasChatModel: Boolean(suggestedChatModel),
    hasVisionModel: Boolean(suggestedVisionModel),
    suggestedChatModel,
    suggestedVisionModel,
  };
}

// ---------------------------------------------------------------------------
// Select optimal model based on tags
// ---------------------------------------------------------------------------
export async function selectChatModel(
  baseUrl: string,
  preferredOverride?: string,
): Promise<{ model: string; error?: OllamaClientError }> {
  if (preferredOverride) {
    return { model: preferredOverride };
  }

  const { online, models, error } = await getInstalledModels(baseUrl);
  if (!online) {
    return {
      model: "",
      error: error || {
        code: "OLLAMA_OFFLINE",
        messageVi: "Dịch vụ AI nội bộ (Ollama) chưa khởi động.",
        statusCode: 503,
      },
    };
  }

  const installedNames = models.map((m) => m.name.toLowerCase());
  const envModel = (process.env.OLLAMA_CHAT_MODEL || "").trim();
  if (envModel) {
    const match = installedNames.find(
      (n) => n === envModel.toLowerCase() || n.startsWith(`${envModel.toLowerCase()}:`),
    );
    if (match) return { model: match };
  }

  for (const candidate of OLLAMA_TEXT_MODELS) {
    const match = installedNames.find(
      (n) => n === candidate.toLowerCase() || n.startsWith(`${candidate.toLowerCase()}:`),
    );
    if (match) return { model: match };
  }

  // Fallback: If user has ANY model installed (e.g. qwen2.5-coder:7b), use it!
  if (models.length > 0) {
    return { model: models[0].name };
  }

  const primary = OLLAMA_TEXT_MODELS[0];
  return {
    model: "",
    error: {
      code: "CHAT_MODEL_MISSING",
      messageVi: `Chưa cài đặt mô hình ngôn ngữ (${primary}). Vui lòng chạy lệnh: ollama pull ${primary}`,
      statusCode: 503,
    },
  };
}

export async function selectVisionModel(
  baseUrl: string,
  preferredOverride?: string,
): Promise<{ model: string; error?: OllamaClientError }> {
  if (preferredOverride) {
    return { model: preferredOverride };
  }

  const { online, models, error } = await getInstalledModels(baseUrl);
  if (!online) {
    return {
      model: "",
      error: error || {
        code: "OLLAMA_OFFLINE",
        messageVi: "Dịch vụ AI nội bộ (Ollama) chưa khởi động.",
        statusCode: 503,
      },
    };
  }

  const installedNames = models.map((m) => m.name.toLowerCase());
  const envModel = (process.env.OLLAMA_VISION_MODEL || "").trim();
  if (envModel) {
    const match = installedNames.find(
      (n) => n === envModel.toLowerCase() || n.startsWith(`${envModel.toLowerCase()}:`),
    );
    if (match) return { model: match };
  }

  for (const candidate of OLLAMA_VISION_MODELS) {
    const match = installedNames.find(
      (n) => n === candidate.toLowerCase() || n.startsWith(`${candidate.toLowerCase()}:`),
    );
    if (match) return { model: match };
  }

  const primary = OLLAMA_VISION_MODELS[0];
  return {
    model: "",
    error: {
      code: "VISION_MODEL_MISSING",
      messageVi: `Chưa cài đặt mô hình thị giác (${primary}). Vui lòng chạy lệnh: ollama pull ${primary} để đọc hóa đơn.`,
      statusCode: 503,
    },
  };
}

// ---------------------------------------------------------------------------
// Ollama Chat Call Interface
// ---------------------------------------------------------------------------
export interface OllamaChatOptions {
  baseUrl?: string;
  messages: Array<{ role: "system" | "user" | "assistant"; content: string }>;
  format?: "json";
  modelOverride?: string;
  totalTimeoutMs?: number; // Total deadline for the entire operation (default: 35s)
  signal?: AbortSignal;
  temperature?: number;
  numPredict?: number;
}

export interface OllamaChatResult {
  success: boolean;
  content?: string;
  modelUsed?: string;
  error?: OllamaClientError;
}

export async function executeOllamaChat(
  opts: OllamaChatOptions,
): Promise<OllamaChatResult> {
  if (opts.signal?.aborted) {
    return {
      success: false,
      error: {
        code: "TIMEOUT",
        messageVi: "Yêu cầu đã bị hủy bởi người dùng.",
        statusCode: 499,
      },
    };
  }

  const baseUrl = getOllamaBaseUrl(opts.baseUrl);
  const totalTimeout = opts.totalTimeoutMs || 35_000;
  const deadline = Date.now() + totalTimeout;

  // 1. Acquire concurrency slot
  let releaseSlot: (() => void) | null = null;
  try {
    releaseSlot = await acquireOllamaSlot(opts.signal);
  } catch (e: unknown) {
    const errCode = (e as { code?: string })?.code;
    const isAborted = opts.signal?.aborted || errCode === "CLIENT_ABORTED";
    const isOverloaded = errCode === "OVERLOADED";
    return {
      success: false,
      error: {
        code: isOverloaded ? "OVERLOADED" : (isAborted ? "TIMEOUT" : "OVERLOADED"),
        messageVi: isAborted
          ? "Yêu cầu đã bị hủy bởi người dùng."
          : (isOverloaded
            ? "Hệ thống AI đang quá tải với hàng đợi đầy. Vui lòng thử lại sau."
            : "Yêu cầu đã bị hủy hoặc hệ thống đang quá tải."),
        statusCode: isAborted ? 499 : 429,
        details: e instanceof Error ? e.message : String(e),
      },
    };
  }

  try {
    // 2. Resolve model
    const { model, error: modelErr } = await selectChatModel(baseUrl, opts.modelOverride);
    if (!model || modelErr) {
      return { success: false, error: modelErr };
    }

    // 3. Compute remaining timeout
    const remainingMs = deadline - Date.now();
    if (remainingMs <= 1000) {
      return {
        success: false,
        error: {
          code: "TIMEOUT",
          messageVi: "Quá thời gian chờ trước khi gửi yêu cầu đến mô hình AI.",
          statusCode: 504,
        },
      };
    }

    // 4. Combine signals
    const timeoutSignal = AbortSignal.timeout(remainingMs);
    const combinedSignal = opts.signal
      ? AbortSignal.any([opts.signal, timeoutSignal])
      : timeoutSignal;

    const requestPayload: Record<string, unknown> = {
      model,
      messages: opts.messages,
      stream: false,
      options: {
        temperature: opts.temperature ?? 0.7,
        num_predict: opts.numPredict ?? 1024,
      },
    };
    if (opts.format === "json") {
      requestPayload.format = "json";
    }

    const res = await fetch(`${baseUrl}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(requestPayload),
      signal: combinedSignal,
    });

    if (!res.ok) {
      const errText = await res.text().catch(() => "");
      if (res.status === 404 || errText.includes("not found")) {
        return {
          success: false,
          error: {
            code: "CHAT_MODEL_MISSING",
            messageVi: `Mô hình ${model} chưa được cài đặt trên Ollama. Chạy 'ollama pull ${model}' để cài đặt.`,
            statusCode: 503,
          },
        };
      }
      return {
        success: false,
        error: {
          code: "OVERLOADED",
          messageVi: `Lỗi máy chủ AI nội bộ (HTTP ${res.status}). Vui lòng thử lại.`,
          statusCode: res.status >= 500 ? 502 : res.status,
          details: errText.slice(0, 200),
        },
      };
    }

    const data = (await res.json()) as {
      message?: { content?: string };
      error?: string;
    };

    if (data.error) {
      return {
        success: false,
        error: {
          code: "OVERLOADED",
          messageVi: `Lỗi mô hình AI: ${data.error}`,
          statusCode: 502,
        },
      };
    }

    const content = data.message?.content?.trim();
    if (!content) {
      return {
        success: false,
        error: {
          code: "EMPTY_RESPONSE",
          messageVi: "Mô hình AI trả về phản hồi rỗng. Vui lòng thử lại.",
          statusCode: 502,
        },
      };
    }

    return {
      success: true,
      content,
      modelUsed: model,
    };
  } catch (err: unknown) {
    if (opts.signal?.aborted) {
      return {
        success: false,
        error: {
          code: "TIMEOUT",
          messageVi: "Yêu cầu đã bị hủy bởi người dùng.",
          statusCode: 499,
        },
      };
    }

    const isTimeout =
      err instanceof Error &&
      (err.name === "TimeoutError" || err.message.includes("timeout") || err.message.includes("aborted"));

    const isConnRefused =
      err instanceof Error &&
      (err.message.includes("ECONNREFUSED") || err.message.includes("fetch failed"));

    if (isTimeout) {
      return {
        success: false,
        error: {
          code: "TIMEOUT",
          messageVi: "Thời gian xử lý AI quá lâu (vượt quá giới hạn thời gian chờ). Vui lòng thử lại với nội dung ngắn hơn.",
          statusCode: 504,
        },
      };
    }

    if (isConnRefused) {
      return {
        success: false,
        error: {
          code: "OLLAMA_OFFLINE",
          messageVi: "Dịch vụ AI nội bộ (Ollama) chưa khởi động. Vui lòng kiểm tra dịch vụ Ollama đang chạy trên máy chủ.",
          statusCode: 503,
        },
      };
    }

    return {
      success: false,
      error: {
        code: "ENDPOINT_UNREACHABLE",
        messageVi: "Không thể kết nối với dịch vụ AI nội bộ. Vui lòng thử lại.",
        statusCode: 502,
        details: err instanceof Error ? err.message : String(err),
      },
    };
  } finally {
    if (releaseSlot) {
      releaseSlot();
    }
  }
}

// ---------------------------------------------------------------------------
// Ollama Vision / Generate Call Interface
// ---------------------------------------------------------------------------
export interface OllamaVisionOptions {
  baseUrl?: string;
  prompt: string;
  base64Images: string[]; // Pure base64 data strings without data:image prefix
  format?: "json";
  modelOverride?: string;
  totalTimeoutMs?: number; // Default 60s for vision
  signal?: AbortSignal;
}

export interface OllamaVisionResult {
  success: boolean;
  content?: string;
  modelUsed?: string;
  error?: OllamaClientError;
}

export async function executeOllamaVision(
  opts: OllamaVisionOptions,
): Promise<OllamaVisionResult> {
  if (opts.signal?.aborted) {
    return {
      success: false,
      error: {
        code: "TIMEOUT",
        messageVi: "Yêu cầu xử lý hóa đơn đã bị hủy.",
        statusCode: 499,
      },
    };
  }

  const baseUrl = getOllamaBaseUrl(opts.baseUrl);
  const totalTimeout = opts.totalTimeoutMs || 60_000;
  const deadline = Date.now() + totalTimeout;

  let releaseSlot: (() => void) | null = null;
  try {
    releaseSlot = await acquireOllamaSlot(opts.signal);
  } catch (e: unknown) {
    const errCode = (e as { code?: string })?.code;
    const isAborted = opts.signal?.aborted || errCode === "CLIENT_ABORTED";
    const isOverloaded = errCode === "OVERLOADED";
    return {
      success: false,
      error: {
        code: isOverloaded ? "OVERLOADED" : (isAborted ? "TIMEOUT" : "OVERLOADED"),
        messageVi: isAborted
          ? "Yêu cầu xử lý hóa đơn đã bị hủy."
          : (isOverloaded
            ? "Hệ thống AI đang quá tải với hàng đợi đầy. Vui lòng thử lại sau."
            : "Yêu cầu đã bị hủy hoặc hệ thống đang quá tải."),
        statusCode: isAborted ? 499 : 429,
        details: e instanceof Error ? e.message : String(e),
      },
    };
  }

  try {
    const { model, error: modelErr } = await selectVisionModel(baseUrl, opts.modelOverride);
    if (!model || modelErr) {
      return { success: false, error: modelErr };
    }

    const remainingMs = deadline - Date.now();
    if (remainingMs <= 1000) {
      return {
        success: false,
        error: {
          code: "TIMEOUT",
          messageVi: "Quá thời gian chờ trước khi gửi ảnh đến mô hình thị giác AI.",
          statusCode: 504,
        },
      };
    }

    const timeoutSignal = AbortSignal.timeout(remainingMs);
    const combinedSignal = opts.signal
      ? AbortSignal.any([opts.signal, timeoutSignal])
      : timeoutSignal;

    const requestPayload: Record<string, unknown> = {
      model,
      prompt: opts.prompt,
      images: opts.base64Images,
      stream: false,
      options: {
        temperature: 0.1,
        num_predict: 1024,
      },
    };
    if (opts.format === "json") {
      requestPayload.format = "json";
    }

    const res = await fetch(`${baseUrl}/api/generate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(requestPayload),
      signal: combinedSignal,
    });

    if (!res.ok) {
      const errText = await res.text().catch(() => "");
      if (res.status === 404 || errText.includes("not found")) {
        return {
          success: false,
          error: {
            code: "VISION_MODEL_MISSING",
            messageVi: `Mô hình thị giác ${model} chưa được cài đặt trên Ollama. Chạy 'ollama pull ${model}' để cài đặt.`,
            statusCode: 503,
          },
        };
      }
      if (errText.includes("does not support vision") || errText.includes("image")) {
        return {
          success: false,
          error: {
            code: "MODEL_UNSUPPORTED",
            messageVi: `Mô hình ${model} không hỗ trợ nhận diện hình ảnh. Vui lòng cài đặt mô hình thị giác: ollama pull llava:7b`,
            statusCode: 400,
          },
        };
      }
      return {
        success: false,
        error: {
          code: "OVERLOADED",
          messageVi: `Lỗi máy chủ thị giác AI (HTTP ${res.status}). Vui lòng thử lại.`,
          statusCode: res.status >= 500 ? 502 : res.status,
          details: errText.slice(0, 200),
        },
      };
    }

    const data = (await res.json()) as {
      response?: string;
      error?: string;
    };

    if (data.error) {
      if (data.error.includes("does not support vision")) {
        return {
          success: false,
          error: {
            code: "MODEL_UNSUPPORTED",
            messageVi: `Mô hình ${model} không hỗ trợ phân tích hình ảnh. Vui lòng cài đặt llava:7b.`,
            statusCode: 400,
          },
        };
      }
      return {
        success: false,
        error: {
          code: "OVERLOADED",
          messageVi: `Lỗi thị giác AI: ${data.error}`,
          statusCode: 502,
        },
      };
    }

    const content = data.response?.trim();
    if (!content) {
      return {
        success: false,
        error: {
          code: "EMPTY_RESPONSE",
          messageVi: "Mô hình AI không đọc được nội dung trên hóa đơn.",
          statusCode: 502,
        },
      };
    }

    return {
      success: true,
      content,
      modelUsed: model,
    };
  } catch (err: unknown) {
    if (opts.signal?.aborted) {
      return {
        success: false,
        error: {
          code: "TIMEOUT",
          messageVi: "Yêu cầu xử lý hóa đơn đã bị hủy.",
          statusCode: 499,
        },
      };
    }

    const isTimeout =
      err instanceof Error &&
      (err.name === "TimeoutError" || err.message.includes("timeout") || err.message.includes("aborted"));

    const isConnRefused =
      err instanceof Error &&
      (err.message.includes("ECONNREFUSED") || err.message.includes("fetch failed"));

    if (isTimeout) {
      return {
        success: false,
        error: {
          code: "TIMEOUT",
          messageVi: "Thời gian xử lý ảnh hóa đơn quá lâu. Vui lòng thử lại với ảnh nhỏ gọn hoặc rõ nét hơn.",
          statusCode: 504,
        },
      };
    }

    if (isConnRefused) {
      return {
        success: false,
        error: {
          code: "OLLAMA_OFFLINE",
          messageVi: "Dịch vụ AI nội bộ (Ollama) chưa khởi động. Vui lòng kiểm tra dịch vụ Ollama đang chạy trên máy chủ.",
          statusCode: 503,
        },
      };
    }

    return {
      success: false,
      error: {
        code: "ENDPOINT_UNREACHABLE",
        messageVi: "Không thể kết nối với dịch vụ AI thị giác. Vui lòng thử lại.",
        statusCode: 502,
        details: err instanceof Error ? err.message : String(err),
      },
    };
  } finally {
    if (releaseSlot) {
      releaseSlot();
    }
  }
}
