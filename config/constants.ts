/**
 * Application configuration and constants.
 */

export const APP_CONFIG = {
  name: "Sổ Chi Tiêu",
  description: "Hệ thống quản lý tài chính cá nhân",
  version: "0.1.0",
  defaultCurrency: "VND",
  defaultLocale: "vi-VN",
  defaultTimezone: "Asia/Ho_Chi_Minh",
} as const;

export const AI_CONFIG = {
  maxParseDuration: 30, // seconds
  maxReceiptDuration: 35, // seconds
  maxUploadBytes: 10 * 1024 * 1024, // 10 MB
  allowedImageMimeTypes: [
    "image/jpeg",
    "image/jpg",
    "image/png",
    "image/webp",
    "image/heic",
    "image/heif",
  ],
} as const;
