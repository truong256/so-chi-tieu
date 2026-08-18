"use client";

import type { Session, User } from "@supabase/supabase-js";
import { FormEvent, useEffect, useState } from "react";
import { configureClient, createClient, type SupabaseBrowserConfig } from "@/config/supabase";
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

    async function initAuth() {
      try {
        // First try to use the client immediately if env is available
        let supabase = (() => {
          try {
            return createClient();
          } catch {
            return undefined;
          }
        })();

        if (!supabase) {
          const response = await fetch("/api/runtime-config", { cache: "no-store" });
          if (!response.ok) throw new Error("Không thể tải cấu hình kết nối.");
          const config = (await response.json()) as SupabaseBrowserConfig;
          if (!active) return;
          configureClient(config);
          supabase = createClient();
        }

        const { data: authListener } = supabase.auth.onAuthStateChange(
          (event: string, session: Session | null) => {
            if (!active) return;
            if (event === "PASSWORD_RECOVERY") {
              setRecovering(true);
            }
            if (event === "SIGNED_OUT") {
              setUser(null);
            } else if (session?.user) {
              setUser(session.user);
            } else if (event === "INITIAL_SESSION") {
              setUser(session?.user ?? null);
            }
          }
        );
        unsubscribe = () => authListener.subscription.unsubscribe();

        const { data, error } = await supabase.auth.getSession();
        if (!active) return;
        if (error) {
          setUser(null);
          return;
        }
        if (data.session?.user) {
          setUser(data.session.user);
        } else {
          // Check if listener already set user, otherwise null
          setUser((curr) => (curr !== undefined ? curr : null));
        }

        recoveryTimer = window.setTimeout(() => {
          if (active) setUser((current) => (current === undefined ? null : current));
        }, 4000);
      } catch (err) {
        console.error("FinanceApp init error:", err);
        if (active) setStartupError(true);
      }
    }

    void initAuth();

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
    try {
      await createClient().auth.signOut();
    } catch (e) {
      console.error("SignOut error:", e);
    }
    if (typeof window !== "undefined") {
      try {
        window.sessionStorage.clear();
      } catch {}
    }
    setUser(null);
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

  return <main className="recovery-page"><form className="recovery-card" onSubmit={submit}><span className="brand-mark"><i /><i /><i /></span><p className="section-index">BẢO MẬT TÀI KHOẢN</p><h1>Đặt mật khẩu mới.</h1><p>Mật khẩu nên dài ít nhất 8 ký tự và không dùng lại ở dịch vụ khác.</p><label>Mật khẩu mới<input name="password" type="password" minLength={8} required autoComplete="new-password" /></label><label>Nhập lại mật khẩu<input name="confirmation" type="password" minLength={8} required autoComplete="new-password" /></label>{message && <p className="auth-message error">{message}</p>}<button className="primary-auth" disabled={loading}><span>{loading ? "Đang cập nhật…" : "Cập nhật mật khẩu"}</span></button></form></main>;
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
    <main className="startup-screen" role="alert" aria-live="polite">
      <div className="startup-card">
        <div className="startup-logo-wrap">
          <div className="startup-logo">SCT</div>
          <div className="startup-logo-dots">
            <div className="startup-dot" style={{ animationDelay: "0ms" }} />
            <div className="startup-dot" style={{ animationDelay: "150ms" }} />
            <div className="startup-dot" style={{ animationDelay: "300ms" }} />
          </div>
        </div>
        <h1 className="startup-title">Sổ Chi Tiêu</h1>
        <p className="startup-subtitle">Hệ thống quản lý tài chính cá nhân</p>
        <div className="startup-loading-row">
          <span className="startup-loading-text">{loadingTexts[textIndex]}</span>
          <div className="startup-pulse-dots">
            <div className="startup-pulse" style={{ animationDelay: "0ms" }} />
            <div className="startup-pulse" style={{ animationDelay: "200ms" }} />
            <div className="startup-pulse" style={{ animationDelay: "400ms" }} />
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
    <main className="startup-screen" role="alert">
      <div className="startup-card">
        <div className="startup-logo-wrap">
          <div className="startup-logo">SCT</div>
        </div>
        <h1 className="startup-title">Không thể kết nối dữ liệu</h1>
        <p className="startup-subtitle">Cấu hình máy chủ chưa được tải. Hãy thử mở lại giao diện.</p>
        <button
          type="button"
          onClick={handleReset}
          disabled={isReloading}
          className="startup-reload-btn"
        >
          {isReloading ? "Đang tải..." : "Tải lại giao diện"}
        </button>
      </div>
    </main>
  );
}
