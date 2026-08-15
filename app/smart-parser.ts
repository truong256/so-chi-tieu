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

function parseAmount(text: string): { amount: number | null, score: number, matchedStr: string } {
  // 1. Check "X triệu Y" / "X tr Y" (e.g. 1 triệu 500 = 1,500,000)
  const regexTrY = /(\d+(?:\.\d+)?)\s*(?:triệu|tr)\s+(\d{1,3})\b/i;
  const matchTrY = text.match(regexTrY);
  if (matchTrY) {
    const tr = Number(matchTrY[1]);
    let suffix = matchTrY[2];
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
  const matches = [...text.matchAll(regexPlain)];
  if (matches.length > 0) {
    const best = matches[0][0];
    const num = Number(best.replace(/[.,]/g, ""));
    return { amount: num, score: 90, matchedStr: best };
  }

  return { amount: null, score: 0, matchedStr: "" };
}

function detectType(text: string): { type: TransactionType | null, score: number, typeMatchedStr: string } {
  const t = text;
  // Income indicators
  if (/\b(nhận lương|được thưởng|mẹ cho|ba cho|ông cho|bà cho|ba mẹ cho|bố mẹ cho|được cho|được hỗ trợ)\b/i.test(t)) {
    return { type: "income", score: 100, typeMatchedStr: t.match(/\b(nhận lương|được thưởng|mẹ cho|ba cho|ông cho|bà cho|ba mẹ cho|bố mẹ cho|được cho|được hỗ trợ)\b/i)?.[0] || "" };
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
  const dateRegex = /(?:ngày\s+)?(\d{1,2})\/(\d{1,2})/i;
  const match = t.match(dateRegex);
  if (match) {
    const day = parseInt(match[1]);
    const month = parseInt(match[2]);
    if (day >= 1 && day <= 31 && month >= 1 && month <= 12) {
      const date = new Date(now.getFullYear(), month - 1, day);
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
      const originalMatch = text.match(new RegExp(wallet.name, "i"));
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
    typeScore = 40;
  }

  // Parse category (using full normalized text for better context)
  const { categoryId, score: catScore, catMatchedStr } = detectCategory(norm, type, categories);

  // If a strong category matched but type is unknown, infer type from category
  if (catScore >= 50 && !type && categoryId) {
    const catObj = categories.find(c => c.id === categoryId);
    if (catObj) {
      type = catObj.kind;
      typeScore = 80;
    }
  }

  // Extract Name
  let name = leftover.replace(/^(tiền|bằng|vào)\s+/i, "").trim();
  if (name.length === 0) {
    name = catMatchedStr || (type === "income" ? "Khoản thu" : "Khoản chi");
  }
  // Capitalize first letter
  name = name.charAt(0).toUpperCase() + name.slice(1);

  const finalCategoryId = catScore >= 50 ? categoryId : null;

  // Generate summary text
  const parts: string[] = [];
  if (type) parts.push(type === "expense" ? "Khoản chi" : "Khoản thu");
  if (name) parts.push(name);
  if (amount) parts.push(formatMoneyVN(amount));
  
  if (finalCategoryId) {
    const catName = categories.find(c => c.id === finalCategoryId)?.name;
    if (catName) parts.push(catName);
  }
  
  if (walletScore >= 75 && walletId) {
    const walletName = wallets.find(w => w.id === walletId)?.name;
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
    categoryId: finalCategoryId,
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

