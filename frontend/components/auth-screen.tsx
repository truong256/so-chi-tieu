"use client";

import { FormEvent, useEffect, useRef, useState } from "react";
import { createClient } from "@/config/supabase";
import { t, getAppLanguage, setAppLanguage, type Language } from "@/frontend/services/i18n.service";

type Mode = "login" | "register" | "forgot";

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
        style={{ fontSize: "12px", fontWeight: 600, color: "#546366" }}
      >
        {visible ? "Ẩn" : "Hiện"}
      </button>
    </label>
  );
}

export default function AuthScreen() {
  const formRef = useRef<HTMLFormElement>(null);
  const [authLang, setAuthLang] = useState<Language>(() => getAppLanguage());
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

      // Registration successful: do NOT auto-login to Dashboard.
      // Explicitly sign out any session auto-created by Supabase during signUp
      try {
        await supabase.auth.signOut();
      } catch {
        // ignore sign out error
      }

      // Transition to Login mode and inform user to sign in
      setMessage({
        type: "success",
        text: "Tạo tài khoản thành công! Vui lòng đăng nhập để bắt đầu sử dụng.",
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

  const title = displayMode === "login" ? t("auth.welcomeBack", undefined, authLang) : displayMode === "register" ? t("auth.createAccount", undefined, authLang) : t("auth.forgotPassword", undefined, authLang);
  const subtitle = displayMode === "login" ? t("auth.loginSubtitle", undefined, authLang) : displayMode === "register" ? t("auth.registerSubtitle", undefined, authLang) : t("auth.forgotSubtitle", undefined, authLang);

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
            <span>{authLang === "vi" ? "SỔ CHI TIÊU" : "EXPENSE BOOK"}</span>
          </a>

          {/* Slogan popover */}
          <div className={`auth-slogan-popover ${showSlogan ? "auth-slogan-popover--visible" : ""}`} aria-live="polite">
            <span>{authLang === "vi" ? "Mỗi đồng tiền đều có mục đích." : "Every single penny with purpose."}</span>
          </div>
        </div>

        <div className="auth-hero-copy">
          <p className="auth-hero-eyebrow">{authLang === "vi" ? "TÀI CHÍNH RÕ RÀNG · TƯƠNG LAI THÀNH THƠI" : "CLEAR CASHFLOW · PEACE OF MIND"}</p>
          <h2>{authLang === "vi" ? <>Để từng đồng tiền<br /><em className="lime-text">đều có mục đích.</em></> : <>Every single penny<br /><em className="lime-text">with a purpose.</em></>}</h2>
          <p>{authLang === "vi" ? "Theo dõi dòng tiền, kiểm soát ngân sách và tiến gần hơn đến những mục tiêu quan trọng." : "Track cashflow, manage budgets and achieve your financial goals effortlessly."}</p>
        </div>

        <div className="auth-hero-proof" aria-label="Lợi ích chính">
          <div tabIndex={0} role="button"><b>01</b><span>{authLang === "vi" ? <>Dữ liệu riêng<br />theo tài khoản</> : <>Private data<br />isolation</>}</span></div>
          <div tabIndex={0} role="button"><b>02</b><span>{authLang === "vi" ? <>Theo dõi tiền<br />thời gian thực</> : <>Real-time<br />cash tracking</>}</span></div>
          <div tabIndex={0} role="button"><b>03</b><span>{authLang === "vi" ? <>Báo cáo rõ ràng<br />mọi thiết bị</> : <>Visual reports<br />on all devices</>}</span></div>
        </div>
      </section>

      <section className="auth-form-panel">
        <section className="auth-card" aria-labelledby="auth-title">

          {/* Language Switch */}
          <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: "8px" }}>
            <div style={{ display: "inline-flex", background: "rgba(0,0,0,0.05)", borderRadius: "20px", padding: "2px", border: "1px solid rgba(0,0,0,0.06)" }}>
              <button
                type="button"
                style={{ border: "none", background: authLang === "vi" ? "#D2F544" : "transparent", color: "#161E1F", borderRadius: "16px", padding: "4px 10px", fontSize: "11px", fontWeight: 700, cursor: "pointer", transition: "all 0.2s ease" }}
                onClick={() => { setAuthLang("vi"); setAppLanguage("vi"); }}
              >
                VI
              </button>
              <button
                type="button"
                style={{ border: "none", background: authLang === "en" ? "#D2F544" : "transparent", color: "#161E1F", borderRadius: "16px", padding: "4px 10px", fontSize: "11px", fontWeight: 700, cursor: "pointer", transition: "all 0.2s ease" }}
                onClick={() => { setAuthLang("en"); setAppLanguage("en"); }}
              >
                EN
              </button>
            </div>
          </div>

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
                {t("auth.login", undefined, authLang)}
              </button>
              <button
                type="button"
                className={mode === "register" ? "active" : ""}
                onClick={() => changeMode("register")}
                role="tab"
                aria-selected={mode === "register"}
              >
                {t("auth.register", undefined, authLang)}
              </button>
            </div>
          )}

          {/* Form with slide transition */}
          <div className="auth-form-wrapper">
            <form ref={formRef} className={formClass} onSubmit={submit}>
              {mode === "register" && <>
                <label className="auth-input-group">
                  <span className="sr-only">{t("auth.username", undefined, authLang)}</span>
                  <input
                    name="username"
                    required
                    minLength={3}
                    maxLength={24}
                    pattern="[A-Za-z0-9_]+"
                    disabled={loading}
                    autoCapitalize="none"
                    autoComplete="username"
                    placeholder={t("auth.username", undefined, authLang)}
                  />
                </label>
                <label className="auth-input-group">
                  <span className="sr-only">{t("auth.fullName", undefined, authLang)}</span>
                  <input
                    name="fullName"
                    required
                    maxLength={100}
                    disabled={loading}
                    autoComplete="name"
                    placeholder={t("auth.fullName", undefined, authLang)}
                  />
                </label>
              </>}

              {mode === "login" ? (
                <label className="auth-input-group">
                  <span className="sr-only">{t("auth.usernameOrEmail", undefined, authLang)}</span>
                  <input
                    name="identifier"
                    key={`id-${lastIdentifier}`}
                    defaultValue={lastIdentifier}
                    required
                    disabled={loading}
                    autoCapitalize="none"
                    autoComplete="username"
                    placeholder={t("auth.usernameOrEmail", undefined, authLang)}
                  />
                </label>
              ) : (
                <label className="auth-input-group">
                  <span className="sr-only">{t("auth.email", undefined, authLang)}</span>
                  <input
                    name="email"
                    type="email"
                    key={`email-${lastIdentifier}`}
                    defaultValue={lastIdentifier.includes("@") ? lastIdentifier : ""}
                    required
                    disabled={loading}
                    autoCapitalize="none"
                    autoComplete="email"
                    placeholder={t("auth.email", undefined, authLang)}
                  />
                </label>
              )}

              {mode !== "forgot" && (
                <PasswordField
                  name="password"
                  placeholder={t("auth.password", undefined, authLang)}
                  autoComplete={mode === "login" ? "current-password" : "new-password"}
                  visible={showPassword}
                  disabled={loading}
                  onToggle={() => setShowPassword((value) => !value)}
                />
              )}
              {mode === "register" && (
                <PasswordField
                  name="confirmPassword"
                  placeholder={t("auth.confirmPassword", undefined, authLang)}
                  autoComplete="new-password"
                  visible={showConfirmation}
                  disabled={loading}
                  onToggle={() => setShowConfirmation((value) => !value)}
                />
              )}

              {mode === "login" && (
                <div className="auth-options">
                  <span>{authLang === "vi" ? "Đăng nhập an toàn" : "Secure authentication"}</span>
                  <button type="button" onClick={() => changeMode("forgot")}>{t("auth.forgotPassword", undefined, authLang)}</button>
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
                    {authLang === "vi" ? "Đăng nhập ngay với tài khoản này" : "Log in now with this account"}
                  </button>
                </div>
              )}

              <button className={`primary-auth ${loading ? "primary-auth--loading" : ""}`} type="submit" disabled={loading}>
                {loading ? (
                  <span className="auth-btn-content">
                    <span className="auth-spinner" aria-hidden="true" />
                    {t("common.loading", undefined, authLang)}
                  </span>
                ) : (
                  <span className="auth-btn-content">
                    {mode === "login" ? t("auth.login", undefined, authLang) : mode === "register" ? t("auth.register", undefined, authLang) : t("auth.sendResetLink", undefined, authLang)}
                  </span>
                )}
              </button>
            </form>
          </div>

          {mode === "forgot"
            ? <button className="back-login" type="button" onClick={() => changeMode("login")}>{t("auth.backToLogin", undefined, authLang)}</button>
            : <p className="auth-switch">{mode === "login" ? (authLang === "vi" ? "Chưa có tài khoản?" : "Don't have an account?") : (authLang === "vi" ? "Đã có tài khoản?" : "Already have an account?")} <button type="button" onClick={() => changeMode(mode === "login" ? "register" : "login")}>{mode === "login" ? t("auth.register", undefined, authLang) : t("auth.login", undefined, authLang)}</button></p>
          }
        </section>
        <p className="auth-footnote">{authLang === "vi" ? "Dữ liệu tài chính được tách riêng và bảo mật theo từng tài khoản." : "Financial data is privately isolated and secured per account."}</p>
      </section>
    </main>
  );
}
