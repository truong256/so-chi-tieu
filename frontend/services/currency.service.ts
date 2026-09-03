/**
 * Currency Service — Handles live exchange rate fetching, caching, conversion and formatting.
 * Base currency in database is always VND.
 */

export interface ExchangeRates {
  base: string;
  timestamp: number;
  rates: Record<string, number>;
  source: string;
}

export const DEFAULT_FALLBACK_RATES: Record<string, number> = {
  VND: 1,
  USD: 1 / 25450, // ~ 0.0000392927
  EUR: 1 / 27800, // ~ 0.00003597
  JPY: 1 / 165,   // ~ 0.00606
  GBP: 1 / 32600, // ~ 0.00003067
  SGD: 1 / 19100, // ~ 0.00005235
};

let inMemoryRates: ExchangeRates = {
  base: "VND",
  timestamp: Date.now(),
  rates: DEFAULT_FALLBACK_RATES,
  source: "default",
};

/**
 * Fetch latest exchange rates from API with caching.
 */
export async function getExchangeRates(): Promise<ExchangeRates> {
  // Check sessionStorage cache
  if (typeof window !== "undefined") {
    try {
      const cached = window.sessionStorage.getItem("app_exchange_rates");
      if (cached) {
        const parsed = JSON.parse(cached) as ExchangeRates;
        if (parsed.rates && Date.now() - parsed.timestamp < 3600 * 1000) {
          inMemoryRates = parsed;
          return inMemoryRates;
        }
      }
    } catch {
      // Ignore malformed or unavailable session cache and fetch fresh rates.
    }
  }

  try {
    const res = await fetch("/api/exchange-rates", {
      cache: "no-store",
      signal: AbortSignal.timeout(6000),
    });

    if (res.ok) {
      const data = (await res.json()) as ExchangeRates;
      if (data.rates && typeof data.rates.USD === "number") {
        inMemoryRates = {
          ...data,
          rates: {
            ...DEFAULT_FALLBACK_RATES,
            ...data.rates,
            VND: 1,
          },
        };

        if (typeof window !== "undefined") {
          try {
            window.sessionStorage.setItem("app_exchange_rates", JSON.stringify(inMemoryRates));
          } catch {
            // Rates remain available in memory when session storage is blocked.
          }
        }
        return inMemoryRates;
      }
    }
  } catch (err) {
    console.warn("Could not fetch fresh exchange rates, using fallback:", err);
  }

  return inMemoryRates;
}

/**
 * Get current in-memory / fallback exchange rates synchronously.
 */
export function getCurrentRates(): Record<string, number> {
  return inMemoryRates.rates;
}

/**
 * Convert base amount (in VND) to target currency using exchange rates.
 */
export function convertVndToTarget(
  amountInVnd: number,
  targetCurrency: string,
  rates: Record<string, number> = inMemoryRates.rates
): number {
  if (!amountInVnd || isNaN(amountInVnd)) return 0;
  if (targetCurrency === "VND") return amountInVnd;

  const rate = rates[targetCurrency] ?? DEFAULT_FALLBACK_RATES[targetCurrency];
  if (!rate || rate <= 0) return amountInVnd;

  return amountInVnd * rate;
}

/**
 * Convert an amount in target currency back to base VND.
 */
export function convertTargetToVnd(
  amountInTarget: number,
  sourceCurrency: string,
  rates: Record<string, number> = inMemoryRates.rates
): number {
  if (!amountInTarget || isNaN(amountInTarget)) return 0;
  if (sourceCurrency === "VND") return Math.round(amountInTarget);

  const rate = rates[sourceCurrency] ?? DEFAULT_FALLBACK_RATES[sourceCurrency];
  if (!rate || rate <= 0) return Math.round(amountInTarget);

  return Math.round(amountInTarget / rate);
}

/**
 * Formats a base VND amount into the target currency display string.
 */
export function formatMoney(
  amountInVnd: number,
  targetCurrency = "VND",
  language: "vi" | "en" = "vi",
  rates: Record<string, number> = inMemoryRates.rates
): string {
  const converted = convertVndToTarget(amountInVnd, targetCurrency, rates);
  const locale = language === "vi" ? "vi-VN" : "en-US";

  try {
    const isZeroDecimal = targetCurrency === "VND" || targetCurrency === "JPY" || targetCurrency === "KRW";
    return new Intl.NumberFormat(locale, {
      style: "currency",
      currency: targetCurrency,
      minimumFractionDigits: isZeroDecimal ? 0 : 2,
      maximumFractionDigits: isZeroDecimal ? 0 : 2,
    }).format(converted);
  } catch {
    return `${converted.toLocaleString(locale)} ${targetCurrency}`;
  }
}
