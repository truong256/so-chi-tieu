"use client";

import { FormEvent, useEffect, useRef, useState } from "react";
import { useAiChat } from "./ai-chat-context";
import type { FinancialContext } from "./ai-chat-context";
import { MessageContent } from "./ai-chat";

interface Props {
  view: string;
  financialContext: FinancialContext;
}

export default function AiFloatingChat({ view, financialContext }: Props) {
  const { 
    messages, 
    loading, 
    isOpen, 
    isMinimized, 
    toggleOpen, 
    toggleMinimize, 
    sendMessage, 
    stopGeneration 
  } = useAiChat();
  
  const [input, setInput] = useState("");
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Quick Actions Context Logic
  const getQuickActions = () => {
    switch (view) {
      case "budgets":
      case "planning":
        return [
          "Ngân sách nào gần hết?",
          "Phân tích ngân sách tháng này",
          "Tôi có đang vượt ngân sách không?"
        ];
      case "wallets":
        return [
          "Tổng số dư của tôi?",
          "Ví nào có số dư thấp nhất?",
          "Phân tích tiền khả dụng"
        ];
      case "transactions":
        return [
          "Phân tích giao dịch gần đây",
          "Tôi chi nhiều nhất vào đâu?",
          "Có giao dịch bất thường không?"
        ];
      case "recurring":
        return [
          "Tháng này có giao dịch định kỳ nào?",
          "Tổng tiền định kỳ còn lại là bao nhiêu?"
        ];
      case "reports":
        return [
          "Tóm tắt tình hình tài chính",
          "Chi tiêu tháng này so với tháng trước"
        ];
      default:
        return [
          "Tình hình tài chính hiện tại",
          "Tôi còn bao nhiêu tiền?",
          "Khoản chi lớn nhất",
          "Mục tiêu tiết kiệm"
        ];
    }
  };

  const quickActions = getQuickActions();

  // Scroll logic
  useEffect(() => {
    if (isOpen && !isMinimized) {
      messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
    }
  }, [messages, loading, isOpen, isMinimized]);

  // Focus input when opened
  useEffect(() => {
    if (isOpen && !isMinimized && textareaRef.current) {
      // Small timeout to allow transition
      setTimeout(() => textareaRef.current?.focus(), 300);
    }
  }, [isOpen, isMinimized]);

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!input.trim() || loading) return;
    const text = input;
    setInput("");
    void sendMessage(text, view, financialContext);
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      if (!input.trim() || loading) return;
      const text = input;
      setInput("");
      void sendMessage(text, view, financialContext);
    }
  }

  function handleQuickAction(action: string) {
    void sendMessage(action, view, financialContext);
  }

  const isEmpty = messages.length === 0;

  // Render nothing if it's the full-page view to avoid duplicate bots
  // (Optional: we can show it globally but hide if view === 'ai-assistant')
  if (view === "ai-assistant") return null;

  return (
    <>
      {/* Floating Action Button (Bubble) */}
      <button
        type="button"
        className={`ai-fab ${isOpen && !isMinimized ? "hidden" : ""}`}
        onClick={toggleOpen}
        aria-label="Mở trợ lý tài chính AI"
        title="Trợ lý tài chính AI"
      >
        <span className="ai-fab-icon">✦</span>
        {/* Optional Badge */}
        {/* <span className="ai-fab-badge">1</span> */}
      </button>

      {/* Floating Chat Panel */}
      <div className={`ai-floating-panel ${isOpen ? "open" : ""} ${isMinimized ? "minimized" : ""}`}>
        
        {/* Panel Header */}
        <div className="ai-floating-header">
          <div className="ai-floating-header-info" onClick={isMinimized ? toggleMinimize : undefined} style={{ cursor: isMinimized ? "pointer" : "default" }}>
            <span className="ai-floating-header-icon">✦</span>
            <div className="ai-floating-header-text">
              <h3>Trợ lý tài chính AI</h3>
            </div>
          </div>
          <div className="ai-floating-header-actions">
            <button type="button" onClick={toggleMinimize} aria-label="Thu nhỏ" title="Thu nhỏ">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <line x1="5" y1="12" x2="19" y2="12" />
              </svg>
            </button>
            <button type="button" onClick={toggleOpen} aria-label="Đóng" title="Đóng">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <line x1="18" y1="6" x2="6" y2="18" />
                <line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>
          </div>
        </div>

        {/* Panel Body (Hidden if minimized) */}
        {!isMinimized && (
          <>
            <div className="ai-floating-body">
              {isEmpty && (
                <div className="ai-welcome compact">
                  <div className="ai-welcome-icon compact">✦</div>
                  <p className="ai-welcome-title compact">
                    Xin chào! Tôi là Trợ lý tài chính AI.
                  </p>
                  <p className="ai-welcome-sub compact">
                    Tôi có thể giúp gì cho bạn tại trang này?
                  </p>
                  <div className="ai-quick-actions">
                    {quickActions.map((q, i) => (
                      <button
                        key={i}
                        type="button"
                        className="ai-quick-action-chip"
                        onClick={() => handleQuickAction(q)}
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
                  {msg.role === "ai" && <div className="ai-avatar">✦</div>}
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
                      <span /><span /><span />
                    </div>
                    <span className="ai-loading-label">Đang phân tích...</span>
                  </div>
                </div>
              )}

              <div ref={messagesEndRef} />
            </div>

            {/* Input Bar */}
            <div className="ai-input-container">
              {loading && (
                <div className="ai-stop-container">
                  <button type="button" className="ai-stop-btn" onClick={stopGeneration}>
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
                      <rect x="6" y="6" width="12" height="12" rx="2" />
                    </svg>
                    Dừng
                  </button>
                </div>
              )}
              <form className="ai-floating-input-bar" onSubmit={handleSubmit}>
                <textarea
                  ref={textareaRef}
                  className="ai-input-textarea"
                  value={input}
                  onChange={e => setInput(e.target.value)}
                  onKeyDown={handleKeyDown}
                  placeholder="Hỏi về chi tiêu... (Shift+Enter để xuống dòng)"
                  rows={1}
                  disabled={loading}
                  maxLength={2000}
                />
                <button
                  type="submit"
                  className="ai-send-btn"
                  disabled={loading || !input.trim()}
                  aria-label="Gửi"
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
          </>
        )}
      </div>
    </>
  );
}
