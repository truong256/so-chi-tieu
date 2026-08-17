const fs = require('fs');
const path = require('path');

const file = path.join(__dirname, 'app/dashboard.tsx');
let content = fs.readFileSync(file, 'utf8');

const stateRegex = /const \[recurring, setRecurring\] = useState<RecurringTransaction\[\]>\(\[\]\);/;
if (!content.includes('const [recurringFilterType, setRecurringFilterType]')) {
  content = content.replace(stateRegex, `const [recurring, setRecurring] = useState<RecurringTransaction[]>([]);
  const [recurringFilterType, setRecurringFilterType] = useState<"all" | "income" | "expense">("all");
  const [recurringFilterStatus, setRecurringFilterStatus] = useState<"all" | "active" | "paused" | "due" | "overdue">("all");`);
}

// Ensure getRelativeTime is imported if needed, but it's in finance-utils.ts
const importRegex = /import \{ (.+?) \} from "\.\/finance-utils";/;
content = content.replace(importRegex, (match, p1) => {
  if (!p1.includes('getRelativeTime')) {
    return `import { ${p1}, getRelativeTime } from "./finance-utils";`;
  }
  return match;
});

// Update the entire view === "recurring" block
const recurringViewOldRegex = /\{view === "recurring" && \(\s*<section className="recurring-main-card">.+?<\/section>\s*\)\}/s;

const recurringViewNew = `{view === "recurring" && (
          <section className="recurring-main-card">
            
            {/* Top Overview */}
            <div className="recurring-stats">
               <div className="recurring-stat-box">
                 <span className="stat-label">Hoạt động</span>
                 <b className="stat-value">{recurring.filter(r => r.status === "active").length}</b>
               </div>
               <div className="recurring-stat-box warning">
                 <span className="stat-label">Sắp đến hạn</span>
                 <b className="stat-value">{recurring.filter(r => r.status === "active" && new Date(r.next_run_at) <= new Date(Date.now() + 3*24*60*60*1000) && new Date(r.next_run_at) > new Date()).length}</b>
               </div>
               <div className="recurring-stat-box danger">
                 <span className="stat-label">Quá hạn</span>
                 <b className="stat-value">{recurring.filter(r => r.status === "active" && new Date(r.next_run_at) <= new Date()).length}</b>
               </div>
            </div>

            {/* Filters & Actions */}
            <div className="recurring-toolbar">
              <div className="recurring-filters">
                 <select value={recurringFilterType} onChange={e => setRecurringFilterType(e.target.value as any)}>
                   <option value="all">Tất cả loại</option>
                   <option value="income">Khoản thu</option>
                   <option value="expense">Khoản chi</option>
                 </select>
                 <select value={recurringFilterStatus} onChange={e => setRecurringFilterStatus(e.target.value as any)}>
                   <option value="all">Mọi trạng thái</option>
                   <option value="active">Đang hoạt động</option>
                   <option value="paused">Tạm dừng</option>
                   <option value="due">Sắp đến hạn</option>
                   <option value="overdue">Quá hạn</option>
                 </select>
              </div>
              <button type="button" className="recurring-create-btn" onClick={() => openModal({ kind: "recurring" })}>
                 <b>＋</b> Tạo lịch
              </button>
            </div>

            {recurring.length > 0 ? (
              <section className="recurring-grid">
                {recurring.filter(item => {
                  if (recurringFilterType !== "all" && item.type !== recurringFilterType) return false;
                  if (recurringFilterStatus === "active" && item.status !== "active") return false;
                  if (recurringFilterStatus === "paused" && item.status !== "paused") return false;
                  
                  const dueTime = new Date(item.next_run_at).getTime() - Date.now();
                  const isOverdue = dueTime <= 0;
                  const isDueSoon = dueTime > 0 && dueTime <= 3 * 24 * 60 * 60 * 1000;
                  
                  if (recurringFilterStatus === "due" && !isDueSoon) return false;
                  if (recurringFilterStatus === "overdue" && !isOverdue) return false;
                  return true;
                }).map(item => {
                  const isDue = item.status === "active" && new Date(item.next_run_at) <= new Date();
                  const category = categoryById.get(item.category_id ?? "");
                  const wallet = walletById.get(item.wallet_id ?? "");
                  
                  // Check balance
                  let insufficient = false;
                  if (isDue && item.type === "expense") {
                    const currentBalance = wallet ? wallet.balance - wallet.reserved_amount : 0;
                    if (currentBalance < item.amount) insufficient = true;
                  }

                  return (
                    <article className={\`recurring-card \${isDue ? "due" : ""} \${item.status === "paused" ? "paused" : ""} \${insufficient ? "insufficient" : ""}\`} key={item.id}>
                      <div className="recurring-card-header">
                        <span className={\`recurring-card-type-icon \${item.type}\`}>
                          {category?.icon ?? (item.type === "income" ? "↙" : "↗")}
                        </span>
                        <div className="recurring-card-info">
                          <b>{item.title}</b>
                          <small>{category?.name ?? "Chưa chọn danh mục"} · {wallet?.name ?? "Chưa chọn ví"}</small>
                        </div>
                        <span className={\`recurring-status-badge \${item.status}\`}>
                          {item.status === "active" ? "Đang bật" : "Tạm dừng"}
                        </span>
                      </div>

                      <div className="recurring-card-amount">
                        {item.type === "expense" ? "−" : "+"}{money(item.amount)}
                        {item.amount_type === "estimated" && <span className="est-badge">Dự kiến</span>}
                      </div>

                      <div className="recurring-card-next">
                        Kỳ tiếp theo: <b className={isDue ? "danger-text" : ""}>{getRelativeTime(item.next_run_at, language)}</b>
                        <br />
                        <small>{formatDate(item.next_run_at, language)}</small>
                      </div>

                      <div className="recurring-card-tags">
                        <span className="recurring-tag">
                          {item.interval > 1 ? \`Mỗi \${item.interval} \` : "Hàng "}
                          {item.frequency === "daily" ? "ngày" : item.frequency === "weekly" ? "tuần" : item.frequency === "monthly" ? "tháng" : "năm"}
                        </span>
                        <span className="recurring-tag">
                          {item.processing_mode === "auto" ? "Tự động" : item.processing_mode === "confirm" ? "Xác nhận tay" : "Nhắc nhở"}
                        </span>
                      </div>

                      <footer className="recurring-card-footer">
                        {isDue && insufficient && (
                          <div className="insufficient-warning">⚠ Không đủ số dư ví</div>
                        )}
                        {isDue && !insufficient && item.processing_mode !== "auto" && (
                          <button type="button" className="recurring-due-btn" onClick={() => createDueTransaction(item)}>
                            Ghi nhận ngay
                          </button>
                        )}
                        {isDue && insufficient && item.processing_mode !== "auto" && (
                          <button type="button" className="recurring-due-btn danger" onClick={() => createDueTransaction(item)}>
                            Ghi nhận (Sẽ lỗi)
                          </button>
                        )}
                        {/* Secondary Menu / Actions */}
                        <div className="recurring-actions">
                          <button type="button" onClick={() => openModal({ kind: "recurring", item })}>✎ Sửa</button>
                          <button type="button" onClick={async () => {
                              const newStatus = item.status === "active" ? "paused" : "active";
                              await supabase.from("recurring_transactions").update({ status: newStatus }).eq("id", item.id);
                              await loadData(false);
                          }}>{item.status === "active" ? "⏸ Tạm dừng" : "▶ Tiếp tục"}</button>
                          <button type="button" className="danger-text" onClick={() => remove("recurring_transactions", item.id, item.title)}>🗑 Xóa</button>
                        </div>
                      </footer>
                    </article>
                  );
                })}
              </section>
            ) : (
              <div className="recurring-empty-box">
                <div className="empty-plus-circle">＋</div>
                <p className="recurring-empty-text">Chưa có giao dịch định kỳ nào.</p>
              </div>
            )}
          </section>
        )}`;

content = content.replace(recurringViewOldRegex, recurringViewNew);

fs.writeFileSync(file, content, 'utf8');
console.log("Updated recurring view layout successfully!");
