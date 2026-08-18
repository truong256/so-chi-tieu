"use client";

import { useEffect, useState } from "react";

const loadingTexts = [
  "Đang chuẩn bị dữ liệu...",
  "Đang kiểm tra phiên làm việc...",
  "Đang chuẩn bị giao diện...",
  "Chỉ còn một chút nữa...",
];

export default function AppError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const [textIndex, setTextIndex] = useState(0);
  const [isReloading, setIsReloading] = useState(false);

  useEffect(() => {
    console.error(error);
    void fetch("/api/client-error", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message: error.message, digest: error.digest }),
      keepalive: true,
    }).catch(() => undefined);
  }, [error]);

  useEffect(() => {
    const interval = setInterval(() => {
      setTextIndex((prev) => (prev + 1) % loadingTexts.length);
    }, 2500);
    return () => clearInterval(interval);
  }, []);

  const handleReset = () => {
    setIsReloading(true);
    reset();
    setTimeout(() => setIsReloading(false), 2000);
  };

  return (
    <main className="min-h-screen w-full flex items-center justify-center bg-[#e6ece8] p-4 text-[#141c1e] font-sans" role="alert">
      <div className="max-w-md w-full bg-[#ffffff] rounded-3xl shadow-[0_4px_24px_rgba(0,0,0,0.02)] border border-[#d5ddda] overflow-hidden">
        <div className="p-8 sm:p-10 flex flex-col items-center text-center">
          
          <div className="relative mb-6">
            <div className="w-16 h-16 bg-[#151d1f] rounded-2xl flex items-center justify-center shadow-sm text-[#d2f544] font-black text-xl tracking-wider">
              SCT
            </div>
            <div className="absolute -bottom-1.5 -right-1.5 flex space-x-1 bg-white p-1.5 rounded-full border border-[#d5ddda] shadow-sm">
              <div className="w-1.5 h-1.5 rounded-full bg-[#3d494c] animate-bounce" style={{ animationDelay: '0ms' }}></div>
              <div className="w-1.5 h-1.5 rounded-full bg-[#3d494c] animate-bounce" style={{ animationDelay: '150ms' }}></div>
              <div className="w-1.5 h-1.5 rounded-full bg-[#3d494c] animate-bounce" style={{ animationDelay: '300ms' }}></div>
            </div>
          </div>

          <h1 className="text-xl sm:text-2xl font-bold mb-3 tracking-tight text-[#141c1e]">Không thể mở Sổ Chi Tiêu</h1>
          <p className="text-sm sm:text-base text-[#546366] mb-8 leading-relaxed">
            Phiên làm việc chưa được tải hoàn chỉnh. Bạn có thể thử tải lại giao diện.
          </p>

          <div className="w-full space-y-6">
            <div className="flex flex-col items-center justify-center space-y-3 h-12">
              <span className="text-sm text-[#3d494c] font-medium transition-opacity duration-300">
                {loadingTexts[textIndex]}
              </span>
              <div className="flex items-center space-x-1.5">
                <div className="w-1.5 h-1.5 rounded-full bg-[#d2f544] animate-pulse"></div>
                <div className="w-1.5 h-1.5 rounded-full bg-[#d2f544] animate-pulse" style={{ animationDelay: '200ms' }}></div>
                <div className="w-1.5 h-1.5 rounded-full bg-[#d2f544] animate-pulse" style={{ animationDelay: '400ms' }}></div>
              </div>
            </div>

            <button 
              type="button" 
              onClick={handleReset}
              disabled={isReloading}
              className="w-full flex items-center justify-center py-3.5 px-4 bg-[#151d1f] hover:bg-[#1d2628] text-white rounded-xl font-semibold transition-all duration-200 active:translate-y-[1px] shadow-[0_4px_14px_rgba(21,29,31,0.2)] focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-[#151d1f] disabled:opacity-80 disabled:active:translate-y-0"
            >
              {isReloading ? "Đang chuẩn bị..." : "Tải lại giao diện"}
            </button>
          </div>
        </div>
      </div>
    </main>
  );
}
