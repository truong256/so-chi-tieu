"use client";

import React from "react";

interface EmptyStateProps {
  title: string;
  message?: string;
  actionText?: string;
  onAction?: () => void;
}

export default function EmptyState({
  title,
  message,
  actionText,
  onAction,
}: EmptyStateProps) {
  return (
    <div className="admin-empty-state">
      <div className="empty-state-dot" />
      <h3 className="empty-state-title">{title}</h3>
      {message && <p className="empty-state-message">{message}</p>}
      {actionText && onAction && (
        <button
          type="button"
          onClick={onAction}
          className="admin-btn admin-btn-secondary"
        >
          {actionText}
        </button>
      )}
    </div>
  );
}
