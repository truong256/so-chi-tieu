import type { Frequency, Transaction } from "./finance-types";

export function toNumber(value: unknown) {
  const number = Number(value ?? 0);
  return Number.isFinite(number) ? number : 0;
}

export function localDateTime(value: string | Date = new Date()) {
  const date = value instanceof Date ? value : new Date(value);
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 16);
}

export function formatDate(value: string, language: "vi" | "en" = "vi") {
  return new Intl.DateTimeFormat(language === "vi" ? "vi-VN" : "en-SG", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

// Helper to determine the last day of a given month/year
function getLastDayOfMonth(year: number, month: number) {
  return new Date(year, month + 1, 0).getDate();
}

export function advanceRecurring(value: string, frequency: Frequency, interval = 1, monthEndMode: "last_day" | "next_month" = "last_day") {
  const next = new Date(value);
  const now = new Date();
  
  const originalDateStr = value.includes('T') ? value.split('T')[0] : value;
  const targetDay = parseInt(originalDateStr.split('-')[2] || "1", 10);

  do {
    if (frequency === "daily") {
      next.setDate(next.getDate() + interval);
    } else if (frequency === "weekly") {
      next.setDate(next.getDate() + 7 * interval);
    } else if (frequency === "biweekly") {
      next.setDate(next.getDate() + 14 * interval);
    } else if (frequency === "monthly" || frequency === "bimonthly" || frequency === "quarterly" || frequency === "semi-annually" || frequency === "custom") {
      let monthsToAdd = interval;
      if (frequency === "bimonthly") monthsToAdd = 2 * interval;
      if (frequency === "quarterly") monthsToAdd = 3 * interval;
      if (frequency === "semi-annually") monthsToAdd = 6 * interval;
      
      const newMonth = next.getMonth() + monthsToAdd;
      
      // Temporarily set day to 1 to avoid month overflow when setting month
      next.setDate(1); 
      next.setMonth(newMonth);
      
      const actualNewMonth = next.getMonth();
      const actualNewYear = next.getFullYear();
      const lastDayOfNewMonth = getLastDayOfMonth(actualNewYear, actualNewMonth);
      
      if (targetDay > lastDayOfNewMonth) {
        if (monthEndMode === "last_day") {
          next.setDate(lastDayOfNewMonth);
        } else {
          // next_month
          next.setMonth(actualNewMonth + 1);
          next.setDate(1);
        }
      } else {
        next.setDate(targetDay);
      }
    } else if (frequency === "yearly") {
      next.setFullYear(next.getFullYear() + interval);
    }
    
    if (frequency === "custom" || next > now) {
        break;
    }
  } while (false);
  
  return next.toISOString();
}


export function periodBounds(period: "day" | "week" | "month" | "year", offset = 0) {
  const now = new Date();
  let start = new Date(now);
  let end = new Date(now);
  if (period === "day") {
    start = new Date(now.getFullYear(), now.getMonth(), now.getDate() + offset);
    end = new Date(now.getFullYear(), now.getMonth(), now.getDate() + offset + 1);
  }
  if (period === "week") {
    const mondayDistance = (now.getDay() + 6) % 7;
    start = new Date(now.getFullYear(), now.getMonth(), now.getDate() - mondayDistance + offset * 7);
    end = new Date(start);
    end.setDate(end.getDate() + 7);
  }
  if (period === "month") {
    start = new Date(now.getFullYear(), now.getMonth() + offset, 1);
    end = new Date(now.getFullYear(), now.getMonth() + offset + 1, 1);
  }
  if (period === "year") {
    start = new Date(now.getFullYear() + offset, 0, 1);
    end = new Date(now.getFullYear() + offset + 1, 0, 1);
  }
  return { start, end };
}

export function inRange(transaction: Transaction, start: Date, end: Date) {
  const value = new Date(transaction.occurred_at);
  return value >= start && value < end;
}

export function getRelativeTime(dateString: string, language: "vi" | "en" = "vi"): string {
  const now = new Date();
  // Reset time part for accurate day calculation
  now.setHours(0, 0, 0, 0);
  
  const targetDate = new Date(dateString);
  targetDate.setHours(0, 0, 0, 0);
  
  const diffTime = targetDate.getTime() - now.getTime();
  const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
  
  if (diffDays === 0) return language === "vi" ? "Hôm nay" : "Today";
  if (diffDays === 1) return language === "vi" ? "Ngày mai" : "Tomorrow";
  if (diffDays === -1) return language === "vi" ? "Hôm qua" : "Yesterday";
  
  if (diffDays > 1 && diffDays <= 7) return language === "vi" ? `Còn ${diffDays} ngày` : `In ${diffDays} days`;
  if (diffDays < -1) return language === "vi" ? `Quá hạn ${Math.abs(diffDays)} ngày` : `Overdue ${Math.abs(diffDays)} days`;
  
  return formatDate(dateString, language).split(" ")[0]; // just return date part if > 7 days
}
