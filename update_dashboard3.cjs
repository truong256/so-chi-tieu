const fs = require('fs');
const path = require('path');

const file = path.join(__dirname, 'app/dashboard.tsx');
let content = fs.readFileSync(file, 'utf8');

// 1. Replace modal payload
const saveRecurringOld = `        table = "recurring_transactions"; payload = { ...payload, title: String(form.get("title") || "").trim(), amount, type: recurringType, wallet_id: form.get("walletId") || null, category_id: form.get("categoryId") || null, frequency: form.get("frequency"), next_run_at: new Date(String(form.get("nextRun"))).toISOString(), active: form.get("active") === "on", auto_create: form.get("autoCreate") === "on", note: String(form.get("note") || "").trim() }; `;
const saveRecurringNew = `        table = "recurring_transactions"; payload = { 
          ...payload, 
          title: String(form.get("title") || "").trim(), 
          amount, 
          type: recurringType, 
          wallet_id: form.get("walletId") || null, 
          category_id: form.get("categoryId") || null, 
          frequency: form.get("frequency"), 
          interval: Number(form.get("interval")) || 1,
          start_date: form.get("startDate") ? String(form.get("startDate")) : new Date().toISOString().split('T')[0],
          next_run_at: new Date(String(form.get("nextRun"))).toISOString(), 
          amount_type: form.get("amountType") || "fixed",
          processing_mode: form.get("processingMode") || "remind",
          status: form.get("status") || "active",
          active: form.get("status") === "active",
          auto_create: form.get("processingMode") === "auto",
          note: String(form.get("note") || "").trim() 
        };`;

content = content.replace(saveRecurringOld, saveRecurringNew);

// 2. Replace modal form
const recurringModalOldRegex = /\{modal\?\.kind === "recurring" && <Modal title=\{modal\.item \? "Chỉnh sửa lịch định kỳ" : "Tạo giao dịch định kỳ"\}.+?<\/form><\/Modal>\}/s;
const recurringModalNew = `{modal?.kind === "recurring" && <Modal title={modal.item ? "Chỉnh sửa lịch định kỳ" : "Tạo giao dịch định kỳ"} eyebrow="DÒNG TIỀN LẶP LẠI" onClose={() => setModal(null)}>
  <form onSubmit={event => saveSimple(event, "recurring")}>
    <div className="type-toggle">
      <button type="button" className={recurringType === "expense" ? "active" : ""} onClick={() => setRecurringType("expense")}>Khoản chi</button>
      <button type="button" className={recurringType === "income" ? "active" : ""} onClick={() => setRecurringType("income")}>Khoản thu</button>
    </div>
    <label>Tên giao dịch<input name="title" defaultValue={modal.item?.title} required /></label>
    <div className="form-grid">
      <label>Số tiền<FormattedMoneyInput name="amount" defaultValue={modal.item?.amount} required /></label>
      <label>Loại số tiền<select name="amountType" defaultValue={modal.item?.amount_type ?? "fixed"}>
        <option value="fixed">Cố định</option>
        <option value="estimated">Dự kiến (Biến động)</option>
      </select></label>
    </div>
    <div className="form-grid">
      <label>Danh mục<select name="categoryId" defaultValue={modal.item?.category_id ?? categories.find(item => item.kind === recurringType)?.id}>{categories.filter(item => item.kind === recurringType).map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
      <label>Ví<select name="walletId" defaultValue={modal.item?.wallet_id ?? wallets[0]?.id}>{wallets.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
    </div>
    <div className="form-grid">
      <label>Chu kỳ<select name="frequency" defaultValue={modal.item?.frequency ?? "monthly"}>
        <option value="daily">Hàng ngày</option><option value="weekly">Hàng tuần</option><option value="monthly">Hàng tháng</option><option value="yearly">Hàng năm</option>
      </select></label>
      <label>Cách nhau (VD: 1, 2 tháng)<input name="interval" type="number" min="1" defaultValue={modal.item?.interval ?? 1} required /></label>
    </div>
    <div className="form-grid">
      <label>Ngày bắt đầu<input name="startDate" type="date" defaultValue={modal.item?.start_date ?? new Date().toISOString().split('T')[0]} required /></label>
      <label>Kỳ tiếp theo<input name="nextRun" type="datetime-local" defaultValue={localDateTime(modal.item?.next_run_at ?? new Date())} required /></label>
    </div>
    <div className="form-grid">
      <label>Trạng thái lịch<select name="status" defaultValue={modal.item?.status ?? "active"}>
        <option value="active">Đang hoạt động</option><option value="paused">Tạm dừng</option>
      </select></label>
      <label>Tự động hóa<select name="processingMode" defaultValue={modal.item?.processing_mode ?? "remind"}>
        <option value="remind">Chỉ nhắc nhở</option>
        <option value="confirm">Xác nhận bằng tay</option>
        <option value="auto">Tự động ghi nhận</option>
      </select></label>
    </div>
    <label>Ghi chú<textarea name="note" defaultValue={modal.item?.note} /></label>
    <button className="save-button" disabled={saving}>Lưu lịch định kỳ →</button>
  </form>
</Modal>}`;

content = content.replace(recurringModalOldRegex, recurringModalNew);

// Write to file
fs.writeFileSync(file, content, 'utf8');
console.log("Updated saveRecurringTransaction and modal UI successfully!");
