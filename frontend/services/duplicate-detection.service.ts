import type { Transaction, TransactionType } from "../types/finance.types";

export interface DuplicateCandidate {
  title: string;
  amount: number;
  type: TransactionType;
  walletId?: string | null;
  occurredAt?: string | null;
  id?: string; // If editing, don't match against self
}

export interface DuplicateDetectionResult {
  isDuplicate: boolean;
  confidence: number; // 0 to 1
  matchedTransaction?: Transaction;
  reason?: string;
}

function normalizeTitle(text: string): string {
  return text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]/g, "")
    .trim();
}

/**
 * Calculates string similarity based on Dice coefficient of bigrams.
 */
function stringSimilarity(str1: string, str2: string): number {
  const s1 = normalizeTitle(str1);
  const s2 = normalizeTitle(str2);

  if (s1 === s2) return 1.0;
  if (!s1 || !s2) return 0.0;
  if (s1.includes(s2) || s2.includes(s1)) return 0.85;

  const getBigrams = (str: string) => {
    const bigrams = new Set<string>();
    for (let i = 0; i < str.length - 1; i++) {
      bigrams.add(str.slice(i, i + 2));
    }
    return bigrams;
  };

  const b1 = getBigrams(s1);
  const b2 = getBigrams(s2);
  let intersection = 0;

  for (const b of b1) {
    if (b2.has(b)) intersection++;
  }

  return (2.0 * intersection) / (b1.size + b2.size || 1);
}

/**
 * Detects potential duplicate transactions based on:
 * - Amount, Type (mandatory match)
 * - Wallet (same wallet or empty)
 * - Timestamp proximity (same day or within 24h)
 * - Title/Description similarity
 */
export function detectDuplicateTransaction(
  candidate: DuplicateCandidate,
  existingTransactions: Transaction[],
  options: {
    maxHoursDiff?: number;
    threshold?: number;
  } = {},
): DuplicateDetectionResult {
  const { maxHoursDiff = 36, threshold = 0.65 } = options;

  if (!candidate.amount || candidate.amount <= 0 || !candidate.title.trim()) {
    return { isDuplicate: false, confidence: 0 };
  }

  const candidateDate = candidate.occurredAt ? new Date(candidate.occurredAt) : new Date();
  let bestMatch: Transaction | undefined;
  let highestScore = 0;

  for (const tx of existingTransactions) {
    // Skip self when editing
    if (candidate.id && tx.id === candidate.id) continue;

    // Type must match (income cannot match expense)
    if (tx.type !== candidate.type) continue;

    // Exact amount match is primary signal (if amount differs, heavily penalize)
    const amountDiff = Math.abs(tx.amount - candidate.amount);
    if (amountDiff > 0.01) continue;

    // Time difference
    const txDate = new Date(tx.occurred_at);
    const diffHours = Math.abs(candidateDate.getTime() - txDate.getTime()) / (1000 * 60 * 60);
    if (diffHours > maxHoursDiff) continue;

    // Time score (1.0 for same day, sliding down to 0.4 at 36h)
    const timeScore = Math.max(0.4, 1 - diffHours / (maxHoursDiff * 1.5));

    // Title similarity
    const titleScore = stringSimilarity(candidate.title, tx.title);

    // Wallet match (1.0 if identical or candidate not selected yet, 0.5 if different)
    const walletScore =
      !candidate.walletId || !tx.wallet_id || candidate.walletId === tx.wallet_id ? 1.0 : 0.4;

    // Overall weighted confidence
    const overallScore = 0.45 * 1.0 + 0.25 * timeScore + 0.2 * titleScore + 0.1 * walletScore;

    if (overallScore > highestScore) {
      highestScore = overallScore;
      bestMatch = tx;
    }
  }

  if (highestScore >= threshold && bestMatch) {
    const txDateStr = bestMatch.occurred_at.slice(0, 10);
    const reason = `Có giao dịch tương tự: "${bestMatch.title}" (${bestMatch.amount.toLocaleString("vi-VN")}đ) ngày ${txDateStr}`;
    return {
      isDuplicate: true,
      confidence: Math.round(highestScore * 100) / 100,
      matchedTransaction: bestMatch,
      reason,
    };
  }

  return { isDuplicate: false, confidence: highestScore };
}
