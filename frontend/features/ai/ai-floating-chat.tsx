"use client";

import { FormEvent, useEffect, useRef, useState } from "react";
import { useAiChat } from "./ai-chat-context";
import type { FinancialContext } from "./ai-chat-context";
import AiMessageContent from "./ai-message-content";
import AiActionConfirmCard from "./ai-action-confirm-card";

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
    confirmAction,
    cancelAction,
    stopGeneration,
  } = useAiChat();

  const [input, setInput] = useState("");
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const getQuickActions = () => {
    switch (view) {
      case "budgets":
      case "planning":
        return [
          "Ngân sách nào gần hết?",
          "Tạo ngân sách Ăn uống 3 triệu mỗi tháng",
          "Tôi có đang vượt ngân sách không?",
        ];
      case "categories":
        return [
          "Tạo danh mục chi tiêu Thú cưng",
          "Tạo danh mục thu nhập Cổ tức",
        ];
      case "wallets":
        return [
          "Tổng số dư của tôi?",
          "Ví nào có số dư thấp nhất?",
          "Phân tích tiền khả dụng",
        ];
      case "transactions":
        return [
          "Phân tích giao dịch gần đây",
          "Tôi chi nhiều nhất vào đâu?",
          "Ghi khoản chi ăn trưa 50k",
        ];
      case "recurring":
        return [
          "Tháng này có giao dịch định kỳ nào?",
          "Tạo giao dịch định kỳ tiền Internet 250k hàng tháng",
        ];
      case "reports":
        return [
          "Tóm tắt tình hình tài chính",
          "Chi tiêu tháng này so với tháng trước",
        ];
      default:
        return [
          "Tình hình tài chính hiện tại",
          "Tôi còn bao nhiêu tiền?",
          "Tạo ngân sách Ăn uống 3 triệu mỗi tháng",
          "Mục tiêu tiết kiệm",
        ];
    }
  };

  const quickActions = getQuickActions();

  useEffect(() => {
    if (isOpen && !isMinimized) {
      messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
    }
  }, [messages, loading, isOpen, isMinimized]);

  useEffect(() => {
    if (isOpen && !isMinimized && textareaRef.current) {
      const focusTimer = window.setTimeout(() => textareaRef.current?.focus(), 300);
      return () => window.clearTimeout(focusTimer);
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

  if (view === "ai-assistant") return null;

  return (
    <>
      <button
        type="button"
        className={`ai-fab ${isOpen && !isMinimized ? "hidden" : ""}`}
        onClick={toggleOpen}
        aria-label="Hỏi trợ lý chi tiêu"
        title="Hỏi trợ lý chi tiêu"
      >
        <span className="ai-fab-icon" style={{ fontWeight: 700, fontSize: "13px" }}>💬</span>
      </button>

      <div className={`ai-floating-panel ${isOpen ? "open" : ""} ${isMinimized ? "minimized" : ""}`}>
        <div className="ai-floating-header">
          <div
            className="ai-floating-header-info"
            onClick={isMinimized ? toggleMinimize : undefined}
            style={{ cursor: isMinimized ? "pointer" : "default" }}
          >
            <div className="ai-floating-header-text">
              <h3>Hỏi trợ lý chi tiêu</h3>
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

        {!isMinimized && (
          <>
            <div className="ai-floating-body">
              {isEmpty && (
                <div className="ai-welcome compact">
                  <p className="ai-welcome-title compact">
                    Xin chào! Tôi là Trợ lý chi tiêu.
                  </p>
                  <p className="ai-welcome-sub compact">
                    Bạn có thể đặt câu hỏi hoặc yêu cầu tạo danh mục, ngân sách, giao dịch:
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
                  {msg.role === "ai" && <div className="ai-avatar" style={{ fontSize: "10px", fontWeight: 700 }}>Trợ lý</div>}
                  <div className={`ai-bubble ${msg.role} ${msg.isError ? "error" : ""}`}>
                    <AiMessageContent text={msg.text} />
                    {msg.pendingAction && (
                      <AiActionConfirmCard
                        messageId={msg.id}
                        action={msg.pendingAction}
                        onConfirm={id => void confirmAction(id)}
                        onCancel={id => void cancelAction(id)}
                      />
                    )}
                  </div>
                </div>
              ))}

              {loading && (
                <div className="ai-message-row ai">
                  <div className="ai-avatar ai-avatar-pulse" style={{ fontSize: "10px", fontWeight: 700 }}>Trợ lý</div>
                  <div className="ai-bubble ai">
                    <div className="ai-loading-dots">
                      <span /><span /><span />
                    </div>
                    <span className="ai-loading-label">Đang phân tích dữ liệu...</span>
                  </div>
                </div>
              )}

              <div ref={messagesEndRef} />
            </div>

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
                  placeholder="Hỏi thu chi hoặc tạo ngân sách, giao dịch..."
                  rows={1}
                  disabled={loading}
                  maxLength={2000}
                />
                <button
                  type="submit"
                  className="ai-send-btn"
                  disabled={loading || !input.trim()}
                  aria-label="Gửi câu hỏi"
                  style={{ fontWeight: 700, fontSize: "12px", padding: "0 12px" }}
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
