"use client";

import { useEffect } from "react";

export default function AppError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error(error);
    void fetch("/api/client-error", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message: error.message, digest: error.digest }),
      keepalive: true,
    }).catch(() => undefined);
  }, [error]);

  return (
    <main className="app-error" role="alert">
      <span className="brand-mark"><i /><i /><i /></span>
      <h1>Không thể mở Sổ Chi Tiêu.</h1>
      <p>Phiên làm việc chưa được tải hoàn chỉnh. Hãy thử mở lại giao diện.</p>
      <button type="button" onClick={reset}>Tải lại giao diện</button>
    </main>
  );
}
