"use client";

import { createContext, ReactNode, useCallback, useContext, useEffect, useRef, useState } from "react";
import { createClient } from "@/config/supabase";
import type { Budget, SavingsGoal, Transaction, Wallet } from "@/frontend/types/finance.types";
import type {
  ExecutedCrudActionResult,
  PendingCrudActionProposal,
  RefreshTarget,
} from "@/backend/src/types/ai.types";

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

export type ActionCardStatus =
  | "pending"
  | "confirming"
  | "confirmed"
  | "cancelled"
  | "failed";

export interface UiPendingActionState extends PendingCrudActionProposal {
  status: ActionCardStatus;
  feedbackText?: string;
}

export interface ChatMessage {
  id: string;
  role: "user" | "ai";
  text: string;
  isError?: boolean;
  pendingAction?: UiPendingActionState;
  executedAction?: ExecutedCrudActionResult;
}

export interface AiHistoryMessage {
  role: "user" | "model";
  parts: Array<{ text: string }>;
}

interface AiChatContextValue {
  messages: ChatMessage[];
  loading: boolean;
  isOpen: boolean;
  isMinimized: boolean;
  toggleOpen: () => void;
  toggleMinimize: () => void;
  sendMessage: (text: string, currentPage: string, financialContext: FinancialContext) => Promise<void>;
  confirmAction: (messageId: string) => Promise<void>;
  cancelAction: (messageId: string) => Promise<void>;
  stopGeneration: () => void;
  clearMessages: () => void;
}

interface AiChatProviderProps {
  children: ReactNode;
  onDataMutated?: (targets?: RefreshTarget[]) => void | Promise<void>;
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

export function AiChatProvider({ children, onDataMutated }: AiChatProviderProps) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [loading, setLoading] = useState(false);
  const [isOpen, setIsOpen] = useState(false);
  const [isMinimized, setIsMinimized] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const inFlightRef = useRef(false);
  const onDataMutatedRef = useRef(onDataMutated);

  useEffect(() => {
    onDataMutatedRef.current = onDataMutated;
  }, [onDataMutated]);

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

  const triggerDataRefresh = useCallback(async (targets?: RefreshTarget[]) => {
    if (onDataMutatedRef.current) {
      try {
        await onDataMutatedRef.current(targets);
      } catch (refreshErr) {
        console.warn("Failed to refresh UI after AI CRUD action:", refreshErr);
      }
    }
  }, []);

  const confirmAction = useCallback(async (messageId: string) => {
    const targetMsg = messages.find(m => m.id === messageId);
    const pending = targetMsg?.pendingAction;
    if (!pending || pending.status === "confirming" || pending.status === "confirmed") {
      return;
    }

    setMessages(prev =>
      prev.map(m =>
        m.id === messageId && m.pendingAction
          ? {
              ...m,
              pendingAction: { ...m.pendingAction, status: "confirming", feedbackText: undefined },
            }
          : m,
      ),
    );

    try {
      const supabase = createClient();
      const { data: sessionData } = await supabase.auth.getSession();
      const accessToken = sessionData?.session?.access_token ?? "";
      if (!accessToken) {
        throw new Error("Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại.");
      }

      const response = await fetch("/api/chat/execute-action", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify({
          actionId: pending.actionId,
          idempotencyKey: pending.idempotencyKey,
          actionType: pending.actionType,
          payload: pending.payload,
        }),
      });

      const data = (await response.json()) as {
        success?: boolean;
        reply?: string;
        error?: string;
        executedAction?: ExecutedCrudActionResult;
      };

      if (!response.ok || !data.success) {
        throw new Error(data.error || data.reply || "Không thể lưu dữ liệu vào hệ thống.");
      }

      setMessages(prev => [
        ...prev.map(m =>
          m.id === messageId && m.pendingAction
            ? {
                ...m,
                pendingAction: {
                  ...m.pendingAction,
                  status: "confirmed" as const,
                  feedbackText: "Đã xác nhận và lưu vào cơ sở dữ liệu.",
                },
              }
            : m,
        ),
        {
          id: uid(),
          role: "ai",
          text: data.reply || "Đã thực hiện thao tác thành công.",
          executedAction: data.executedAction,
        },
      ]);

      await triggerDataRefresh(data.executedAction?.refreshTargets);
    } catch (err) {
      const errText = err instanceof Error ? err.message : "Lỗi kết nối khi thực hiện thao tác.";
      setMessages(prev =>
        prev.map(m =>
          m.id === messageId && m.pendingAction
            ? {
                ...m,
                pendingAction: {
                  ...m.pendingAction,
                  status: "failed",
                  feedbackText: errText,
                },
              }
            : m,
        ),
      );
    }
  }, [messages, triggerDataRefresh]);

  const cancelAction = useCallback(async (messageId: string) => {
    const targetMsg = messages.find(m => m.id === messageId);
    const pending = targetMsg?.pendingAction;
    if (!pending || pending.status === "confirming" || pending.status === "confirmed") {
      return;
    }

    setMessages(prev =>
      prev.map(m =>
        m.id === messageId && m.pendingAction
          ? {
              ...m,
              pendingAction: {
                ...m.pendingAction,
                status: "cancelled",
                feedbackText: "Đã hủy thao tác. Dữ liệu không bị thay đổi.",
              },
            }
          : m,
      ),
    );

    try {
      const supabase = createClient();
      const { data: sessionData } = await supabase.auth.getSession();
      const accessToken = sessionData?.session?.access_token ?? "";
      if (accessToken) {
        await fetch("/api/chat/execute-action", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${accessToken}`,
          },
          body: JSON.stringify({
            actionId: pending.actionId,
            idempotencyKey: `cancel_${pending.idempotencyKey}`,
            cancel: true,
          }),
        });
      }
    } catch {
      // Ignore background cancel network error since UI already cancelled locally
    }
  }, [messages]);

  const sendMessage = useCallback(async (text: string, currentPage: string, financialContext: FinancialContext) => {
    const trimmed = text.trim();
    if (!trimmed || inFlightRef.current) return;

    // If the latest AI message has an active pendingAction and user replies with a short confirm/cancel command,
    // execute directly via confirmAction/cancelAction so HMR reloads or stateless Worker hops never lose the payload.
    const latestPendingMsg = [...messages].reverse().find(m => m.role === "ai" && m.pendingAction?.status === "pending");
    if (latestPendingMsg && trimmed.length <= 40) {
      const normCmd = trimmed.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/đ/g, "d").trim();
      const isDirectConfirm = /^(xac nhan|dong y|ok|oke|okay|luu|luu di|thuc hien|tao di|chot|duyet|yes|confirm)([.!\s].*)?$/.test(normCmd);
      const isDirectCancel = /^(huy|huy bo|khong luu|dung tao|thoi|bo qua|cancel)([.!\s].*)?$/.test(normCmd);
      if (isDirectConfirm) {
        setMessages(prev => [...prev, { id: uid(), role: "user", text: trimmed }]);
        await confirmAction(latestPendingMsg.id);
        return;
      }
      if (isDirectCancel) {
        setMessages(prev => [...prev, { id: uid(), role: "user", text: trimmed }]);
        await cancelAction(latestPendingMsg.id);
        return;
      }
    }

    inFlightRef.current = true;

    if (isMinimized) setIsMinimized(false);
    if (!isOpen) setIsOpen(true);

    const userMsg: ChatMessage = { id: uid(), role: "user", text: trimmed };
    setMessages(prev => [...prev, userMsg]);
    setLoading(true);

    const historyForApi: AiHistoryMessage[] = messages
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
          "Accept": "text/event-stream, application/json",
        },
        body: JSON.stringify({
          message: trimmed,
          history: historyForApi,
          financialContext,
          currentPage,
          clientTime: new Date().toISOString(),
          stream: true,
        }),
        signal: controller.signal,
      });

      const contentType = response.headers.get("content-type") || "";
      let streamExecutedAction: ExecutedCrudActionResult | undefined;

      if (contentType.includes("text/event-stream") && response.body) {
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        const aiMsgId = uid();
        let accumulatedText = "";
        let isMessageAdded = false;
        let receivedPendingAction: UiPendingActionState | undefined;

        let buffer = "";
        while (true) {
          const { value, done } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n");
          buffer = lines.pop() || "";

          for (const line of lines) {
            const trimmedLine = line.trim();
            if (!trimmedLine || trimmedLine.startsWith(":")) continue;

            if (trimmedLine.startsWith("data:")) {
              const dataStr = trimmedLine.slice(5).trim();
              if (dataStr === "[DONE]") continue;

              try {
                const dataObj = JSON.parse(dataStr) as {
                  error?: string;
                  token?: string;
                  pendingAction?: PendingCrudActionProposal;
                  executedAction?: ExecutedCrudActionResult;
                };
                if (dataObj.error) {
                  throw new Error(dataObj.error);
                }
                if (dataObj.pendingAction) {
                  receivedPendingAction = {
                    ...dataObj.pendingAction,
                    status: "pending",
                  };
                }
                if (dataObj.executedAction) {
                  streamExecutedAction = dataObj.executedAction;
                }
                if (dataObj.token || dataObj.pendingAction || dataObj.executedAction) {
                  if (dataObj.token) {
                    accumulatedText += dataObj.token;
                  }
                  if (!isMessageAdded) {
                    isMessageAdded = true;
                    setMessages(prev => [
                      ...prev.map(m =>
                        streamExecutedAction &&
                        m.pendingAction?.actionId === streamExecutedAction.actionId
                          ? {
                              ...m,
                              pendingAction: {
                                ...m.pendingAction,
                                status: "confirmed" as const,
                                feedbackText: "Đã xác nhận qua hội thoại.",
                              },
                            }
                          : m,
                      ),
                      {
                        id: aiMsgId,
                        role: "ai",
                        text: accumulatedText,
                        pendingAction: receivedPendingAction,
                        executedAction: streamExecutedAction,
                      },
                    ]);
                  } else {
                    setMessages(prev =>
                      prev.map(m => {
                        if (
                          streamExecutedAction &&
                          m.pendingAction?.actionId === streamExecutedAction.actionId
                        ) {
                          return {
                            ...m,
                            pendingAction: {
                              ...m.pendingAction,
                              status: "confirmed" as const,
                              feedbackText: "Đã xác nhận qua hội thoại.",
                            },
                          };
                        }
                        if (m.id === aiMsgId) {
                          return {
                            ...m,
                            text: accumulatedText,
                            pendingAction: receivedPendingAction ?? m.pendingAction,
                            executedAction: streamExecutedAction ?? m.executedAction,
                          };
                        }
                        return m;
                      }),
                    );
                  }
                }
              } catch (parseErr: unknown) {
                if (parseErr instanceof Error && !parseErr.message.includes("JSON")) {
                  throw parseErr;
                }
              }
            }
          }
        }

        if (streamExecutedAction) {
          await triggerDataRefresh(streamExecutedAction.refreshTargets);
        }
      } else {
        const raw = await response.text();
        let data: {
          reply?: string;
          error?: string;
          pendingAction?: PendingCrudActionProposal;
          executedAction?: ExecutedCrudActionResult;
        } = {};
        try {
          data = JSON.parse(raw);
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
          pendingAction: data.pendingAction
            ? { ...data.pendingAction, status: "pending" }
            : undefined,
          executedAction: data.executedAction,
        };
        setMessages(prev => [
          ...prev.map(m =>
            data.executedAction &&
            m.pendingAction?.actionId === data.executedAction.actionId
              ? {
                  ...m,
                  pendingAction: {
                    ...m.pendingAction,
                    status: "confirmed" as const,
                    feedbackText: "Đã xác nhận qua hội thoại.",
                  },
                }
              : m,
          ),
          aiMsg,
        ]);

        if (data.executedAction) {
          await triggerDataRefresh(data.executedAction.refreshTargets);
        }
      }
    } catch (err) {
      if (err instanceof Error && err.name === "AbortError") {
        return;
      }

      const errText = err instanceof Error ? err.message : "Lỗi không xác định";
      let uiErrorMsg = errText;
      if (errText.includes("Failed to fetch") || errText.includes("NetworkError")) {
        uiErrorMsg = "Mất kết nối mạng. Vui lòng kiểm tra lại đường truyền.";
      } else if (errText.includes("thời gian")) {
        uiErrorMsg = "Phản hồi đang mất nhiều thời gian hơn dự kiến. Vui lòng thử lại.";
      } else if (!uiErrorMsg || uiErrorMsg === "Lỗi không xác định") {
        uiErrorMsg = "Không thể kết nối với Trợ lý chi tiêu. Vui lòng kiểm tra lại dịch vụ AI nội bộ hoặc thử lại sau.";
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
  }, [cancelAction, confirmAction, messages, isMinimized, isOpen, triggerDataRefresh]);

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
        confirmAction,
        cancelAction,
        stopGeneration,
        clearMessages,
      }}
    >
      {children}
    </AiChatContext.Provider>
  );
}
