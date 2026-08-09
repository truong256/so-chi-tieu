"use client";

import { FormEvent, useRef, useState } from "react";
import { createClient } from "../lib/supabase/client";

type Mode = "login" | "register" | "forgot";

function FieldIcon({ name }: { name: "user" | "mail" | "lock" }) {
  if (name === "mail") return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 6.5h16v11H4z" /><path d="m5 8 7 5 7-5" /></svg>;
  if (name === "lock") return <svg viewBox="0 0 24 24" aria-hidden="true"><rect x="5" y="10" width="14" height="10" rx="2" /><path d="M8 10V7a4 4 0 0 1 8 0v3" /></svg>;
  return <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="8" r="3.5" /><path d="M5.5 20v-2.2A5.8 5.8 0 0 1 11.3 12h1.4a5.8 5.8 0 0 1 5.8 5.8V20" /></svg>;
}

function PasswordField({ name, placeholder, autoComplete, visible, onToggle }: { name: string; placeholder: string; autoComplete: string; visible: boolean; onToggle: () => void }) {
  return (
    <label className="auth-input-group">
      <span className="sr-only">{placeholder}</span>
      <span className="auth-field-icon"><FieldIcon name="lock" /></span>
      <input name={name} type={visible ? "text" : "password"} required minLength={8} maxLength={128} autoComplete={autoComplete} placeholder={placeholder} />
      <button className="password-toggle" type="button" onClick={onToggle} aria-label={visible ? "Ẩn mật khẩu" : "Hiện mật khẩu"} aria-pressed={visible}>
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M2.5 12s3.4-6 9.5-6 9.5 6 9.5 6-3.4 6-9.5 6-9.5-6-9.5-6Z" /><circle cx="12" cy="12" r="2.7" /></svg>
      </button>
    </label>
  );
}

export default function AuthScreen() {
  const formRef = useRef<HTMLFormElement>(null);
  const [mode, setMode] = useState<Mode>("login");
  const [loading, setLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmation, setShowConfirmation] = useState(false);
  const [message, setMessage] = useState<{ type: "error" | "success"; text: string } | null>(null);

  function changeMode(nextMode: Mode) {
    formRef.current?.reset();
    setMode(nextMode);
    setMessage(null);
    setShowPassword(false);
    setShowConfirmation(false);
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLoading(true);
    setMessage(null);

    const form = new FormData(event.currentTarget);
    const email = String(form.get("email") || "").trim().toLowerCase();
    const password = String(form.get("password") || "");

    try {
      const supabase = createClient();

      if (mode === "forgot") {
        const { error } = await supabase.auth.resetPasswordForEmail(email, { redirectTo: window.location.origin });
        if (error) throw error;
        setMessage({ type: "success", text: "Đã gửi liên kết đặt lại mật khẩu. Hãy kiểm tra hộp thư và thư rác." });
        return;
      }

      if (mode === "login") {
        const identifier = String(form.get("identifier") || "").trim().toLowerCase();
        if (identifier.includes("@")) {
          const { error } = await supabase.auth.signInWithPassword({ email: identifier, password });
          if (error) throw error;
        } else {
          const { data, error } = await supabase.functions.invoke("login-by-username", { body: { username: identifier, password } });
          if (error || !data?.access_token || !data?.refresh_token) throw new Error("INVALID_USERNAME_LOGIN");
          const { error: sessionError } = await supabase.auth.setSession({ access_token: data.access_token, refresh_token: data.refresh_token });
          if (sessionError) throw sessionError;
        }
        return;
      }

      const username = String(form.get("username") || "").trim().toLowerCase();
      const fullName = String(form.get("fullName") || "").trim();
      const confirmPassword = String(form.get("confirmPassword") || "");
      if (!/^[a-z0-9_]{3,24}$/.test(username)) throw new Error("Tên tài khoản phải có 3–24 ký tự, chỉ gồm chữ cái, số hoặc dấu gạch dưới.");
      if (password.length < 8) throw new Error("Mật khẩu cần có ít nhất 8 ký tự.");
      if (password !== confirmPassword) throw new Error("Hai mật khẩu chưa trùng khớp.");

      const { data, error } = await supabase.auth.signUp({
        email,
        password,
        options: {
          data: { full_name: fullName, username },
          emailRedirectTo: window.location.origin,
        },
      });
      if (error) throw error;

      if (!data.session) {
        setMessage({ type: "success", text: "Tài khoản đã được tạo. Hãy kiểm tra email để xác nhận rồi đăng nhập bằng tên tài khoản." });
      }
    } catch (error) {
      const raw = error instanceof Error ? error.message : "Có lỗi xảy ra. Vui lòng thử lại.";
      const lower = raw.toLowerCase();
      const text = lower.includes("invalid login credentials") || raw === "INVALID_USERNAME_LOGIN"
        ? "Tên tài khoản hoặc mật khẩu không chính xác."
        : lower.includes("user already registered")
          ? "Email này đã được đăng ký."
          : lower.includes("duplicate") || lower.includes("database error saving new user")
            ? "Tên tài khoản đã được sử dụng."
            : raw;
      setMessage({ type: "error", text });
    } finally {
      setLoading(false);
    }
  }

  const title = mode === "login" ? "Chào mừng trở lại" : mode === "register" ? "Tạo tài khoản mới" : "Quên mật khẩu?";
  const subtitle = mode === "login" ? "Đăng nhập để tiếp tục quản lý chi tiêu" : mode === "register" ? "Bắt đầu quản lý tài chính của riêng bạn" : "Nhập email để nhận liên kết đặt lại mật khẩu";

  return (
    <main className="auth-page auth-neumorphic-page" data-auth-mode={mode}>
      <section
        className="auth-hero-panel"
        aria-label="Giới thiệu Sổ Chi Tiêu"
        onMouseMove={(e) => {
          const rect = e.currentTarget.getBoundingClientRect();
          const x = ((e.clientX - rect.left) / rect.width) * 100;
          const y = ((e.clientY - rect.top) / rect.height) * 100;
          e.currentTarget.style.setProperty("--mouse-x", `${x}%`);
          e.currentTarget.style.setProperty("--mouse-y", `${y}%`);
        }}
      >
        <a className="auth-brand" href="#" aria-label="Sổ Chi Tiêu - trang đăng nhập">
          <span className="brand-mark"><i /><i /><i /></span>
          <span>SỔ CHI TIÊU</span>
        </a>

        <div className="auth-hero-copy">
          <p className="auth-hero-eyebrow">TÀI CHÍNH RÕ RÀNG · TƯƠNG LAI THÀNH THƠI</p>
          <h2>Để từng đồng tiền<br /><em className="lime-text">đều có mục đích.</em></h2>
          <p>Theo dõi dòng tiền, kiểm soát ngân sách và tiến gần hơn đến những mục tiêu quan trọng.</p>
        </div>

        <div className="auth-hero-proof" aria-label="Lợi ích chính">
          <div tabIndex={0} role="button"><b>01</b><span>Dữ liệu riêng<br />theo tài khoản</span></div>
          <div tabIndex={0} role="button"><b>02</b><span>Theo dõi tiền<br />theo thời gian thực</span></div>
          <div tabIndex={0} role="button"><b>03</b><span>Báo cáo rõ ràng<br />trên mọi thiết bị</span></div>
        </div>
      </section>

      <section className="auth-form-panel">
        <section className="auth-card" aria-labelledby="auth-title">
          <div className="auth-avatar" aria-hidden="true"><FieldIcon name="user" /></div>
          <div className={`auth-heading auth-heading-${mode}`}>
            <h1 id="auth-title">{title}</h1>
            <p>{subtitle}</p>
          </div>

          {mode !== "forgot" && <div className="auth-tabs" role="tablist" aria-label="Chọn hình thức tài khoản">
            <button type="button" className={mode === "login" ? "active" : ""} onClick={() => changeMode("login")} role="tab" aria-selected={mode === "login"}>Đăng nhập</button>
            <button type="button" className={mode === "register" ? "active" : ""} onClick={() => changeMode("register")} role="tab" aria-selected={mode === "register"}>Đăng ký</button>
          </div>}

          <form ref={formRef} className={`auth-form auth-form-${mode}`} onSubmit={submit}>
            {mode === "register" && <>
              <label className="auth-input-group"><span className="sr-only">Tên tài khoản</span><span className="auth-field-icon"><FieldIcon name="user" /></span><input name="username" required minLength={3} maxLength={24} pattern="[A-Za-z0-9_]+" autoCapitalize="none" autoComplete="username" placeholder="Tên tài khoản" /></label>
              <label className="auth-input-group"><span className="sr-only">Họ và tên</span><span className="auth-field-icon"><FieldIcon name="user" /></span><input name="fullName" required maxLength={100} autoComplete="name" placeholder="Họ và tên" /></label>
            </>}

            {mode === "login" ? (
              <label className="auth-input-group"><span className="sr-only">Tên tài khoản hoặc email</span><span className="auth-field-icon"><FieldIcon name="user" /></span><input name="identifier" required autoCapitalize="none" autoComplete="username" placeholder="Tên tài khoản hoặc email" /></label>
            ) : (
              <label className="auth-input-group"><span className="sr-only">Địa chỉ email</span><span className="auth-field-icon"><FieldIcon name="mail" /></span><input name="email" type="email" required autoCapitalize="none" autoComplete="email" placeholder="Địa chỉ email" /></label>
            )}

            {mode !== "forgot" && <PasswordField name="password" placeholder="Mật khẩu" autoComplete={mode === "login" ? "current-password" : "new-password"} visible={showPassword} onToggle={() => setShowPassword(value => !value)} />}
            {mode === "register" && <PasswordField name="confirmPassword" placeholder="Nhập lại mật khẩu" autoComplete="new-password" visible={showConfirmation} onToggle={() => setShowConfirmation(value => !value)} />}

            {mode === "login" && <div className="auth-options"><span>Đăng nhập an toàn</span><button type="button" onClick={() => changeMode("forgot")}>Quên mật khẩu?</button></div>}
            {message && <p className={`auth-message ${message.type}`} role="status">{message.text}</p>}

            <button className="primary-auth" type="submit" disabled={loading}>
              {loading ? "Đang xử lý…" : mode === "login" ? "Đăng nhập" : mode === "register" ? "Tạo tài khoản" : "Gửi liên kết đặt lại"}
            </button>
          </form>

          {mode === "forgot" ? <button className="back-login" type="button" onClick={() => changeMode("login")}>← Quay lại đăng nhập</button> : <p className="auth-switch">{mode === "login" ? "Chưa có tài khoản?" : "Đã có tài khoản?"} <button type="button" onClick={() => changeMode(mode === "login" ? "register" : "login")}>{mode === "login" ? "Đăng ký ngay" : "Đăng nhập"}</button></p>}
        </section>
        <p className="auth-footnote">Dữ liệu tài chính được tách riêng theo từng tài khoản.</p>
      </section>
    </main>
  );
}
