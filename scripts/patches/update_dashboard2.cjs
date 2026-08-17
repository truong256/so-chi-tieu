const fs = require('fs');
const path = require('path');

const file = path.join(__dirname, 'app/dashboard.tsx');
let content = fs.readFileSync(file, 'utf8');

const createDueOld = `  async function createDueTransaction(item: RecurringTransaction) {
    const category = categoryById.get(item.category_id ?? "");
    let currentRunAt = item.next_run_at;
    let safeLoopCounter = 0;
    let createdCount = 0;

    while (new Date(currentRunAt) <= new Date() && safeLoopCounter < 30) {
      safeLoopCounter++;
      const nextRunAt = advanceRecurring(currentRunAt, item.frequency);
      const { data, error: updateError } = await supabase.from("recurring_transactions")
        .update({ next_run_at: nextRunAt })
        .eq("id", item.id)
        .eq("next_run_at", currentRunAt)
        .select("id");

      if (updateError || !data || data.length === 0) {
        if (createdCount === 0) {
          return showNotice("Giao dịch này đã được xử lý (có thể từ thiết bị khác). Vui lòng tải lại trang.");
        }
        break; // Stop if another device already processed this tick
      }

      const { error } = await supabase.from("transactions").insert({ user_id: user.id, title: item.title, amount: item.amount, type: item.type, category: category?.name ?? "Khác", category_id: item.category_id, wallet_id: item.wallet_id, occurred_at: currentRunAt, note: item.note, recurrence_id: item.id });
      if (error) return showNotice(error.message);
      
      currentRunAt = nextRunAt;
      createdCount++;
    }

    if (createdCount > 0) {
      showNotice(\`Đã ghi nhận \${createdCount} giao dịch đến hạn.\`); await loadData(false);
    }
  }`;

const createDueNew = `  async function createDueTransaction(item: RecurringTransaction) {
    const category = categoryById.get(item.category_id ?? "");
    const wallet = walletById.get(item.wallet_id ?? "");
    let currentRunAt = item.next_run_at;
    let safeLoopCounter = 0;
    let createdCount = 0;
    let failedCount = 0;

    while (new Date(currentRunAt) <= new Date() && safeLoopCounter < 30) {
      safeLoopCounter++;
      
      // Balance check
      if (item.type === "expense") {
        const currentBalance = wallet ? wallet.balance - wallet.reserved_amount : 0;
        if (currentBalance < item.amount) {
          failedCount++;
          break; // Stop executing this schedule if balance is not enough
        }
      }

      const nextRunAt = advanceRecurring(currentRunAt, item.frequency, item.interval || 1, item.month_end_mode || "last_day");
      
      // Check Idempotency via recurring_occurrences
      const { data: occData, error: occError } = await supabase.from("recurring_occurrences").insert({
        user_id: user.id, recurring_transaction_id: item.id, scheduled_for: currentRunAt,
        amount: item.amount, status: "confirmed"
      }).select("id").single();

      if (occError) {
        const { data, error: updateError } = await supabase.from("recurring_transactions")
          .update({ next_run_at: nextRunAt, last_processed_at: new Date().toISOString() })
          .eq("id", item.id)
          .eq("next_run_at", currentRunAt)
          .select("id");
          
        if (updateError || !data || data.length === 0) {
          if (createdCount === 0) {
            return showNotice("Giao dịch này đã được xử lý (có thể từ thiết bị khác). Vui lòng tải lại trang.");
          }
          break;
        }
        currentRunAt = nextRunAt;
        continue;
      }

      // Insert transaction
      const { data: txData, error: txError } = await supabase.from("transactions").insert({ 
        user_id: user.id, title: item.title, amount: item.amount, type: item.type, category: category?.name ?? "Khác", 
        category_id: item.category_id, wallet_id: item.wallet_id, occurred_at: currentRunAt, note: item.note, recurrence_id: item.id 
      }).select("id").single();
      
      if (txError) return showNotice(txError.message);
      
      if (txData && item.wallet_id) {
         await supabase.from("recurring_occurrences").update({ transaction_id: txData.id }).eq("id", occData.id);
      }
      
      // Update next_run_at
      await supabase.from("recurring_transactions").update({ next_run_at: nextRunAt, last_processed_at: new Date().toISOString() }).eq("id", item.id);
      
      currentRunAt = nextRunAt;
      createdCount++;
    }

    if (createdCount > 0 || failedCount > 0) {
      if (failedCount > 0 && createdCount === 0) {
        showNotice("Ví không đủ số dư khả dụng để ghi nhận giao dịch định kỳ này.");
      } else if (failedCount > 0) {
        showNotice(\`Đã ghi nhận \${createdCount} kỳ. Không đủ số dư cho kỳ tiếp theo.\`);
      } else {
        showNotice(\`Đã ghi nhận \${createdCount} giao dịch đến hạn.\`); 
      }
      await loadData(false);
    }
  }`;

content = content.replace(createDueOld, createDueNew);

fs.writeFileSync(file, content, 'utf8');
console.log("Updated createDueTransaction successfully!");
