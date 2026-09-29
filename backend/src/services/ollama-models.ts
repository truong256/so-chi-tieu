/**
 * Local AI model configuration for Ollama.
 *
 * These model names correspond to models pulled/available in your Ollama instance.
 * The first model in each list is the preferred/primary model.
 * Subsequent models are fallbacks tried in order if the primary is unavailable.
 *
 * Pull models with: ollama pull <model_name>
 */

/** Text/chat models — used by AI Chat (Financial Copilot) and NLP Transaction Parser. */
export const OLLAMA_TEXT_MODELS = [
  "llama3.2:3b",       // Primary: fast, good Vietnamese support
  "llama3.2:1b",       // Fallback: smaller/faster
  "qwen2.5:3b",        // Fallback: strong multilingual (Vietnamese)
  "qwen2.5-coder:7b",  // Installed developer/coder local model
  "mistral:7b",        // Fallback: larger but more capable
];

/** Vision models — used by AI Receipt Parser (OCR + extraction). */
export const OLLAMA_VISION_MODELS = [
  "llava:7b",              // Primary vision model with image understanding
  "llava:13b",             // Fallback: more capable
  "llama3.2-vision:11b",   // Multimodal vision fallback
  "moondream",             // Fallback: lightweight vision model
];

/** Default Ollama base URL (can be overridden via env). */
export const DEFAULT_OLLAMA_BASE_URL = "http://127.0.0.1:11434";
