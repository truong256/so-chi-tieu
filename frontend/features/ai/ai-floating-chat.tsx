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
        <span className="ai-fab-icon" style={{ fontWeight: 700, fontSize: "14px" }}>AI</span>
      </button>

      {/* Floating Chat Panel */}
      <div className={`ai-floating-panel ${isOpen ? "open" : ""} ${isMinimized ? "minimized" : ""}`}>
        
        {/* Panel Header */}
        <div className="ai-floating-header">
          <div className="ai-floating-header-info" onClick={isMinimized ? toggleMinimize : undefined} style={{ cursor: isMinimized ? "pointer" : "default" }}>
            <div className="ai-floating-header-text">
              <h3>Trợ lý tài chính AI</h3>
            </div>
          </div>
          <div className="ai-floating-header-actions">
            <button type="button" onClick={toggleMinimize} aria-label="Thu nhỏ" title="Thu nhỏ" style={{ fontSize: "16px", fontWeight: 700 }}>
              −
            </button>
            <button type="button" onClick={toggleOpen} aria-label="Đóng" title="Đóng" style={{ fontSize: "16px", fontWeight: 700 }}>
              ×
            </button>
          </div>
        </div>

        {/* Panel Body (Hidden if minimized) */}
        {!isMinimized && (
          <>
            <div className="ai-floating-body">
              {isEmpty && (
                <div className="ai-welcome compact">
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
                  {msg.role === "ai" && <div className="ai-avatar">AI</div>}
                  <div className={`ai-bubble ${msg.role} ${msg.isError ? "error" : ""}`}>
                    <MessageContent text={msg.text} />
                  </div>
                </div>
              ))}

              {loading && (
                <div className="ai-message-row ai">
                  <div className="ai-avatar ai-avatar-pulse">AI</div>
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
                  style={{ fontWeight: 700, fontSize: "12px" }}
                >
                  {loading ? "..." : "Gửi"}
                </button>
              </form>
            </div>
          </>
        )}
      </div>
    </>
  );
}
