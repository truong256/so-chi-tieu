"use client";

import { FormEvent, useEffect, useRef, useState } from "react";
import { useAiChat, ChatMessage } from "./ai-chat-context";
import type { FinancialContext } from "./ai-chat-context-types";

// ─── Suggested questions ─────────────────────────────────────────────────────
const SUGGESTED_QUESTIONS = [
  "Tháng này tôi đã tiêu bao nhiêu?",
  "Danh mục nào tôi chi nhiều nhất?",
  "Tình hình ngân sách của tôi thế nào?",
  "Tôi có thể giảm khoản chi nào?",
  "Tôi còn bao nhiêu tiền?",
  "Tình hình tiết kiệm của tôi thế nào?",
];

interface Props {
  financialContext: FinancialContext;
}

// ─── Component ───────────────────────────────────────────────────────────────

export default function AiChatView({ financialContext }: Props) {
  const { messages, loading, sendMessage, clearMessages, stopGeneration } = useAiChat();
  const [input, setInput] = useState("");
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Auto-scroll to bottom when new messages arrive
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, loading]);

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!input.trim() || loading) return;
    const text = input;
    setInput("");
    void sendMessage(text, "ai-assistant", financialContext);
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      if (!input.trim() || loading) return;
      const text = input;
      setInput("");
      void sendMessage(text, "ai-assistant", financialContext);
    }
  }

  function handleSuggestion(q: string) {
    void sendMessage(q, "ai-assistant", financialContext);
  }

  const isEmpty = messages.length === 0;

  return (
    <div className="ai-chat-page">
      {/* ── Header ── */}
      <div className="ai-chat-header">
        <div className="ai-chat-header-icon">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 2a10 10 0 0 1 10 10c0 5.52-4.48 10-10 10S2 17.52 2 12 6.48 2 12 2z" />
            <path d="M8 12h.01M12 12h.01M16 12h.01" strokeWidth="2.5" />
          </svg>
        </div>
        <div className="ai-chat-header-text">
          <h2>Trợ lý tài chính AI</h2>
          <p>Phân tích chi tiêu và hỗ trợ quản lý tài chính cá nhân</p>
        </div>
        {messages.length > 0 && (
          <button
            type="button"
            className="ai-clear-btn"
            onClick={clearMessages}
            title="Xóa cuộc trò chuyện"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="3 6 5 6 21 6" />
              <path d="M19 6l-1 14H6L5 6" />
              <path d="M10 11v6M14 11v6" />
            </svg>
            Xóa chat
          </button>
        )}
      </div>

      {/* ── Messages area ── */}
      <div className="ai-messages-area">
        {isEmpty && (
          <div className="ai-welcome">
            <div className="ai-welcome-icon">✦</div>
            <p className="ai-welcome-title">Xin chào! Tôi có thể giúp bạn phân tích chi tiêu và quản lý tài chính cá nhân.</p>
            <p className="ai-welcome-sub">Chọn câu hỏi gợi ý hoặc nhập câu hỏi của bạn:</p>
            <div className="ai-suggestions">
              {SUGGESTED_QUESTIONS.map((q, i) => (
                <button
                  key={i}
                  type="button"
                  className="ai-suggestion-chip"
                  onClick={() => handleSuggestion(q)}
                  disabled={loading}
                >
                  {q}
                </button>
              ))}
            </div>
          </div>
        )}

        {messages.map(msg => (
          <div key={msg.id} className={`ai-message-row ${msg.role}`}>
            {msg.role === "ai" && (
              <div className="ai-avatar">✦</div>
            )}
            <div className={`ai-bubble ${msg.role} ${msg.isError ? "error" : ""}`}>
              <MessageContent text={msg.text} />
            </div>
          </div>
        ))}

        {loading && (
          <div className="ai-message-row ai">
            <div className="ai-avatar ai-avatar-pulse">✦</div>
            <div className="ai-bubble ai">
              <div className="ai-loading-dots">
                <span />
                <span />
                <span />
              </div>
              <span className="ai-loading-label">Trợ lý AI đang phân tích...</span>
            </div>
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* ── Input bar ── */}
      <div className="ai-input-container">
        {loading && (
          <div className="ai-stop-container">
            <button type="button" className="ai-stop-btn" onClick={stopGeneration}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
                <rect x="6" y="6" width="12" height="12" rx="2" />
              </svg>
              Dừng phản hồi
            </button>
          </div>
        )}
        <form className="ai-input-bar" onSubmit={handleSubmit}>
          <textarea
            ref={textareaRef}
            className="ai-input-textarea"
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Hỏi về chi tiêu của bạn... (Enter để gửi, Shift+Enter để xuống dòng)"
            rows={1}
            disabled={loading}
            maxLength={2000}
          />
          <button
            type="submit"
            className="ai-send-btn"
            disabled={loading || !input.trim()}
            aria-label="Gửi câu hỏi"
          >
            {loading ? (
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="ai-spin">
                <path d="M21 12a9 9 0 1 1-6.219-8.56" />
              </svg>
            ) : (
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <line x1="22" y1="2" x2="11" y2="13" />
                <polygon points="22 2 15 22 11 13 2 9 22 2" />
              </svg>
            )}
          </button>
        </form>
      </div>
    </div>
  );
}

// ─── MessageContent ──────────────────────────────────────────────────────────

export function MessageContent({ text }: { text: string }) {
  const lines = text.split("\n");

  return (
    <div className="ai-message-content">
      {lines.map((line, i) => {
        if (!line.trim()) return <br key={i} />;

        const isBullet = /^[-•*]\s/.test(line);
        const isNumbered = /^\d+\.\s/.test(line);

        const rendered = renderInline(line);

        if (isBullet || isNumbered) {
          return <div key={i} className="ai-list-item">{rendered}</div>;
        }
        return <div key={i}>{rendered}</div>;
      })}
    </div>
  );
}

function renderInline(text: string): React.ReactNode {
  const parts = text.split(/(\*\*[^*]+\*\*)/g);
  return parts.map((part, i) => {
    if (part.startsWith("**") && part.endsWith("**")) {
      return <strong key={i}>{part.slice(2, -2)}</strong>;
    }
    return <span key={i}>{part}</span>;
  });
}
