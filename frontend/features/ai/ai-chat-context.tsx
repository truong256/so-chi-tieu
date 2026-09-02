"use client";

import { createContext, ReactNode, useCallback, useContext, useEffect, useRef, useState } from "react";
import { createClient } from "@/config/supabase";
import type { Budget, SavingsGoal, Transaction, Wallet } from "@/frontend/types/finance.types";

// --- Types ---

export interface FinancialContext {
  totalBalance: number;
  monthlyIncome: number;
  monthlyExpense: number;
  wallets: Wallet[];
  transactions: Transaction[];
  budgets: Budget[];
  savingsGoals: SavingsGoal[];
}

export interface ChatMessage {
  id: string;
  role: "user" | "ai";
  text: string;
  isError?: boolean;
}

export interface GeminiHistoryMessage {
  role: "user" | "model";
  parts: Array<{ text: string }>;
}

interface AiChatContextValue {
  messages: ChatMessage[];
  loading: boolean;
  isOpen: boolean; // For floating bubble
  isMinimized: boolean; // For floating bubble
  toggleOpen: () => void;
  toggleMinimize: () => void;
  sendMessage: (text: string, currentPage: string, financialContext: FinancialContext) => Promise<void>;
  stopGeneration: () => void;
  clearMessages: () => void;
}

// --- Context ---

const AiChatContext = createContext<AiChatContextValue | undefined>(undefined);

export function useAiChat() {
  const context = useContext(AiChatContext);
  if (!context) {
    throw new Error("useAiChat must be used within an AiChatProvider");
  }
  return context;
}

// --- Provider ---

function uid(): string {
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}

export function AiChatProvider({ children }: { children: ReactNode }) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [loading, setLoading] = useState(false);
  const [isOpen, setIsOpen] = useState(false);
  const [isMinimized, setIsMinimized] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const inFlightRef = useRef(false);

  useEffect(() => () => abortRef.current?.abort(), []);

  const toggleOpen = useCallback(() => {
    setIsOpen(prev => {
      const next = !prev;
      if (next && isMinimized) setIsMinimized(false);
      return next;
    });
  }, [isMinimized]);

  const toggleMinimize = useCallback(() => {
    setIsMinimized(prev => !prev);
  }, []);

  const clearMessages = useCallback(() => {
    setMessages([]);
    abortRef.current?.abort();
    abortRef.current = null;
    inFlightRef.current = false;
    setLoading(false);
  }, []);

  const stopGeneration = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    inFlightRef.current = false;
    setLoading(false);
  }, []);

  const sendMessage = useCallback(async (text: string, currentPage: string, financialContext: FinancialContext) => {
    const trimmed = text.trim();
    if (!trimmed || inFlightRef.current) return;
    inFlightRef.current = true;

    // Expand the bubble if it's minimized when user sends a message via quick action
    if (isMinimized) setIsMinimized(false);
    if (!isOpen) setIsOpen(true);

    const userMsg: ChatMessage = { id: uid(), role: "user", text: trimmed };
    setMessages(prev => [...prev, userMsg]);
    setLoading(true);

    const historyForApi: GeminiHistoryMessage[] = messages
      .filter(m => !m.isError)
      .map(m => ({
        role: m.role === "user" ? "user" : "model",
        parts: [{ text: m.text }],
      }));
    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const supabase = createClient();
      const { data: sessionData } = await supabase.auth.getSession();
      const accessToken = sessionData?.session?.access_token ?? "";
      if (!accessToken) throw new Error("Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại.");

      const response = await fetch("/api/chat", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${accessToken}`,
        },
        body: JSON.stringify({
          message: trimmed,
          history: historyForApi,
          financialContext,
          currentPage,
          clientTime: new Date().toISOString()
        }),
        signal: controller.signal,
      });

      const raw = await response.text();
      let data: { reply?: string; error?: string } = {};
      try {
        data = JSON.parse(raw) as { reply?: string; error?: string };
      } catch {
        throw new Error("Máy chủ trả về phản hồi không hợp lệ.");
      }

      if (!response.ok || data.error) {
        throw new Error(data.error ?? "Lỗi không xác định");
      }

      const aiMsg: ChatMessage = {
        id: uid(),
        role: "ai",
        text: data.reply ?? "Không có phản hồi.",
      };
      setMessages(prev => [...prev, aiMsg]);

    } catch (err) {
      if (err instanceof Error && err.name === "AbortError") {
        return; // User intentionally stopped
      }

      const errText = err instanceof Error ? err.message : "Lỗi không xác định";
      
      let uiErrorMsg = errText;
      if (errText.includes("Failed to fetch") || errText.includes("NetworkError")) {
        uiErrorMsg = "Mất kết nối mạng. Vui lòng kiểm tra lại đường truyền.";
      } else if (errText.includes("thời gian")) {
        uiErrorMsg = "Phản hồi đang mất nhiều thời gian hơn dự kiến. Vui lòng thử lại.";
      } else if (!uiErrorMsg || uiErrorMsg === "Lỗi không xác định") {
        uiErrorMsg = "Không thể kết nối với Trợ lý AI. Vui lòng thử lại.";
      }

      const errorMsg: ChatMessage = {
        id: uid(),
        role: "ai",
        text: uiErrorMsg,
        isError: true,
      };
      setMessages(prev => [...prev, errorMsg]);
    } finally {
      if (abortRef.current === controller) {
        abortRef.current = null;
        inFlightRef.current = false;
        setLoading(false);
      }
    }
  }, [messages, isMinimized, isOpen]);

  return (
    <AiChatContext.Provider
      value={{
        messages,
        loading,
        isOpen,
        isMinimized,
        toggleOpen,
        toggleMinimize,
        sendMessage,
        stopGeneration,
        clearMessages
      }}
    >
      {children}
    </AiChatContext.Provider>
  );
}
