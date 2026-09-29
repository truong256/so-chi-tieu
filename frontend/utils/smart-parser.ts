import type { Category, TransactionType, Wallet } from "../types/finance.types";

export type SmartTransactionResult = {
  type: TransactionType | null;
  name: string;
  amount: number | null;
  currency?: string;
  categoryId: string | null;
  walletId: string | null;
  date: Date | null;
  confidence: {
    type: number;
    category: number;
    wallet: number;
    amount: number;
    date: number;
  };
  summaryText: string;
  isTransfer?: boolean;
  fromWalletId?: string | null;
  toWalletId?: string | null;
  multipleDetected?: boolean;
  subItems?: SmartTransactionResult[];
};

const EXPENSE_RULES = [
  {
    matcher: ["ăn uống", "ẩm thực", "ăn", "uống"],
    prefixPhrases: ["ăn ", "uống ", "đi ăn ", "tiền ăn ", "chi ăn ", "mua đồ ăn "],
    phrases: [
      "ăn sáng", "ăn trưa", "ăn tối", "ăn chiều", "ăn đêm", "ăn cơm", "ăn tiệm", "ăn ngoài", "ăn gì", "ăn vặt",
      "đồ ăn vặt", "bữa sáng", "bữa trưa", "bữa tối", "bữa ăn", "đồ ăn", "thức ăn", "ăn uống", "uống nước",
      "trà sữa", "cà phê", "cafe", "coffee", "bánh mì", "cơm gà", "cơm tấm", "cơm sườn", "cơm văn phòng", "nhậu",
      "đi ăn", "uống cf", "uống cafe", "uống trà", "uống bia", "ăn lẩu", "ăn nướng", "ăn buffet", "ăn ốc", "ăn chè",
      "ăn kem", "ăn bánh", "ăn bún", "ăn phở", "ăn hủ tiếu", "ăn mì", "ăn xôi", "ăn cháo", "mua đồ ăn", "mua thức ăn",
      "tiền ăn", "chi ăn", "giao đồ ăn", "ship đồ ăn", "highlands", "starbucks", "phúc long", "kfc", "lotteria",
      "jollibee", "mcdonalds", "the coffee house", "mixue", "haidilao", "kichi kichi", "gogi", "king bbq", "pizza",
      "burger", "sushi", "bánh tráng", "bánh ngọt", "tiền ăn uống"
    ],
    keywords: ["cơm", "phở", "bún", "mì", "ăn", "uống", "lẩu", "nướng", "buffet", "cafe", "coffee", "nhậu", "snack", "chè", "kem", "bánh", "cháo", "xôi", "bia", "rượu", "thịt", "cá", "rau", "trái cây", "hoa quả", "trà"],
  },
  {
    matcher: ["di chuyển", "giao thông", "đi lại"],
    prefixPhrases: ["đổ xăng ", "mua xăng ", "tiền xăng ", "đi xe ", "thuê xe ", "gửi xe "],
    phrases: [
      "đổ xăng", "tiền xăng", "xăng xe", "mua xăng", "dầu xe", "đổ dầu", "gửi xe", "tiền gửi xe", "bãi xe", "vé xe",
      "xe buýt", "xe bus", "bus", "taxi", "grab", "be bike", "be car", "xanh sm", "gojek", "vé tàu", "tàu điện",
      "metro", "vé máy bay", "đi xe", "thuê xe", "sửa xe", "rửa xe", "bảo dưỡng xe", "thay nhớt", "vé cầu đường",
      "phí cầu đường", "gửi ô tô", "gửi oto"
    ],
    keywords: ["xăng", "xe", "tàu", "grab", "taxi", "bus", "flight", "nhớt"],
  },
  {
    matcher: ["mua sắm", "shopping"],
    prefixPhrases: ["mua áo ", "mua quần ", "mua giày ", "mua dép ", "mua đồ "],
    phrases: [
      "mua áo", "mua quần", "quần áo", "mua đồ", "shopping", "mua hàng", "shopee", "lazada", "tiki", "tiktok shop",
      "mua sắm", "mua váy", "mua đầm", "mua giày", "mua dép", "mua túi", "mua balo", "mua mỹ phẩm", "mua son", "phụ kiện"
    ],
    keywords: ["áo", "quần", "váy", "đầm", "giày", "dép", "túi", "balo", "son", "mỹ phẩm", "shopee", "lazada", "tiki"],
  },
  {
    matcher: ["hóa đơn", "tiện ích", "nhà ở", "tiền nhà"],
    prefixPhrases: ["tiền điện ", "tiền nước ", "tiền mạng ", "tiền wifi ", "tiền nhà ", "tiền phòng "],
    phrases: [
      "tiền điện", "tiền nước", "internet", "wifi", "tiền mạng", "tiền điện thoại", "nạp điện thoại", "nạp thẻ",
      "tiền nhà", "tiền thuê nhà", "tiền phòng", "tiền rác", "phí dịch vụ", "phí quản lý", "tiền gas"
    ],
    keywords: ["điện", "nước", "gas", "wifi", "internet", "phòng", "nhà", "rác"],
  },
  {
    matcher: ["giải trí", "vui chơi"],
    prefixPhrases: ["xem phim ", "chơi game ", "nạp game "],
    phrases: [
      "xem phim", "vé phim", "cgv", "lotte cinema", "bhd", "netflix", "spotify", "chơi game", "nạp game", "karaoke",
      "du lịch", "vui chơi", "vé tham quan", "xem ca nhạc", "concert", "boardgame", "billiard", "bida"
    ],
    keywords: ["game", "phim", "cinema", "du lịch", "karaoke", "nhạc", "bida"],
  },
  {
    matcher: ["sức khỏe", "y tế", "thuốc"],
    prefixPhrases: ["mua thuốc ", "khám bệnh ", "tiền thuốc "],
    phrases: [
      "mua thuốc", "khám bệnh", "khám sức khỏe", "bệnh viện", "nha khoa", "bác sĩ", "xét nghiệm", "tiền thuốc",
      "khám răng", "mua kính", "vitamin", "thực phẩm chức năng", "tiêm phòng", "tiêm vaccine"
    ],
    keywords: ["thuốc", "khám", "viện", "bác sĩ", "răng", "nha khoa", "vitamin"],
  },
  {
    matcher: ["giáo dục", "học tập", "học"],
    prefixPhrases: ["tiền học ", "học phí ", "mua sách "],
    phrases: [
      "học phí", "tiền học", "khóa học", "mua sách", "sách giáo khoa", "tài liệu", "học thêm", "học tiếng anh",
      "ielts", "toeic", "học lái xe", "dụng cụ học tập"
    ],
    keywords: ["sách", "học", "khoá học", "course"],
  }
];

const INCOME_RULES = [
  {
    matcher: ["lương", "thu nhập"],
    prefixPhrases: ["nhận lương ", "lương "],
    phrases: [
      "nhận lương", "lương tháng", "lương tháng này", "tiền lương", "chuyển lương", "lương cứng", "lương net", "lương gross"
    ],
    keywords: ["lương", "salary"],
  },
  {
    matcher: ["thưởng"],
    prefixPhrases: ["tiền thưởng ", "được thưởng "],
    phrases: [
      "được thưởng", "thưởng tết", "thưởng dự án", "tiền thưởng", "thưởng nóng", "hoa hồng", "commission"
    ],
    keywords: ["thưởng", "bonus", "hoa hồng"],
  },
  {
    matcher: ["trợ cấp", "hỗ trợ", "thu khác"],
    prefixPhrases: ["ba cho ", "mẹ cho ", "được cho ", "bố mẹ cho "],
    phrases: [
      "ba cho", "mẹ cho", "ông cho", "bà cho", "ba mẹ cho", "bố mẹ cho", "được cho", "trợ cấp", "nhận tiền",
      "tiền mừng", "lì xì", "được biếu", "được tặng", "thu hồi nợ", "đòi nợ", "hoàn tiền", "cashback"
    ],
    keywords: ["cho", "biếu", "tặng", "lì xì", "trợ cấp", "hoàn tiền"],
  }
];

export function normalizeVietnameseText(text: string): string {
  return text.toLowerCase().trim().replace(/\s{2,}/g, " ");
}

export function removeAccents(str: string): string {
  return str.normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/đ/g, "d").replace(/Đ/g, "D");
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function containsWord(text: string, word: string): boolean {
  const normText = text.toLowerCase();
  const normKw = word.toLowerCase();
  const escaped = normKw.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const regex = new RegExp(`(?:^|[^a-z0-9à-ỹá-ý])${escaped}(?:$|[^a-z0-9à-ỹá-ý])`, "i");
  return regex.test(normText);
}

function containsWordNoAccent(text: string, word: string): boolean {
  const normText = removeAccents(text.toLowerCase());
  const normKw = removeAccents(word.toLowerCase());
  const escaped = normKw.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const regex = new RegExp(`(?:^|[^a-z0-9])${escaped}(?:$|[^a-z0-9])`, "i");
  return regex.test(normText);
}

function matchesPrefix(text: string, prefix: string): boolean {
  const normText = text.toLowerCase();
  const escaped = prefix.toLowerCase().trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const regex = new RegExp(`(?:^|[^a-z0-9à-ỹá-ý])${escaped}\\s+`, "i");
  return regex.test(normText);
}

function matchesPrefixNoAccent(text: string, prefix: string): boolean {
  const normText = removeAccents(text.toLowerCase());
  const escaped = removeAccents(prefix.toLowerCase().trim()).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const regex = new RegExp(`(?:^|[^a-z0-9])${escaped}\\s+`, "i");
  return regex.test(normText);
}

export function parseVietnameseAmount(text: string): { amount: number | null, currency: string, score: number, matchedStr: string } {
  // 0. Foreign currencies (e.g. 15 USD, 20 đô, $15, 50 EUR)
  const usdPrefix = text.match(/\$\s*(\d+(?:[.,]\d+)?)\b/i);
  if (usdPrefix) {
    const num = Number(usdPrefix[1].replace(",", "."));
    return { amount: num, currency: "USD", score: 100, matchedStr: usdPrefix[0] };
  }
  const regexUsd = /(\d+(?:[.,]\d+)?)\s*(?:usd|đô|dollar|\$)\b/i;
  const matchUsd = text.match(regexUsd);
  if (matchUsd) {
    const num = Number(matchUsd[1].replace(",", "."));
    return { amount: num, currency: "USD", score: 100, matchedStr: matchUsd[0] };
  }
  const regexEur = /(\d+(?:[.,]\d+)?)\s*(?:eur|euro|€)\b/i;
  const matchEur = text.match(regexEur);
  if (matchEur) {
    const num = Number(matchEur[1].replace(",", "."));
    return { amount: num, currency: "EUR", score: 100, matchedStr: matchEur[0] };
  }

  const halfMillion = text.match(/(\d+(?:[.,]\d+)?)\s*(?:triệu|tr)\s*rưỡi\b/i);
  if (halfMillion) {
    return { amount: Math.round(Number(halfMillion[1].replace(",", ".")) * 1_000_000 + 500_000), currency: "VND", score: 100, matchedStr: halfMillion[0] };
  }
  // 1. Check "X triệu Y" / "X tr Y" (e.g. 1 triệu 500 = 1,500,000)
  const regexTrY = /(\d+(?:\.\d+)?)\s*(?:triệu|tr)\s+(\d{1,3})\b/i;
  const matchTrY = text.match(regexTrY);
  if (matchTrY) {
    const tr = Number(matchTrY[1]);
    let suffix = matchTrY[2];
    if (suffix.length === 1) suffix = suffix + "00";
    if (suffix.length === 2) suffix = suffix + "0";
    return { amount: Math.round(tr * 1000000 + Number(suffix) * 1000), currency: "VND", score: 100, matchedStr: matchTrY[0] };
  }

  // 2. Check "XtrY" no space (e.g. 1tr5 = 1,500,000)
  const regexTrY2 = /(\d+(?:\.\d+)?)tr(\d+)\b/i;
  const matchTrY2 = text.match(regexTrY2);
  if (matchTrY2) {
    const tr = Number(matchTrY2[1]);
    let suffix = matchTrY2[2];
    if (suffix.length === 1) suffix = suffix + "00";
    if (suffix.length === 2) suffix = suffix + "0";
    return { amount: Math.round(tr * 1000000 + Number(suffix) * 1000), currency: "VND", score: 100, matchedStr: matchTrY2[0] };
  }

  // 3. Match generic multipliers (k, nghìn, ngàn, tr, triệu)
  const regexUnit = /(\d+(?:[.,]\d+)?)\s*(k|nghìn|ngàn|tr|triệu|tỷ|tỉ|ty|củ)(?=\s|$|[.,;!?])/i;
  const matchUnit = text.match(regexUnit);
  if (matchUnit) {
    const num = Number(matchUnit[1].replace(/,/g, "."));
    const unit = matchUnit[2].toLowerCase();
    const multiplier = ["tỷ", "tỉ", "ty"].includes(unit) ? 1_000_000_000
      : ["tr", "triệu", "củ"].includes(unit) ? 1_000_000 : 1_000;
    const amount = Math.round(num * multiplier);
    return { amount: Number.isSafeInteger(amount) && amount <= 1_000_000_000_000_000 ? amount : null, currency: "VND", score: 100, matchedStr: matchUnit[0] };
  }

  // 4. Match plain numbers (e.g. 50000, 50.000, 50,000)
  const regexPlain = /\b(\d{1,3}(?:[.,]\d{3})+)\b|\b(\d{4,})\b/g;
  const matches = [...text.matchAll(regexPlain)];
  if (matches.length > 0) {
    const best = matches[0][0];
    const num = Number(best.replace(/[.,]/g, ""));
    return { amount: Number.isSafeInteger(num) && num <= 1_000_000_000_000_000 ? num : null, currency: "VND", score: 90, matchedStr: best };
  }

  return { amount: null, currency: "VND", score: 0, matchedStr: "" };
}

function detectType(text: string): { type: TransactionType | "transfer" | null, score: number, typeMatchedStr: string } {
  const t = text;
  // Transfer indicators (NEVER treat internal transfers as expense)
  const transferPattern = /(?:chuyển|chuyen|rút|rut|nạp|nap)\s+.*?(?:từ|tu)\s+.*?(?:sang|vào|vao|về|ve)|(?:chuyển tiền|chuyen tien|chuyển khoản từ|chuyen khoan tu)|(?:chuyển|chuyen)\s+\d+.*?(?:sang|vào|vao)/i;
  if (transferPattern.test(t)) {
    return { type: "transfer", score: 100, typeMatchedStr: t.match(transferPattern)?.[0] || "chuyển khoản" };
  }

  // Income indicators
  const strongIncome = /(nhận lương|được thưởng|mẹ cho|ba cho|ông cho|bà cho|ba mẹ cho|bố mẹ cho|được cho|được hỗ trợ|hoàn tiền|cashback|được .{1,40} trả lại)/i;
  if (strongIncome.test(t)) {
    return { type: "income", score: 100, typeMatchedStr: t.match(strongIncome)?.[0] || "" };
  }
  if (/\b(lương|thưởng|trợ cấp|nhận tiền|thu nhập)\b/i.test(t)) {
    return { type: "income", score: 70, typeMatchedStr: t.match(/\b(lương|thưởng|trợ cấp|nhận tiền|thu nhập)\b/i)?.[0] || "" };
  }
  // Expense indicators
  if (/\b(mua|đổ|trả|đóng|tiền|chi|ăn|uống|vé|grab|taxi)\b/i.test(t)) {
    return { type: "expense", score: 80, typeMatchedStr: t.match(/\b(mua|đổ|trả|đóng|tiền|chi|ăn|uống|vé|grab|taxi)\b/i)?.[0] || "" };
  }
  return { type: null, score: 0, typeMatchedStr: "" };
}

function detectDate(text: string): { date: Date | null, score: number, dateMatchedStr: string } {
  const t = text;
  const now = new Date();
  if (/\b(hôm qua|tối qua|chiều qua|sáng qua)\b/i.test(t)) {
    const date = new Date(now);
    date.setDate(date.getDate() - 1);
    return { date, score: 100, dateMatchedStr: t.match(/\b(hôm qua|tối qua|chiều qua|sáng qua)\b/i)?.[0] || "" };
  }
  if (/\b(hôm nay|sáng nay|chiều nay|tối nay)\b/i.test(t)) {
    return { date: now, score: 100, dateMatchedStr: t.match(/\b(hôm nay|sáng nay|chiều nay|tối nay)\b/i)?.[0] || "" };
  }
  
  // Match "ngày 10/8" or "10/8"
  const dateRegex = /(?:ngày\s+)?(\d{1,2})\/(\d{1,2})(?:\/(\d{4}))?/i;
  const match = t.match(dateRegex);
  if (match) {
    const day = parseInt(match[1]);
    const month = parseInt(match[2]);
    const year = match[3] ? parseInt(match[3]) : now.getFullYear();
    if (day >= 1 && day <= 31 && month >= 1 && month <= 12 && year >= 2000 && year <= 2100) {
      const date = new Date(year, month - 1, day);
      if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) {
        return { date: null, score: 0, dateMatchedStr: "" };
      }
      return { date, score: 100, dateMatchedStr: match[0] };
    }
  }

  return { date: null, score: 0, dateMatchedStr: "" };
}

function detectWallet(text: string, wallets: Wallet[]): { walletId: string | null, score: number, walletMatchedStr: string } {
  const t = removeAccents(text);
  for (const wallet of wallets) {
    const wName = removeAccents(wallet.name.toLowerCase());
    if (t.includes(wName)) {
      const originalMatch = text.match(new RegExp(escapeRegex(wallet.name), "i"));
      return { walletId: wallet.id, score: 100, walletMatchedStr: originalMatch ? originalMatch[0] : wName };
    }
  }
  if (t.includes("tien mat")) {
    const cashWallet = wallets.find(w => w.type === "cash");
    if (cashWallet) return { walletId: cashWallet.id, score: 90, walletMatchedStr: text.match(/\b(tiền mặt|tien mat)\b/i)?.[0] || "tiền mặt" };
  }
  if (t.includes("ngan hang") || t.includes("bank") || t.includes("tai khoan") || t.includes("chuyen khoan")) {
    const bankWallet = wallets.find(w => w.type === "bank");
    if (bankWallet) return { walletId: bankWallet.id, score: 90, walletMatchedStr: text.match(/\b(ngân hàng|ngan hang|bank|tài khoản|tai khoan|chuyển khoản)\b/i)?.[0] || "ngân hàng" };
  }
  return { walletId: null, score: 0, walletMatchedStr: "" };
}

function detectCategory(text: string, type: TransactionType | null, categories: Category[]): { categoryId: string | null, score: number, catMatchedStr: string } {
  const tNormal = text;
  const tNoAccent = removeAccents(text);
  let bestScore = 0;
  let bestCatId: string | null = null;
  let bestMatchStr = "";

  const rules = type === "income" ? INCOME_RULES : (type === "expense" ? EXPENSE_RULES : [...EXPENSE_RULES, ...INCOME_RULES]);
  
  for (const rule of rules) {
    let currentScore = 0;
    let matched = "";

    // 1. Exact phrase match
    for (const phrase of rule.phrases) {
      if (tNormal.includes(phrase)) {
        const score = phrase.includes(" ") ? 100 : 90;
        if (score > currentScore) {
          currentScore = score;
          matched = phrase;
        }
      } else if (tNoAccent.includes(removeAccents(phrase))) {
        const score = phrase.includes(" ") ? 85 : 75;
        if (score > currentScore) {
          currentScore = score;
          matched = phrase;
        }
      }
    }

    // 2. Prefix phrases (e.g. starts with or has "ăn ...", "uống ...", "mua ...", "đổ xăng ...")
    if (rule.prefixPhrases) {
      for (const prefix of rule.prefixPhrases) {
        if (matchesPrefix(tNormal, prefix)) {
          if (90 > currentScore) {
            currentScore = 90;
            matched = prefix.trim();
          }
        } else if (matchesPrefixNoAccent(tNoAccent, prefix)) {
          if (80 > currentScore) {
            currentScore = 80;
            matched = prefix.trim();
          }
        }
      }
    }

    // 3. Whole-word keyword match
    for (const kw of rule.keywords) {
      if (containsWord(tNormal, kw)) {
        if (85 > currentScore) {
          currentScore = 85;
          matched = kw;
        }
      } else if (containsWordNoAccent(tNoAccent, kw)) {
        if (75 > currentScore) {
          currentScore = 75;
          matched = kw;
        }
      }
    }

    if (currentScore > bestScore) {
      // Find mapping category ID in loaded categories
      let foundCat: Category | undefined;
      for (const matcher of rule.matcher) {
        foundCat = categories.find(c => (!type || c.kind === type) && removeAccents(c.name.toLowerCase()).includes(removeAccents(matcher)));
        if (foundCat) break;
      }
      // Fallback: search without type constraint if not found yet
      if (!foundCat) {
        for (const matcher of rule.matcher) {
          foundCat = categories.find(c => removeAccents(c.name.toLowerCase()).includes(removeAccents(matcher)));
          if (foundCat) break;
        }
      }
      if (foundCat) {
        bestScore = currentScore;
        bestCatId = foundCat.id;
        bestMatchStr = matched;
      }
    }
  }

  // 4. Direct match with any category in user's category list
  for (const cat of categories.filter(c => !type || c.kind === type)) {
    const catNameLower = cat.name.toLowerCase();
    const catNameNoAccent = removeAccents(catNameLower);
    if (tNormal.includes(catNameLower)) {
      if (100 > bestScore) {
        bestScore = 100;
        bestCatId = cat.id;
        bestMatchStr = catNameLower;
      }
    } else if (tNoAccent.includes(catNameNoAccent)) {
      if (90 > bestScore) {
        bestScore = 90;
        bestCatId = cat.id;
        bestMatchStr = catNameLower;
      }
    } else if (containsWord(tNormal, catNameLower)) {
      if (80 > bestScore) {
        bestScore = 80;
        bestCatId = cat.id;
        bestMatchStr = catNameLower;
      }
    }
  }

  return { categoryId: bestCatId, score: bestScore, catMatchedStr: bestMatchStr };
}

function formatMoneyVN(amount: number): string {
  return new Intl.NumberFormat("vi-VN", { style: "currency", currency: "VND", maximumFractionDigits: 0 }).format(amount);
}

export function detectTransferWallets(text: string, wallets: Wallet[]): {
  isTransfer: boolean;
  fromWalletId: string | null;
  toWalletId: string | null;
  fromWalletName: string | null;
  toWalletName: string | null;
} {
  const transferMatch = text.match(/(?:chuyển|chuyen|rút|rut|nạp|nap)\s+.*?(?:từ|tu)\s+(.*?)\s+(?:sang|vào|vao|về|ve)\s+(.*)/i);
  if (!transferMatch) {
    // Alternative: "chuyển 500k sang ngân hàng" or "nạp 500k vào momo"
    const directMatch = text.match(/(?:chuyển|chuyen|nạp|nap)\s+.*?\s+(?:sang|vào|vao|về|ve)\s+(.*)/i);
    if (directMatch) {
      const toW = detectWallet(directMatch[1], wallets);
      return {
        isTransfer: true,
        fromWalletId: null,
        toWalletId: toW.walletId,
        fromWalletName: null,
        toWalletName: wallets.find((w) => w.id === toW.walletId)?.name || null,
      };
    }
    return { isTransfer: false, fromWalletId: null, toWalletId: null, fromWalletName: null, toWalletName: null };
  }

  const fromPart = transferMatch[1];
  const toPart = transferMatch[2];

  const fromW = detectWallet(fromPart, wallets);
  const toW = detectWallet(toPart, wallets);

  return {
    isTransfer: true,
    fromWalletId: fromW.walletId,
    toWalletId: toW.walletId,
    fromWalletName: wallets.find((w) => w.id === fromW.walletId)?.name || null,
    toWalletName: wallets.find((w) => w.id === toW.walletId)?.name || null,
  };
}

export function splitMultiTransactions(text: string): string[] {
  const clauses = text
    .split(/[,;\n]|\s+và\s+/i)
    .map((s) => s.trim())
    .filter(Boolean);
  if (clauses.length <= 1) return [text];

  const clausesWithAmount = clauses.filter((c) => parseVietnameseAmount(c).amount !== null);
  if (clausesWithAmount.length >= 2) {
    return clausesWithAmount;
  }
  return [text];
}

function parseSingleSmartTransaction(text: string, categories: Category[], wallets: Wallet[]): SmartTransactionResult {
  const norm = normalizeVietnameseText(text);

  // Parse amount & currency
  const { amount, currency, score: amountScore, matchedStr: amountStr } = parseVietnameseAmount(norm);
  
  // Parse wallet
  const { walletId, score: walletScore, walletMatchedStr } = detectWallet(norm, wallets);
  
  // Parse date
  const { date, score: dateScore, dateMatchedStr } = detectDate(norm);

  // Remove used tokens to help with type and name extraction
  let leftover = norm;
  if (amountStr) leftover = leftover.replace(amountStr, "");
  if (walletMatchedStr) leftover = leftover.replace(new RegExp(escapeRegex(walletMatchedStr), "i"), "");
  if (dateMatchedStr) leftover = leftover.replace(new RegExp(escapeRegex(dateMatchedStr), "i"), "");
  leftover = leftover.replace(/\s{2,}/g, " ").trim();

  // Parse type
  let { type, score: typeScore } = detectType(norm);

  // Check if transfer
  let isTransfer = false;
  let fromWalletId: string | null = null;
  let toWalletId: string | null = null;
  if (type === "transfer") {
    isTransfer = true;
    type = null;
    const transferWallets = detectTransferWallets(norm, wallets);
    fromWalletId = transferWallets.fromWalletId || walletId;
    toWalletId = transferWallets.toWalletId;
  }

  // Parse category (using full normalized text for better context)
  const { categoryId, score: catScore, catMatchedStr } = detectCategory(norm, isTransfer ? null : type, categories);

  // If a strong category matched but type is unknown, infer type from category
  if (catScore >= 50 && !type && categoryId) {
    const catObj = categories.find((c) => c.id === categoryId);
    if (catObj) {
      type = catObj.kind;
      typeScore = 80;
    }
  }

  // Extract Name
  let name = leftover.replace(/^(tiền|bằng|vào)\s+/i, "").trim();
  if (name.length === 0) {
    if (isTransfer) {
      name = "Chuyển tiền nội bộ";
    } else {
      name = catMatchedStr || (type === "income" ? "Khoản thu" : type === "expense" ? "Khoản chi" : "Giao dịch");
    }
  }
  // Capitalize first letter
  name = name.charAt(0).toUpperCase() + name.slice(1);

  const finalCategoryId = !isTransfer && catScore >= 50 ? categoryId : null;

  // Generate summary text
  const parts: string[] = [];
  if (isTransfer) {
    parts.push("Chuyển tiền");
  } else if (type) {
    parts.push(type === "expense" ? "Khoản chi" : "Khoản thu");
  }
  if (name) parts.push(name);
  if (amount) {
    parts.push(currency === "VND" ? formatMoneyVN(amount) : `${amount} ${currency}`);
  }
  
  if (finalCategoryId) {
    const catName = categories.find((c) => c.id === finalCategoryId)?.name;
    if (catName) parts.push(catName);
  }
  
  if (isTransfer) {
    const fromWName = wallets.find((w) => w.id === fromWalletId)?.name || "Ví nguồn";
    const toWName = wallets.find((w) => w.id === toWalletId)?.name || "Ví đích";
    parts.push(`Từ ${fromWName} sang ${toWName}`);
  } else if (walletScore >= 75 && walletId) {
    const walletName = wallets.find((w) => w.id === walletId)?.name;
    if (walletName) parts.push(walletName);
  }
  
  if (dateScore >= 75 && dateMatchedStr) {
    parts.push(dateMatchedStr.charAt(0).toUpperCase() + dateMatchedStr.slice(1));
  }

  const summaryText = parts.join(" · ");

  return {
    type,
    name,
    amount,
    currency,
    categoryId: finalCategoryId,
    walletId: isTransfer ? fromWalletId : (walletScore >= 75 ? walletId : null),
    date: dateScore >= 75 ? date : null,
    confidence: {
      type: typeScore,
      category: isTransfer ? 100 : catScore,
      amount: amountScore,
      wallet: walletScore,
      date: dateScore,
    },
    summaryText,
    isTransfer,
    fromWalletId,
    toWalletId,
  };
}

export function parseSmartTransaction(text: string, categories: Category[], wallets: Wallet[]): SmartTransactionResult {
  const multiParts = splitMultiTransactions(text);
  if (multiParts.length > 1) {
    const subItems = multiParts.map((part) => parseSingleSmartTransaction(part, categories, wallets));
    const first = subItems[0];
    const names = subItems.map((s) => s.name).join(", ");
    return {
      type: first.type,
      name: names,
      amount: first.amount,
      currency: first.currency,
      categoryId: first.categoryId,
      walletId: first.walletId,
      date: first.date,
      confidence: first.confidence,
      summaryText: `${subItems.length} giao dịch: ${subItems.map((s) => s.summaryText).join(" | ")}`,
      multipleDetected: true,
      subItems,
    };
  }

  return parseSingleSmartTransaction(text, categories, wallets);
}
