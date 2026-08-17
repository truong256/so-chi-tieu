import type { Metadata } from "next";
import { Be_Vietnam_Pro } from "next/font/google";
import "../frontend/styles/globals.css";

const beVietnamPro = Be_Vietnam_Pro({
  variable: "--font-be-vietnam-pro",
  subsets: ["latin", "vietnamese"],
  weight: ["300", "400", "500", "600", "700"],
  display: "swap",
});

export const metadata: Metadata = {
  title: "Sổ Chi Tiêu",
  description: "Quản lý thu chi, ngân sách và mục tiêu tài chính cá nhân.",
  other: { "codex-preview": "development" },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="vi">
      <body className={beVietnamPro.variable}>{children}</body>
    </html>
  );
}

