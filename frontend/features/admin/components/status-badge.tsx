"use client";

import React from "react";

export type BadgeVariant =
  | "active"
  | "suspended"
  | "admin"
  | "user"
  | "success"
  | "failed"
  | "neutral";

interface StatusBadgeProps {
  variant: BadgeVariant | string;
  label?: string;
  className?: string;
}

export default function StatusBadge({ variant, label, className = "" }: StatusBadgeProps) {
  const norm = variant.toLowerCase();

  let text = label;
  let styleClass = "badge-neutral";

  switch (norm) {
    case "active":
      text = text ?? "Hoạt động";
      styleClass = "badge-active";
      break;
    case "suspended":
      text = text ?? "Tạm khóa";
      styleClass = "badge-suspended";
      break;
    case "admin":
      text = text ?? "Quản trị";
      styleClass = "badge-admin";
      break;
    case "user":
      text = text ?? "Người dùng";
      styleClass = "badge-user";
      break;
    case "success":
      text = text ?? "Thành công";
      styleClass = "badge-success";
      break;
    case "failed":
      text = text ?? "Thất bại";
      styleClass = "badge-failed";
      break;
    default:
      text = text ?? variant;
      styleClass = "badge-neutral";
      break;
  }

  return (
    <span className={`admin-status-badge ${styleClass} ${className}`}>
      {text}
    </span>
  );
}
