/**
 * Exchange Rate Service — Server-side exchange rate caching and fetching.
 * Base currency is VND.
 * Strictly supports conversion between VND and USD.
 */

export interface ExchangeRatesData {
  base: string;
  timestamp: number;
  rates: Record<string, number>;
  source: string;
}

// Fallback rates if external network / APIs are unreachable
// Strictly restricted to VND and USD
const FALLBACK_RATES: Record<string, number> = {
  VND: 1,
  USD: 1 / 25450, // ~ 0.00003929 (Tỷ giá tham chiếu 1 USD = 25.450 VND)
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
            VND: 1,
            USD: data.rates.USD,
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
            VND: 1,
            USD: data.rates.USD,
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
