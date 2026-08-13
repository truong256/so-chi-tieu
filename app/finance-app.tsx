"use client";

import type { Session, User } from "@supabase/supabase-js";
import { FormEvent, useEffect, useState } from "react";
import { configureClient, createClient, type SupabaseBrowserConfig } from "../lib/supabase/client";
import AuthScreen from "./auth-screen";
import Dashboard from "./dashboard";

export default function FinanceApp() {
  const [user, setUser] = useState<User | null | undefined>(undefined);
  const [recovering, setRecovering] = useState(false);
  const [startupError, setStartupError] = useState(false);

  useEffect(() => {
    let active = true;
    let recoveryTimer: number | undefined;
    let unsubscribe: (() => void) | undefined;

    async function start() {
      try {
        const response = await fetch("/api/runtime-config", { cache: "no-store" });
        if (!response.ok) throw new Error("Không thể tải cấu hình kết nối.");

        const config = await response.json() as SupabaseBrowserConfig;
        if (!active) return;
        configureClient(config);

        const supabase = createClient();
        const { data: authListener } = supabase.auth.onAuthStateChange((event: string, session: Session | null) => {
          if (!active) return;
          if (event === "PASSWORD_RECOVERY") setRecovering(true);
          if (event === "SIGNED_OUT") setUser(null);
          else if (session?.user) setUser(session.user);
          else if (event === "INITIAL_SESSION") setUser(null);
        });
        unsubscribe = () => authListener.subscription.unsubscribe();

        const { data, error } = await supabase.auth.getSession();
        if (!active) return;
        if (error) {
          setUser(null);
          return;
        }
        setUser(data.session?.user ?? null);

        recoveryTimer = window.setTimeout(() => {
          if (active) setUser(current => current === undefined ? null : current);
        }, 8000);
      } catch {
        if (active) setStartupError(true);
      }
    }

    void start();

    return () => {
      active = false;
      if (recoveryTimer !== undefined) window.clearTimeout(recoveryTimer);
      unsubscribe?.();
    };
  }, []);

  if (startupError) {
    return <StartupErrorScreen />;
  }

  if (user === undefined) {
    return <LoadingScreen />;
  }

  if (!user) return <AuthScreen />;

  if (recovering) return <ResetPassword onDone={() => setRecovering(false)} />;

  const email = user.email ?? "";
  const fullName = typeof user.user_metadata?.full_name === "string" ? user.user_metadata.full_name : "";
  const name = fullName.trim() || email.split("@")[0] || "Bạn";

  async function signOut() {
    await createClient().auth.signOut();
  }

  return <Dashboard user={{ id: user.id, name, email }} onSignOut={signOut} />;
}

function ResetPassword({ onDone }: { onDone: () => void }) {
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLoading(true); setMessage("");
    const form = new FormData(event.currentTarget);
    const password = String(form.get("password") || "");
    const confirmation = String(form.get("confirmation") || "");
    if (password.length < 8 || password !== confirmation) {
      setMessage(password.length < 8 ? "Mật khẩu cần có ít nhất 8 ký tự." : "Hai mật khẩu chưa trùng khớp.");
      setLoading(false); return;
    }
    const { error } = await createClient().auth.updateUser({ password });
    setLoading(false);
    if (error) return setMessage(error.message);
    onDone();
  }

  return <main className="recovery-page"><form className="recovery-card" onSubmit={submit}><span className="brand-mark"><i /><i /><i /></span><p className="section-index">BẢO MẬT TÀI KHOẢN</p><h1>Đặt mật khẩu mới.</h1><p>Mật khẩu nên dài ít nhất 8 ký tự và không dùng lại ở dịch vụ khác.</p><label>Mật khẩu mới<input name="password" type="password" minLength={8} required autoComplete="new-password" /></label><label>Nhập lại mật khẩu<input name="confirmation" type="password" minLength={8} required autoComplete="new-password" /></label>{message && <p className="auth-message error">{message}</p>}<button className="primary-auth" disabled={loading}><span>{loading ? "Đang cập nhật…" : "Cập nhật mật khẩu"}</span><b>→</b></button></form></main>;
}

function LoadingScreen() {
  const [textIndex, setTextIndex] = useState(0);
  const loadingTexts = [
    "Đang mở sổ của bạn...",
    "Đang kiểm tra kết nối...",
    "Đang chuẩn bị dữ liệu..."
  ];

  useEffect(() => {
    const interval = setInterval(() => {
      setTextIndex((prev) => (prev + 1) % loadingTexts.length);
    }, 2000);
    return () => clearInterval(interval);
  }, [loadingTexts.length]);

  return (
    <main className="min-h-screen w-full flex items-center justify-center bg-[#e6ece8] p-4 text-[#141c1e] font-sans" role="alert" aria-live="polite">
      <div className="max-w-md w-full bg-[#ffffff] rounded-3xl shadow-[0_4px_24px_rgba(0,0,0,0.02)] border border-[#d5ddda] overflow-hidden">
        <div className="p-8 sm:p-10 flex flex-col items-center text-center">
          
          <div className="relative mb-6">
            <div className="w-16 h-16 bg-[#151d1f] rounded-2xl flex items-center justify-center shadow-sm">
              <svg className="w-8 h-8 text-[#d2f544]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                 <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" />
              </svg>
            </div>
            <div className="absolute -bottom-1.5 -right-1.5 flex space-x-1 bg-white p-1.5 rounded-full border border-[#d5ddda] shadow-sm">
              <div className="w-1.5 h-1.5 rounded-full bg-[#3d494c] animate-bounce" style={{ animationDelay: '0ms' }}></div>
              <div className="w-1.5 h-1.5 rounded-full bg-[#3d494c] animate-bounce" style={{ animationDelay: '150ms' }}></div>
              <div className="w-1.5 h-1.5 rounded-full bg-[#3d494c] animate-bounce" style={{ animationDelay: '300ms' }}></div>
            </div>
          </div>

          <h1 className="text-xl sm:text-2xl font-bold mb-3 tracking-tight text-[#141c1e]">Sổ Chi Tiêu</h1>
          <p className="text-sm sm:text-base text-[#546366] mb-8 leading-relaxed">
            Hệ thống quản lý tài chính cá nhân
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
          </div>
        </div>
      </div>
    </main>
  );
}

function StartupErrorScreen() {
  const [isReloading, setIsReloading] = useState(false);
  const handleReset = () => {
    setIsReloading(true);
    window.location.reload();
  };

  return (
    <main className="min-h-screen w-full flex items-center justify-center bg-[#e6ece8] p-4 text-[#141c1e] font-sans" role="alert">
      <div className="max-w-md w-full bg-[#ffffff] rounded-3xl shadow-[0_4px_24px_rgba(0,0,0,0.02)] border border-[#d5ddda] overflow-hidden">
        <div className="p-8 sm:p-10 flex flex-col items-center text-center">
          
          <div className="relative mb-6">
            <div className="w-16 h-16 bg-[#151d1f] rounded-2xl flex items-center justify-center shadow-sm">
              <svg className="w-8 h-8 text-[#d2f544]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            </div>
            <div className="absolute -bottom-1.5 -right-1.5 flex space-x-1 bg-white p-1.5 rounded-full border border-[#d5ddda] shadow-sm">
              <div className="w-1.5 h-1.5 rounded-full bg-[#3d494c] animate-bounce" style={{ animationDelay: '0ms' }}></div>
              <div className="w-1.5 h-1.5 rounded-full bg-[#3d494c] animate-bounce" style={{ animationDelay: '150ms' }}></div>
              <div className="w-1.5 h-1.5 rounded-full bg-[#3d494c] animate-bounce" style={{ animationDelay: '300ms' }}></div>
            </div>
          </div>

          <h1 className="text-xl sm:text-2xl font-bold mb-3 tracking-tight text-[#141c1e]">Không thể kết nối dữ liệu</h1>
          <p className="text-sm sm:text-base text-[#546366] mb-8 leading-relaxed">
            Cấu hình máy chủ chưa được tải. Hãy thử mở lại giao diện.
          </p>

          <div className="w-full space-y-6">
            <button 
              type="button" 
              onClick={handleReset}
              disabled={isReloading}
              className="w-full flex items-center justify-center py-3.5 px-4 bg-[#151d1f] hover:bg-[#1d2628] text-white rounded-xl font-semibold transition-all duration-200 active:translate-y-[1px] shadow-[0_4px_14px_rgba(21,29,31,0.2)] focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-[#151d1f] disabled:opacity-80 disabled:active:translate-y-0"
            >
              {isReloading ? (
                <>
                  <svg className="animate-spin -ml-1 mr-2 h-4 w-4 text-[#d2f544]" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                  </svg>
                  Đang tải...
                </>
              ) : (
                "Tải lại giao diện"
              )}
            </button>
          </div>
        </div>
      </div>
    </main>
  );
}
