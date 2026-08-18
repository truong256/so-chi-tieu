/**
 * Exchange Rate Service — Server-side exchange rate caching and fetching.
 * Base currency is VND.
 */

export interface ExchangeRatesData {
  base: string;
  timestamp: number;
  rates: Record<string, number>;
  source: string;
}

// Fallback rates if external network / APIs are unreachable
const FALLBACK_RATES: Record<string, number> = {
  VND: 1,
  USD: 1 / 25450,    // ~ 0.00003929
  EUR: 1 / 27800,    // ~ 0.00003597
  JPY: 1 / 165,      // ~ 0.00606
  GBP: 1 / 32600,    // ~ 0.00003067
  SGD: 1 / 19100,    // ~ 0.00005235
  THB: 1 / 735,      // ~ 0.00136
  CNY: 1 / 3550,     // ~ 0.0002817
  KRW: 1 / 18.5,     // ~ 0.05405
};

const CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour cache

let cachedRatesData: ExchangeRatesData | null = null;

export async function getExchangeRates(): Promise<ExchangeRatesData> {
  const now = Date.now();

  // Return cached data if valid
  if (cachedRatesData && now - cachedRatesData.timestamp < CACHE_TTL_MS) {
    return cachedRatesData;
  }

  // Try primary API: open.er-api.com
  try {
    const res = await fetch("https://open.er-api.com/v6/latest/VND", {
      signal: AbortSignal.timeout(5000),
    });
    if (res.ok) {
      const data = (await res.json()) as { rates?: Record<string, number>; time_last_update_unix?: number };
      if (data.rates && typeof data.rates.USD === "number") {
        cachedRatesData = {
          base: "VND",
          timestamp: now,
          rates: {
            ...FALLBACK_RATES,
            ...data.rates,
            VND: 1,
          },
          source: "open.er-api.com",
        };
        return cachedRatesData;
      }
    }
  } catch (err) {
    console.warn("Primary exchange rate API failed:", err);
  }

  // Try secondary API: exchangerate-api.com
  try {
    const res = await fetch("https://api.exchangerate-api.com/v4/latest/VND", {
      signal: AbortSignal.timeout(5000),
    });
    if (res.ok) {
      const data = (await res.json()) as { rates?: Record<string, number> };
      if (data.rates && typeof data.rates.USD === "number") {
        cachedRatesData = {
          base: "VND",
          timestamp: now,
          rates: {
            ...FALLBACK_RATES,
            ...data.rates,
            VND: 1,
          },
          source: "exchangerate-api.com",
        };
        return cachedRatesData;
      }
    }
  } catch (err) {
    console.warn("Secondary exchange rate API failed:", err);
  }

  // Use previously cached or fallback
  if (cachedRatesData) {
    return cachedRatesData;
  }

  cachedRatesData = {
    base: "VND",
    timestamp: now,
    rates: FALLBACK_RATES,
    source: "fallback",
  };

  return cachedRatesData;
}
