"use client";

import { FormEvent, useEffect, useRef, useState } from "react";
import { useAiChat } from "./ai-chat-context";
import type { FinancialContext } from "./ai-chat-context";
import AiMessageContent from "./ai-message-content";

// ─── Suggested questions ─────────────────────────────────────────────────────
const SUGGESTED_QUESTIONS = [
  "Tháng này tôi đã chi bao nhiêu?",
  "Danh mục nào tôi chi nhiều nhất?",
  "Tình hình ngân sách của tôi thế nào?",
  "Tôi còn bao nhiêu tiền trong các ví?",
  "Tôi có thể chi thêm 250k mà không vượt ngân sách không?",
  "Khoản chi lớn nhất gần đây là gì?",
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
        <div className="ai-chat-header-text">
          <h2>Hỏi trợ lý chi tiêu</h2>
          <p>Đặt câu hỏi bằng tiếng Việt về thu chi và cách sử dụng ứng dụng</p>
        </div>
        {messages.length > 0 && (
          <button
            type="button"
            className="ai-clear-btn"
            onClick={clearMessages}
            title="Xóa toàn bộ cuộc trò chuyện"
          >
            Xóa cuộc trò chuyện
          </button>
        )}
      </div>

      {/* ── Messages area ── */}
      <div className="ai-messages-area">
        {isEmpty && (
          <div className="ai-welcome">
            <p className="ai-welcome-title">Xin chào! Tôi là Trợ lý chi tiêu của bạn.</p>
            <p className="ai-welcome-sub">Hệ thống hỗ trợ tra cứu thu chi, số dư ví và ngân sách theo dữ liệu thực tế của bạn. Chọn câu hỏi gợi ý hoặc nhập câu hỏi bên dưới:</p>
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
              <div className="ai-avatar" title="Trợ lý chi tiêu" style={{ fontSize: "11px", fontWeight: 700 }}>Trợ lý</div>
            )}
            <div className={`ai-bubble ${msg.role} ${msg.isError ? "error" : ""}`}>
              <AiMessageContent text={msg.text} />
            </div>
          </div>
        ))}

        {loading && (
          <div className="ai-message-row ai">
            <div className="ai-avatar ai-avatar-pulse" title="Trợ lý chi tiêu" style={{ fontSize: "11px", fontWeight: 700 }}>Trợ lý</div>
            <div className="ai-bubble ai">
              <div className="ai-loading-dots">
                <span />
                <span />
                <span />
              </div>
              <span className="ai-loading-label">Trợ lý đang phân tích dữ liệu...</span>
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
            placeholder="Đặt câu hỏi về chi tiêu của bạn... (Nhấn Enter để gửi, Shift+Enter để xuống dòng)"
            rows={1}
            disabled={loading}
            maxLength={2000}
          />
          <button
            type="submit"
            className="ai-send-btn"
            disabled={loading || !input.trim()}
            aria-label="Gửi câu hỏi"
            style={{ fontWeight: 700, fontSize: "13px", padding: "0 16px" }}
          >
            {loading ? "..." : "Gửi câu hỏi"}
          </button>
        </form>
      </div>
    </div>
  );
}
