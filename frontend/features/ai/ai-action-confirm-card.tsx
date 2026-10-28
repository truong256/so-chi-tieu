"use client";

import type { UiPendingActionState } from "./ai-chat-context";

interface Props {
  messageId: string;
  action: UiPendingActionState;
  onConfirm: (messageId: string) => void;
  onCancel: (messageId: string) => void;
}

export default function AiActionConfirmCard({
  messageId,
  action,
  onConfirm,
  onCancel,
}: Props) {
  const isPending = action.status === "pending" || action.status === "failed";
  const isConfirming = action.status === "confirming";

  return (
    <div
      className="ai-action-confirm-card"
      style={{
        marginTop: "10px",
        padding: "12px 14px",
        borderRadius: "12px",
        border: "1px solid rgba(15, 23, 42, 0.12)",
        background: "rgba(255, 255, 255, 0.92)",
        color: "#0f172a",
        fontSize: "13px",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: "8px",
          marginBottom: "8px",
          fontWeight: 700,
        }}
      >
        <span>{action.title}</span>
        <span
          style={{
            fontSize: "11px",
            padding: "2px 8px",
            borderRadius: "999px",
            background:
              action.status === "confirmed"
                ? "#dcfce7"
                : action.status === "cancelled"
                  ? "#f1f5f9"
                  : action.status === "failed"
                    ? "#fee2e2"
                    : "#fef9c3",
            color:
              action.status === "confirmed"
                ? "#166534"
                : action.status === "cancelled"
                  ? "#475569"
                  : action.status === "failed"
                    ? "#991b1b"
                    : "#854d0e",
          }}
        >
          {action.status === "confirmed"
            ? "Đã lưu thành công"
            : action.status === "cancelled"
              ? "Đã hủy"
              : action.status === "confirming"
                ? "Đang ghi dữ liệu..."
                : action.status === "failed"
                  ? "Thất bại"
                  : "Chờ xác nhận"}
        </span>
      </div>

      <div
        style={{
          display: "grid",
          gap: "4px",
          padding: "8px 0",
          borderTop: "1px solid rgba(15, 23, 42, 0.08)",
          borderBottom: "1px solid rgba(15, 23, 42, 0.08)",
        }}
      >
        {action.summaryFields.map((field, idx) => (
          <div
            key={idx}
            style={{
              display: "flex",
              justifyContent: "space-between",
              gap: "12px",
              fontSize: "12.5px",
            }}
          >
            <span style={{ color: "#64748b" }}>{field.label}:</span>
            <strong style={{ textAlign: "right", color: "#0f172a" }}>{field.value}</strong>
          </div>
        ))}
      </div>

      {action.warnings && action.warnings.length > 0 && (
        <div
          style={{
            marginTop: "8px",
            padding: "6px 8px",
            borderRadius: "8px",
            background: "#fffbeb",
            color: "#92400e",
            fontSize: "12px",
          }}
        >
          {action.warnings.map((w, i) => (
            <div key={i}>• {w}</div>
          ))}
        </div>
      )}

      {action.feedbackText && (
        <div
          style={{
            marginTop: "8px",
            fontSize: "12px",
            fontWeight: 600,
            color:
              action.status === "failed"
                ? "#b91c1c"
                : action.status === "confirmed"
                  ? "#15803d"
                  : "#475569",
          }}
        >
          {action.feedbackText}
        </div>
      )}

      {(isPending || isConfirming) && (
        <div style={{ display: "flex", gap: "8px", marginTop: "10px" }}>
          <button
            type="button"
            disabled={isConfirming}
            onClick={() => onConfirm(messageId)}
            style={{
              flex: 1,
              padding: "7px 12px",
              borderRadius: "8px",
              border: "none",
              background: "#111827",
              color: "#ffffff",
              fontWeight: 700,
              fontSize: "12.5px",
              cursor: isConfirming ? "not-allowed" : "pointer",
              opacity: isConfirming ? 0.65 : 1,
            }}
          >
            {isConfirming
              ? "Đang lưu..."
              : action.status === "failed"
                ? "Thử xác nhận lại"
                : "Xác nhận thực hiện"}
          </button>
          <button
            type="button"
            disabled={isConfirming}
            onClick={() => onCancel(messageId)}
            style={{
              padding: "7px 12px",
              borderRadius: "8px",
              border: "1px solid rgba(15, 23, 42, 0.18)",
              background: "#ffffff",
              color: "#334155",
              fontWeight: 600,
              fontSize: "12.5px",
              cursor: isConfirming ? "not-allowed" : "pointer",
            }}
          >
            Hủy bỏ
          </button>
        </div>
      )}
    </div>
  );
}

