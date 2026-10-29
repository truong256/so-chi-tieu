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
  "qwen2.5-coder:7b",  // Primary: fine-tuned / verified local financial model
  "qwen2.5:3b",        // Fallback: fast multilingual (Vietnamese)
  "llama3.2:3b",       // Fallback: fast, good Vietnamese support
  "llama3.2:1b",       // Fallback: smaller/faster
  "mistral:7b",        // Fallback: larger but more capable
];

/** Vision models — used by AI Receipt Parser (OCR + extraction). */
export const OLLAMA_VISION_MODELS = [
  "llava",                 // Primary: standard Ollama tag
  "llava:7b",              // Explicit 7b tag
  "llava:13b",             // Fallback: more capable
  "llama3.2-vision:11b",   // Multimodal vision fallback
  "moondream",             // Lightweight fast vision model
  "moondream:latest",      // Direct latest tag
];

/** Default Ollama base URL (can be overridden via env). */
export const DEFAULT_OLLAMA_BASE_URL = "http://127.0.0.1:11434";
