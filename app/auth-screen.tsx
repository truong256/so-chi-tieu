"use client";

import { FormEvent, useEffect, useRef, useState } from "react";
import { createClient } from "../lib/supabase/client";

type Mode = "login" | "register" | "forgot";

function FieldIcon({ name }: { name: "user" | "user-plus" | "mail" | "lock" }) {
  if (name === "mail") return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 6.5h16v11H4z" /><path d="m5 8 7 5 7-5" /></svg>;
  if (name === "lock") return <svg viewBox="0 0 24 24" aria-hidden="true"><rect x="5" y="10" width="14" height="10" rx="2" /><path d="M8 10V7a4 4 0 0 1 8 0v3" /></svg>;
  if (name === "user-plus") return <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="10" cy="8" r="3.5" /><path d="M3.5 20v-2.2A5.8 5.8 0 0 1 9.3 12h1.4a5.8 5.8 0 0 1 4.3 1.8" /><path d="M17 14v6M14 17h6" /></svg>;
  return <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="8" r="3.5" /><path d="M5.5 20v-2.2A5.8 5.8 0 0 1 11.3 12h1.4a5.8 5.8 0 0 1 5.8 5.8V20" /></svg>;
}

function PasswordField({
  name,
  placeholder,
  autoComplete,
  visible,
  disabled,
  onToggle,
}: {
  name: string;
  placeholder: string;
  autoComplete: string;
  visible: boolean;
  disabled?: boolean;
  onToggle: () => void;
}) {
  function handleToggleClick(e: React.MouseEvent<HTMLButtonElement>) {
    const btn = e.currentTarget;
    btn.style.transform = "scale(0.92)";
    setTimeout(() => { btn.style.transform = ""; }, 150);
    onToggle();
  }

  return (
    <label className="auth-input-group">
      <span className="sr-only">{placeholder}</span>
      <span className="auth-field-icon"><FieldIcon name="lock" /></span>
      <input
        name={name}
        type={visible ? "text" : "password"}
        required
        minLength={8}
        maxLength={128}
        disabled={disabled}
        autoComplete={autoComplete}
        placeholder={placeholder}
      />
      <button
        className="password-toggle"
        type="button"
        disabled={disabled}
        onClick={handleToggleClick}
        aria-label={visible ? "Ẩn mật khẩu" : "Hiện mật khẩu"}
        aria-pressed={visible}
      >
        <svg viewBox="0 0 24 24" aria-hidden="true" className={visible ? "eye-open" : "eye-closed"}>
          {visible ? (
            <>
              <path d="M2.5 12s3.4-6 9.5-6 9.5 6 9.5 6-3.4 6-9.5 6-9.5-6Z" />
              <circle cx="12" cy="12" r="2.7" />
              <line x1="3" y1="3" x2="21" y2="21" strokeWidth="2" />
            </>
          ) : (
            <>
              <path d="M2.5 12s3.4-6 9.5-6 9.5 6 9.5 6-3.4 6-9.5 6-9.5-6Z" />
              <circle cx="12" cy="12" r="2.7" />
            </>
          )}
        </svg>
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

  const [lastIdentifier, setLastIdentifier] = useState("");
  const [showQuickLoginBtn, setShowQuickLoginBtn] = useState(false);

  // Transition states
  const [transitioning, setTransitioning] = useState(false);
  const [transitionDir, setTransitionDir] = useState<"left" | "right">("left");
  const [displayMode, setDisplayMode] = useState<Mode>("login");

  // Avatar click state
  const [avatarPulse, setAvatarPulse] = useState(false);

  // Slogan popover
  const [showSlogan, setShowSlogan] = useState(false);
  const sloganTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Title animation
  const [titleVisible, setTitleVisible] = useState(true);

  function changeMode(nextMode: Mode, presetIdentifier?: string) {
    if (nextMode === mode && !presetIdentifier) return;
    if (transitioning) return;
    formRef.current?.reset();
    setMessage(null);
    setShowPassword(false);
    setShowConfirmation(false);
    setShowQuickLoginBtn(false);

    if (presetIdentifier) {
      setLastIdentifier(presetIdentifier);
    }

    // Determine slide direction
    const dir = nextMode === "register" ? "left" : "right";
    setTransitionDir(dir);
    setTransitioning(true);
    setTitleVisible(false);

    setTimeout(() => {
      setMode(nextMode);
      setDisplayMode(nextMode);
      setTransitioning(false);
      setTimeout(() => setTitleVisible(true), 40);
    }, 380);
  }

  function handleAvatarClick() {
    setAvatarPulse(true);
    setTimeout(() => setAvatarPulse(false), 400);
  }

  function handleLogoClick() {
    if (sloganTimerRef.current) clearTimeout(sloganTimerRef.current);
    setShowSlogan(false);
    setTimeout(() => {
      setShowSlogan(true);
      sloganTimerRef.current = setTimeout(() => setShowSlogan(false), 2800);
    }, 30);
  }

  // Cleanup timer on unmount
  useEffect(() => {
    return () => {
      if (sloganTimerRef.current) clearTimeout(sloganTimerRef.current);
    };
  }, []);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (loading) return;
    setLoading(true);
    setMessage(null);
    setShowQuickLoginBtn(false);

    const form = new FormData(event.currentTarget);
    const email = String(form.get("email") || "").trim().toLowerCase();
    const password = String(form.get("password") || "");

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

    try {
      const supabase = createClient();

      if (mode === "forgot") {
        if (!email) throw new Error("Vui lòng nhập địa chỉ email.");
        if (!emailRegex.test(email)) throw new Error("Địa chỉ email không đúng định dạng.");

        const { error } = await supabase.auth.resetPasswordForEmail(email, { redirectTo: window.location.origin });
        if (error) throw error;
        setMessage({ type: "success", text: "Đã gửi liên kết đặt lại mật khẩu. Hãy kiểm tra hộp thư của bạn." });
        return;
      }

      if (mode === "login") {
        const identifier = String(form.get("identifier") || "").trim();
        if (!identifier) throw new Error("Vui lòng nhập tên tài khoản hoặc email.");
        if (!password) throw new Error("Vui lòng nhập mật khẩu.");

        setLastIdentifier(identifier);
        let targetEmail = identifier.toLowerCase();

        // If identifier is not an email (no @), look up email via RPC get_email_by_username
        if (!targetEmail.includes("@")) {
          try {
            const { data: rpcEmail, error: rpcError } = await supabase.rpc("get_email_by_username", { p_username: targetEmail });
            if (!rpcError && rpcEmail && typeof rpcEmail === "string") {
              targetEmail = rpcEmail.trim().toLowerCase();
            }
          } catch {
            // RPC might not exist; proceed with direct attempt
          }
        }

        const { error } = await supabase.auth.signInWithPassword({ email: targetEmail, password });
        if (error) {
          throw error;
        }
        return;
      }

      // Registration Mode
      const username = String(form.get("username") || "").trim().toLowerCase();
      const fullName = String(form.get("fullName") || "").trim();
      const confirmPassword = String(form.get("confirmPassword") || "");
      setLastIdentifier(username || email);

      if (!username) throw new Error("Vui lòng nhập tên tài khoản.");
      if (!/^[a-z0-9_]{3,24}$/.test(username)) {
        throw new Error("Tên tài khoản phải có 3–24 ký tự, chỉ gồm chữ cái thường, số hoặc dấu gạch dưới.");
      }
      if (!fullName) throw new Error("Vui lòng nhập họ và tên của bạn.");
      if (!email) throw new Error("Vui lòng nhập địa chỉ email.");
      if (!emailRegex.test(email)) throw new Error("Địa chỉ email không đúng định dạng.");
      if (!password) throw new Error("Vui lòng nhập mật khẩu.");
      if (password.length < 8) throw new Error("Mật khẩu cần có ít nhất 8 ký tự.");
      if (password !== confirmPassword) throw new Error("Mật khẩu xác nhận không khớp.");

      const { data, error } = await supabase.auth.signUp({
        email,
        password,
        options: {
          data: { full_name: fullName, username },
          emailRedirectTo: window.location.origin,
        },
      });

      if (error) {
        const errLower = error.message.toLowerCase();
        const errCode = (error as { code?: string })?.code ?? "";

        if (errLower.includes("user already registered") || errCode === "user_already_exists") {
          setShowQuickLoginBtn(true);
          throw new Error("EMAIL_ALREADY_EXISTS");
        }
        throw error;
      }

      // Check if session was returned immediately
      if (data.session) {
        setMessage({
          type: "success",
          text: "Đăng ký thành công! Đang chuyển hướng vào bảng điều khiển…",
        });
        return;
      }

      // If no session returned directly, immediately sign in with the new credentials
      try {
        const { data: loginData, error: loginErr } = await supabase.auth.signInWithPassword({ email, password });
        if (!loginErr && loginData?.session) {
          setMessage({
            type: "success",
            text: "Đăng ký thành công! Đang chuyển hướng vào bảng điều khiển…",
          });
          return;
        }
      } catch {
        // fallthrough to manual login transition
      }

      // Switch to Login mode with credentials ready
      setMessage({
        type: "success",
        text: "Tạo tài khoản thành công! Bạn có thể đăng nhập ngay bây giờ.",
      });
      changeMode("login", username || email);
    } catch (error) {
      const raw = error instanceof Error ? error.message : "Có lỗi xảy ra. Vui lòng thử lại.";
      const lower = raw.toLowerCase();
      const code = (error as { code?: string })?.code ?? "";

      let text = raw;
      if (raw === "EMAIL_ALREADY_EXISTS" || lower.includes("user already registered") || code === "user_already_exists") {
        text = "Email này đã được sử dụng. Bạn có thể đăng nhập ngay hoặc lấy lại mật khẩu.";
        setShowQuickLoginBtn(true);
      } else if (lower.includes("invalid login credentials") || code === "invalid_credentials" || raw === "INVALID_USERNAME_LOGIN") {
        text = "Tên tài khoản / email hoặc mật khẩu không chính xác.";
      } else if (lower.includes("profiles_username_key") || (lower.includes("duplicate") && lower.includes("username"))) {
        text = "Tên tài khoản này đã được sử dụng. Vui lòng chọn tên tài khoản khác.";
      } else if (lower.includes("duplicate") || lower.includes("database error saving new user")) {
        text = "Tên tài khoản hoặc email đã được sử dụng bởi người khác. Vui lòng thử lại.";
      } else if (lower.includes("rate limit") || code === "over_rate_limit" || lower.includes("security purposes")) {
        text = "Hệ thống đang bận. Vui lòng thử lại sau giây lát.";
      } else if (lower.includes("failed to fetch") || lower.includes("networkerror") || lower.includes("network request failed")) {
        text = "Không thể kết nối đến máy chủ. Vui lòng kiểm tra kết nối mạng và thử lại.";
      } else if (lower.includes("email address") && lower.includes("invalid")) {
        text = "Địa chỉ email không đúng định dạng. Vui lòng kiểm tra lại.";
      }
      setMessage({ type: "error", text });
    } finally {
      setLoading(false);
    }
  }

  const title = displayMode === "login" ? "Chào mừng trở lại" : displayMode === "register" ? "Tạo tài khoản mới" : "Quên mật khẩu?";
  const subtitle = displayMode === "login" ? "Đăng nhập để tiếp tục quản lý chi tiêu" : displayMode === "register" ? "Bắt đầu quản lý tài chính của bạn" : "Nhập email để nhận liên kết đặt lại mật khẩu";

  const formClass = [
    "auth-form",
    `auth-form-${mode}`,
    transitioning ? `auth-form-exit-${transitionDir}` : "auth-form-enter",
  ].join(" ");

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
        {/* Logo with click-slogan effect */}
        <div className="auth-brand-wrapper">
          <a
            className="auth-brand"
            href="#"
            aria-label="Sổ Chi Tiêu - trang đăng nhập"
            onClick={(e) => { e.preventDefault(); handleLogoClick(); }}
          >
            <span className="brand-mark"><i /><i /><i /></span>
            <span>SỔ CHI TIÊU</span>
          </a>

          {/* Slogan popover */}
          <div className={`auth-slogan-popover ${showSlogan ? "auth-slogan-popover--visible" : ""}`} aria-live="polite">
            <span>Mỗi đồng tiền đều có <em>mục đích.</em></span>
          </div>
        </div>

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

          {/* Avatar */}
          <button
            type="button"
            className={`auth-avatar ${avatarPulse ? "auth-avatar--pulse" : ""}`}
            aria-label="Avatar tài khoản"
            onClick={handleAvatarClick}
          >
            <span className={`auth-avatar-icon ${mode === "register" ? "auth-avatar-icon--register" : "auth-avatar-icon--login"}`}>
              <FieldIcon name={mode === "register" ? "user-plus" : "user"} />
            </span>
          </button>

          {/* Title with fade transition */}
          <div className={`auth-heading auth-heading-${mode} ${titleVisible ? "auth-heading--visible" : "auth-heading--hidden"}`}>
            <h1 id="auth-title">{title}</h1>
            <p>{subtitle}</p>
          </div>

          {/* Tabs with sliding indicator */}
          {mode !== "forgot" && (
            <div className="auth-tabs" role="tablist" aria-label="Chọn hình thức tài khoản">
              <div
                className="auth-tabs-indicator"
                style={{ transform: mode === "register" ? "translateX(100%)" : "translateX(0%)" }}
              />
              <button
                type="button"
                className={mode === "login" ? "active" : ""}
                onClick={() => changeMode("login")}
                role="tab"
                aria-selected={mode === "login"}
              >
                Đăng nhập
              </button>
              <button
                type="button"
                className={mode === "register" ? "active" : ""}
                onClick={() => changeMode("register")}
                role="tab"
                aria-selected={mode === "register"}
              >
                Đăng ký
              </button>
            </div>
          )}

          {/* Form with slide transition */}
          <div className="auth-form-wrapper">
            <form ref={formRef} className={formClass} onSubmit={submit}>
              {mode === "register" && <>
                <label className="auth-input-group">
                  <span className="sr-only">Tên tài khoản</span>
                  <span className="auth-field-icon"><FieldIcon name="user" /></span>
                  <input
                    name="username"
                    required
                    minLength={3}
                    maxLength={24}
                    pattern="[A-Za-z0-9_]+"
                    disabled={loading}
                    autoCapitalize="none"
                    autoComplete="username"
                    placeholder="Tên tài khoản (viết liền, vd: nam_nguyen)"
                  />
                </label>
                <label className="auth-input-group">
                  <span className="sr-only">Họ và tên</span>
                  <span className="auth-field-icon"><FieldIcon name="user" /></span>
                  <input
                    name="fullName"
                    required
                    maxLength={100}
                    disabled={loading}
                    autoComplete="name"
                    placeholder="Họ và tên của bạn"
                  />
                </label>
              </>}

              {mode === "login" ? (
                <label className="auth-input-group">
                  <span className="sr-only">Tên tài khoản hoặc email</span>
                  <span className="auth-field-icon"><FieldIcon name="user" /></span>
                  <input
                    name="identifier"
                    key={`id-${lastIdentifier}`}
                    defaultValue={lastIdentifier}
                    required
                    disabled={loading}
                    autoCapitalize="none"
                    autoComplete="username"
                    placeholder="Tên tài khoản hoặc Email"
                  />
                </label>
              ) : (
                <label className="auth-input-group">
                  <span className="sr-only">Địa chỉ email</span>
                  <span className="auth-field-icon"><FieldIcon name="mail" /></span>
                  <input
                    name="email"
                    type="email"
                    key={`email-${lastIdentifier}`}
                    defaultValue={lastIdentifier.includes("@") ? lastIdentifier : ""}
                    required
                    disabled={loading}
                    autoCapitalize="none"
                    autoComplete="email"
                    placeholder="Địa chỉ email chính xác"
                  />
                </label>
              )}

              {mode !== "forgot" && (
                <PasswordField
                  name="password"
                  placeholder="Mật khẩu"
                  autoComplete={mode === "login" ? "current-password" : "new-password"}
                  visible={showPassword}
                  disabled={loading}
                  onToggle={() => setShowPassword((value) => !value)}
                />
              )}
              {mode === "register" && (
                <PasswordField
                  name="confirmPassword"
                  placeholder="Nhập lại mật khẩu"
                  autoComplete="new-password"
                  visible={showConfirmation}
                  disabled={loading}
                  onToggle={() => setShowConfirmation((value) => !value)}
                />
              )}

              {mode === "login" && (
                <div className="auth-options">
                  <span>Đăng nhập an toàn</span>
                  <button type="button" onClick={() => changeMode("forgot")}>Quên mật khẩu?</button>
                </div>
              )}
              
              {message && <p className={`auth-message ${message.type}`} role="status">{message.text}</p>}

              {showQuickLoginBtn && mode === "register" && (
                <div className="quick-switch-box" style={{ marginTop: 8 }}>
                  <button
                    type="button"
                    onClick={() => changeMode("login", lastIdentifier)}
                    className="ghost-action"
                    style={{ width: "100%", fontSize: "13px", height: "38px", fontWeight: 700, borderColor: "var(--lime-accent)" }}
                  >
                    👉 Đăng nhập ngay với tài khoản này
                  </button>
                </div>
              )}

              <button className={`primary-auth ${loading ? "primary-auth--loading" : ""}`} type="submit" disabled={loading}>
                {loading ? (
                  <span className="auth-btn-content">
                    <span className="auth-spinner" aria-hidden="true" />
                    Đang xử lý…
                  </span>
                ) : (
                  <span className="auth-btn-content">
                    {mode === "login" ? "Đăng nhập" : mode === "register" ? "Tạo tài khoản" : "Gửi liên kết đặt lại"}
                  </span>
                )}
              </button>
            </form>
          </div>

          {mode === "forgot"
            ? <button className="back-login" type="button" onClick={() => changeMode("login")}>← Quay lại đăng nhập</button>
            : <p className="auth-switch">{mode === "login" ? "Chưa có tài khoản?" : "Đã có tài khoản?"} <button type="button" onClick={() => changeMode(mode === "login" ? "register" : "login")}>{mode === "login" ? "Đăng ký ngay" : "Đăng nhập"}</button></p>
          }
        </section>
        <p className="auth-footnote">Dữ liệu tài chính được tách riêng và bảo mật theo từng tài khoản.</p>
      </section>
    </main>
  );
}
