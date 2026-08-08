"use client";

import type { User } from "@supabase/supabase-js";
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
        const { data: authListener } = supabase.auth.onAuthStateChange((event, session) => {
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
    return (
      <main className="app-error" role="alert">
        <span className="brand-mark"><i /><i /><i /></span>
        <h1>Không thể kết nối dữ liệu.</h1>
        <p>Cấu hình máy chủ chưa được tải. Hãy mở lại giao diện.</p>
        <button type="button" onClick={() => window.location.reload()}>Tải lại giao diện</button>
      </main>
    );
  }

  if (user === undefined) {
    return (
      <main className="app-loading" aria-live="polite">
        <span className="brand-mark"><i /><i /><i /></span>
        <p>Đang mở sổ của bạn…</p>
      </main>
    );
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
