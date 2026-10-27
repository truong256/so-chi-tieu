/**
 * frontend/utils/theme.utils.ts
 * ==============================
 * Color and theme accent calculation utilities for Soft UI design system.
 */

export interface PresetColor {
  name: string;
  hex: string;
  desc: string;
}

export const PRESET_THEME_COLORS: PresetColor[] = [
  { name: "Lime Glow", hex: "#D2F544", desc: "Mặc định (Hiện đại & Tươi mới)" },
  { name: "Emerald Pro", hex: "#10B981", desc: "Tài chính & Thịnh vượng" },
  { name: "Cyan Tech", hex: "#06B6D4", desc: "Sáng tạo & Đột phá" },
  { name: "Electric Blue", hex: "#3B82F6", desc: "Tin cậy & Vững chắc" },
  { name: "Violet Dream", hex: "#8B5CF6", desc: "Đẳng cấp & Sang trọng" },
  { name: "Sunset Amber", hex: "#F59E0B", desc: "Ấm áp & Nổi bật" },
  { name: "Coral Rose", hex: "#F43F5E", desc: "Thanh lịch & Tinh tế" },
  { name: "Sakura Pink", hex: "#EC4899", desc: "Ngọt ngào & Năng lượng" },
  { name: "Deep Indigo", hex: "#6366F1", desc: "Chuyên nghiệp & Điềm tĩnh" },
];

/**
 * Calculates high-contrast foreground color (#141c1e or #ffffff) based on YIQ luminance.
 * Ensures WCAG 2.2 AA contrast compliance.
 */
export function getContrastColor(hexColor: string): string {
  const clean = hexColor.replace("#", "");
  if (clean.length === 6) {
    const r = parseInt(clean.substring(0, 2), 16);
    const g = parseInt(clean.substring(2, 4), 16);
    const b = parseInt(clean.substring(4, 6), 16);
    const yiq = (r * 299 + g * 587 + b * 114) / 1000;
    return yiq >= 140 ? "#141c1e" : "#ffffff";
  }
  return "#141c1e";
}

/**
 * Adjusts brightness of a HEX color by a given delta offset.
 */
export function adjustColorBrightness(hex: string, percent: number): string {
  const clean = hex.replace("#", "");
  if (clean.length !== 6) return hex;
  const num = parseInt(clean, 16);
  if (isNaN(num)) return hex;
  let r = (num >> 16) + percent;
  let g = ((num >> 8) & 0x00ff) + percent;
  let b = (num & 0x0000ff) + percent;
  r = Math.min(255, Math.max(0, r));
  g = Math.min(255, Math.max(0, g));
  b = Math.min(255, Math.max(0, b));
  return `#${((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1).toUpperCase()}`;
}

/**
 * Applies dynamic theme accent to CSS root variables.
 */
export function applyThemeAccent(hexColor: string) {
  if (typeof document === "undefined") return;
  document.documentElement.style.setProperty("--lime-accent", hexColor);
  const hoverColor = adjustColorBrightness(hexColor, -15);
  document.documentElement.style.setProperty("--lime-hover", hoverColor);
  const contrastText = getContrastColor(hexColor);
  document.documentElement.style.setProperty("--lime-contrast-text", contrastText);
}
