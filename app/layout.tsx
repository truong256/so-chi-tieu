import type { Metadata } from "next";
import "../frontend/styles/globals.css";

export const metadata: Metadata = {
  title: "Sổ Chi Tiêu",
  description: "Quản lý thu chi, ngân sách và mục tiêu tài chính cá nhân.",
  other: { "codex-preview": "development" },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="vi">
      <body>{children}</body>
    </html>
  );
}
