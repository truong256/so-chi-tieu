import type { Category, TransactionType, Wallet } from "./finance-types";

export type SmartTransactionResult = {
  type: TransactionType | null;
  name: string;
  amount: number | null;
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
};

const EXPENSE_RULES = [
  {
    matcher: ["ăn uống", "ẩm thực"],
    phrases: ["ăn sáng", "ăn trưa", "ăn tối", "ăn chiều", "ăn đêm", "ăn cơm", "bữa sáng", "bữa trưa", "bữa tối", "đồ ăn", "thức ăn", "ăn uống", "uống nước", "trà sữa", "cà phê", "cafe", "coffee", "bánh mì", "cơm gà", "cơm tấm", "đồ ăn vặt", "ăn vặt", "nhậu", "đi ăn"],
    keywords: ["cơm", "phở", "bún", "mì", "ăn"],
  },
  {
    matcher: ["di chuyển", "giao thông"],
    phrases: ["đổ xăng", "tiền xăng", "xăng xe", "mua xăng", "dầu xe", "đổ dầu", "gửi xe", "tiền gửi xe", "bãi xe", "vé xe", "xe buýt", "bus", "taxi", "grab", "be", "xanh sm", "gojek", "vé tàu", "tàu điện", "metro", "vé máy bay", "đi xe", "thuê xe", "sửa xe"],
    keywords: ["xăng", "xe", "tàu"],
  },
  {
    matcher: ["mua sắm"],
    phrases: ["mua áo", "mua quần", "quần áo", "mua đồ", "shopping", "mua hàng", "shopee", "lazada", "tiki"],
    keywords: ["giày", "dép", "túi", "balo"],
  },
  {
    matcher: ["hóa đơn", "tiện ích", "nhà ở"],
    phrases: ["tiền điện", "tiền nước", "internet", "wifi", "tiền mạng", "tiền điện thoại", "nạp điện thoại", "tiền nhà", "tiền thuê nhà"],
    keywords: ["điện", "nước", "gas"],
  },
  {
    matcher: ["giải trí"],
    phrases: ["xem phim", "vé phim", "netflix", "spotify", "chơi game", "nạp game", "karaoke", "du lịch", "vui chơi"],
    keywords: ["game", "phim"],
  },
  {
    matcher: ["sức khỏe", "y tế"],
    phrases: ["mua thuốc", "khám bệnh", "khám sức khỏe", "bệnh viện", "nha khoa", "bác sĩ", "xét nghiệm"],
    keywords: ["thuốc"],
  },
  {
    matcher: ["giáo dục", "học tập"],
    phrases: ["học phí", "tiền học", "khóa học", "mua sách", "sách giáo khoa", "tài liệu", "học thêm", "học tiếng anh"],
    keywords: ["sách", "học"],
  }
];

const INCOME_RULES = [
  {
    matcher: ["lương", "thu nhập"],
    phrases: ["nhận lương", "lương tháng", "lương tháng này", "tiền lương"],
    keywords: ["lương"],
  },
  {
    matcher: ["thưởng"],
    phrases: ["được thưởng", "thưởng tết", "thưởng dự án", "tiền thưởng"],
    keywords: ["thưởng", "bonus"],
  },
  {
    matcher: ["trợ cấp", "hỗ trợ", "thu khác"],
    phrases: ["ba cho", "mẹ cho", "ông cho", "bà cho", "ba mẹ cho", "được cho", "trợ cấp", "nhận tiền"],
    keywords: ["cho", "biếu", "tặng"],
  }
];

export function normalizeVietnameseText(text: string): string {
  // Keep original letters but make lowercase and collapse spaces
  return text.toLowerCase().trim().replace(/\s{2,}/g, " ");
}

function removeAccents(str: string): string {
  return str.normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/đ/g, "d").replace(/Đ/g, "D");
}

function parseAmount(text: string): { amount: number | null, score: number, matchedStr: string } {
  // Match "1 triệu 500", "1tr5", "1.5 triệu", "50 nghìn", "50k", "50,000", "50000"
  
  // 1. Check "X triệu Y" / "X tr Y" (e.g. 1 triệu 500 = 1,500,000)
  const regexTrY = /(\d+(?:\.\d+)?)\s*(?:triệu|tr)\s+(\d{1,3})\b/i;
  const matchTrY = text.match(regexTrY);
  if (matchTrY) {
    const tr = Number(matchTrY[1]);
    let suffix = matchTrY[2];
    // if "500" -> 500,000. If "5" -> 500,000.
    if (suffix.length === 1) suffix = suffix + "00";
    if (suffix.length === 2) suffix = suffix + "0";
    return { amount: Math.round(tr * 1000000 + Number(suffix) * 1000), score: 100, matchedStr: matchTrY[0] };
  }

  // 2. Check "XtrY" no space (e.g. 1tr5 = 1,500,000)
  const regexTrY2 = /(\d+(?:\.\d+)?)tr(\d+)\b/i;
  const matchTrY2 = text.match(regexTrY2);
  if (matchTrY2) {
    const tr = Number(matchTrY2[1]);
    let suffix = matchTrY2[2];
    if (suffix.length === 1) suffix = suffix + "00";
    if (suffix.length === 2) suffix = suffix + "0";
    return { amount: Math.round(tr * 1000000 + Number(suffix) * 1000), score: 100, matchedStr: matchTrY2[0] };
  }

  // 3. Match generic multipliers (k, nghìn, ngàn, tr, triệu)
  const regexUnit = /(\d+(?:[.,]\d+)?)\s*(k|nghìn|ngàn|tr|triệu)\b/i;
  const matchUnit = text.match(regexUnit);
  if (matchUnit) {
    const num = Number(matchUnit[1].replace(/,/g, "."));
    const unit = matchUnit[2].toLowerCase();
    const multiplier = (unit === "tr" || unit === "triệu") ? 1000000 : 1000;
    return { amount: Math.round(num * multiplier), score: 100, matchedStr: matchUnit[0] };
  }

  // 4. Match plain numbers (e.g. 50000, 50.000, 50,000)
  const regexPlain = /\b(\d{1,3}(?:[.,]\d{3})+)\b|\b(\d{4,})\b/g;
  let matches = [...text.matchAll(regexPlain)];
  if (matches.length > 0) {
    const best = matches[0][0]; // First large number
    const num = Number(best.replace(/[.,]/g, ""));
    return { amount: num, score: 90, matchedStr: best };
  }

  return { amount: null, score: 0, matchedStr: "" };
}

function detectType(text: string): { type: TransactionType | null, score: number, typeMatchedStr: string } {
  const t = text;
  // Income indicators
  if (/\b(nhận lương|được thưởng|mẹ cho|ba cho|ông cho|bà cho|được cho|được hỗ trợ)\b/.test(t)) {
    return { type: "income", score: 100, typeMatchedStr: t.match(/\b(nhận lương|được thưởng|mẹ cho|ba cho|ông cho|bà cho|được cho|được hỗ trợ)\b/)?.[0] || "" };
  }
  if (/\b(lương|thưởng|trợ cấp|nhận tiền|thu nhập)\b/.test(t)) {
    return { type: "income", score: 70, typeMatchedStr: t.match(/\b(lương|thưởng|trợ cấp|nhận tiền|thu nhập)\b/)?.[0] || "" };
  }
  // Expense indicators
  if (/\b(mua|đổ|trả|đóng|tiền|chi|ăn|uống|vé|grab|taxi)\b/.test(t)) {
    return { type: "expense", score: 80, typeMatchedStr: t.match(/\b(mua|đổ|trả|đóng|tiền|chi|ăn|uống|vé|grab|taxi)\b/)?.[0] || "" };
  }
  return { type: null, score: 0, typeMatchedStr: "" };
}

function detectDate(text: string): { date: Date | null, score: number, dateMatchedStr: string } {
  const t = text;
  const now = new Date();
  if (/\b(hôm qua|tối qua|chiều qua|sáng qua)\b/.test(t)) {
    const date = new Date(now);
    date.setDate(date.getDate() - 1);
    return { date, score: 100, dateMatchedStr: t.match(/\b(hôm qua|tối qua|chiều qua|sáng qua)\b/)?.[0] || "" };
  }
  if (/\b(hôm nay|sáng nay|chiều nay|tối nay)\b/.test(t)) {
    return { date: now, score: 100, dateMatchedStr: t.match(/\b(hôm nay|sáng nay|chiều nay|tối nay)\b/)?.[0] || "" };
  }
  
  // Match "ngày 10/8"
  const dateRegex = /ngày\s+(\d{1,2})\/(\d{1,2})/i;
  const match = t.match(dateRegex);
  if (match) {
    const day = parseInt(match[1]);
    const month = parseInt(match[2]);
    const date = new Date(now.getFullYear(), month - 1, day);
    return { date, score: 100, dateMatchedStr: match[0] };
  }

  return { date: null, score: 0, dateMatchedStr: "" };
}

function detectWallet(text: string, wallets: Wallet[]): { walletId: string | null, score: number, walletMatchedStr: string } {
  const t = removeAccents(text);
  for (const wallet of wallets) {
    const wName = removeAccents(wallet.name.toLowerCase());
    if (t.includes(wName)) {
      // Find original string that matched
      const originalMatch = text.match(new RegExp(wallet.name, "i"));
      return { walletId: wallet.id, score: 100, walletMatchedStr: originalMatch ? originalMatch[0] : wName };
    }
  }
  if (t.includes("tien mat")) {
    const cashWallet = wallets.find(w => w.type === "cash");
    if (cashWallet) return { walletId: cashWallet.id, score: 90, walletMatchedStr: text.match(/\b(tiền mặt|tien mat)\b/i)?.[0] || "tiền mặt" };
  }
  if (t.includes("ngan hang") || t.includes("bank") || t.includes("tai khoan")) {
    const bankWallet = wallets.find(w => w.type === "bank");
    if (bankWallet) return { walletId: bankWallet.id, score: 90, walletMatchedStr: text.match(/\b(ngân hàng|ngan hang|bank|tài khoản|tai khoan)\b/i)?.[0] || "ngân hàng" };
  }
  return { walletId: null, score: 0, walletMatchedStr: "" };
}

function detectCategory(text: string, type: TransactionType | null, categories: Category[]): { categoryId: string | null, score: number, catMatchedStr: string } {
  const tNormal = text;
  const tNoAccent = removeAccents(text);
  let bestScore = 0;
  let bestCatId: string | null = null;
  let bestMatchStr = "";

  const rules = type === "income" ? INCOME_RULES : EXPENSE_RULES;
  
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
          matched = phrase; // rough approximation
        }
      }
    }

    // 2. Keyword match
    if (currentScore === 0) {
      for (const kw of rule.keywords) {
        if (tNormal.includes(kw)) {
          if (50 > currentScore) { currentScore = 50; matched = kw; }
        } else if (tNoAccent.includes(removeAccents(kw))) {
          if (40 > currentScore) { currentScore = 40; matched = kw; }
        }
      }
    }

    if (currentScore > bestScore) {
      // Find mapping category ID
      // Match by rule's matchers against actual category names
      let foundCat: Category | undefined;
      for (const matcher of rule.matcher) {
        foundCat = categories.find(c => c.kind === (type || "expense") && removeAccents(c.name.toLowerCase()).includes(removeAccents(matcher)));
        if (foundCat) break;
      }
      if (foundCat) {
        bestScore = currentScore;
        bestCatId = foundCat.id;
        bestMatchStr = matched;
      }
    }
  }

  // Fallback: Check if user literally typed the exact name of a category
  if (bestScore < 70) {
    for (const cat of categories.filter(c => c.kind === (type || "expense"))) {
      if (tNormal.includes(cat.name.toLowerCase())) {
        bestScore = 100;
        bestCatId = cat.id;
        bestMatchStr = cat.name.toLowerCase();
        break;
      }
    }
  }

  return { categoryId: bestCatId, score: bestScore, catMatchedStr: bestMatchStr };
}

function formatMoneyVN(amount: number): string {
  return new Intl.NumberFormat("vi-VN", { style: "currency", currency: "VND", maximumFractionDigits: 0 }).format(amount);
}

export function parseSmartTransaction(text: string, categories: Category[], wallets: Wallet[]): SmartTransactionResult {
  const norm = normalizeVietnameseText(text);

  // Parse amount
  const { amount, score: amountScore, matchedStr: amountStr } = parseAmount(norm);
  
  // Parse wallet
  const { walletId, score: walletScore, walletMatchedStr } = detectWallet(norm, wallets);
  
  // Parse date
  const { date, score: dateScore, dateMatchedStr } = detectDate(norm);

  // Remove used tokens to help with type and name extraction
  let leftover = norm;
  if (amountStr) leftover = leftover.replace(amountStr, "");
  if (walletMatchedStr) leftover = leftover.replace(new RegExp(walletMatchedStr, "i"), "");
  if (dateMatchedStr) leftover = leftover.replace(new RegExp(dateMatchedStr, "i"), "");
  leftover = leftover.replace(/\s{2,}/g, " ").trim();

  // Parse type
  let { type, score: typeScore } = detectType(leftover);
  // Default to expense if completely unknown and no other signals but has amount
  if (!type && amountScore > 0) {
    type = "expense";
    typeScore = 40; // low confidence default
  }

  // Parse category (using full normalized text for better context)
  const { categoryId, score: catScore, catMatchedStr } = detectCategory(norm, type, categories);

  // If a strong category matched but type is unknown, infer type
  if (catScore >= 75 && !type && categoryId) {
    const catObj = categories.find(c => c.id === categoryId);
    if (catObj) {
      type = catObj.kind;
      typeScore = 80;
    }
  }

  // Extract Name (Remove category match string if it's identical, otherwise clean up)
  // E.g. "đổ xăng" is matchedStr, we want Name = "Đổ xăng"
  // But wait! If the user types "đổ xăng", the name SHOULD be "Đổ xăng".
  // If we remove it, name is empty.
  // Instead, the name is the `leftover` text, capitalized.
  // We should remove useless connector words like "tiền", "bằng", "vào"
  let name = leftover.replace(/^(tiền|bằng|vào)\s+/i, "").trim();
  if (name.length === 0) {
    // If empty after stripping, use the category match string as the name
    name = catMatchedStr || (type === "income" ? "Khoản thu" : "Khoản chi");
  }
  // Capitalize first letter
  name = name.charAt(0).toUpperCase() + name.slice(1);

  // Generate success text
  const parts: string[] = [];
  if (type) parts.push(type === "expense" ? "Khoản chi" : "Khoản thu");
  if (name) parts.push(name);
  if (amount) parts.push(formatMoneyVN(amount));
  
  if (catScore >= 75 && categoryId) {
    const catName = categories.find(c => c.id === categoryId)?.name;
    if (catName) parts.push(catName);
  }
  
  if (walletScore >= 75 && walletId) {
    const walletName = wallets.find(w => w.id === walletId)?.name;
    if (walletName) parts.push(walletName);
  }
  
  if (dateScore >= 75 && dateMatchedStr) {
    // Just display what was recognized
    parts.push(dateMatchedStr.charAt(0).toUpperCase() + dateMatchedStr.slice(1));
  }

  const summaryText = parts.join(" · ");

  return {
    type,
    name,
    amount,
    categoryId: catScore >= 75 ? categoryId : null,
    walletId: walletScore >= 75 ? walletId : null,
    date: dateScore >= 75 ? date : null,
    confidence: {
      type: typeScore,
      category: catScore,
      amount: amountScore,
      wallet: walletScore,
      date: dateScore,
    },
    summaryText
  };
}
