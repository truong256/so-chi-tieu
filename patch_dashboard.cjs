const fs = require('fs');
const path = require('path');

const file = path.join(__dirname, 'app/dashboard.tsx');
let content = fs.readFileSync(file, 'utf8');

const runAutomationPattern = /if \s*\(runAutomation\)\s*\{\s*let automated\s*=\s*false;\s*for \s*\(const schedule of loadedRecurring\.filter\(item => item\.active && item\.auto_create && new Date\(item\.next_run_at\) <= new Date\(\)\)\)\s*\{[\s\S]*?showNotice\("Đã tự động ghi nhận giao dịch định kỳ đến hạn\."\);\s*\}\s*\}/;
const runAutomationNew = `if (runAutomation) {
        let automated = 0;
        let failedDueToBalance = 0;
        for (const schedule of loadedRecurring.filter((item: RecurringTransaction) => item.status === "active" && item.processing_mode === "auto" && new Date(item.next_run_at) <= new Date())) {
          let currentRunAt = schedule.next_run_at;
          let safeLoopCounter = 0;
          while (new Date(currentRunAt) <= new Date() && safeLoopCounter < 30) {
            safeLoopCounter++;
            const category = loadedCategories.find(item => item.id === schedule.category_id);
            const wallet = loadedWallets.find(w => w.id === schedule.wallet_id);
            
            // balance check for expense
            if (schedule.type === "expense") {
              const currentBalance = wallet ? wallet.balance - wallet.reserved_amount : 0;
              if (currentBalance < schedule.amount) {
                failedDueToBalance++;
                break; // Stop executing this schedule
              }
            }

            const scheduledDate = currentRunAt.split('T')[0];
            const nextRunAt = advanceRecurring(currentRunAt, schedule.frequency, schedule.interval || 1, schedule.month_end_mode || "last_day");
            
            // Insert occurrence to check idempotency
            const { data: occData, error: occError } = await supabase.from("recurring_occurrences").insert({
              user_id: user.id, recurring_transaction_id: schedule.id, scheduled_for: scheduledDate,
              amount: schedule.amount, status: "confirmed"
            }).select("id").single();

            if (occError) {
              if (occError.code === '23505' || occError.message.includes('duplicate')) {
                currentRunAt = nextRunAt;
                continue;
              } else {
                break;
              }
            }

            // Successfully inserted occurrence, now create transaction
            const { data: txData, error: txError } = await supabase.from("transactions").insert({
              user_id: user.id, title: schedule.title, amount: schedule.amount, type: schedule.type,
              category: category?.name ?? (schedule.type === "income" ? "Thu khác" : "Khác"), category_id: schedule.category_id,
              wallet_id: schedule.wallet_id, occurred_at: currentRunAt, note: schedule.note, recurrence_id: schedule.id,
            }).select("id").single();

            if (txData && schedule.wallet_id) {
               await supabase.from("recurring_occurrences").update({ transaction_id: txData.id }).eq("id", occData.id);
            }

            // Update schedule
            await supabase.from("recurring_transactions").update({ next_run_at: nextRunAt, last_processed_at: new Date().toISOString() }).eq("id", schedule.id);

            automated++;
            currentRunAt = nextRunAt;
          }
        }
        if (automated > 0 || failedDueToBalance > 0) {
          const [freshTransactions, freshRecurring, freshWallets] = await Promise.all([
            supabase.from("transactions").select("id,user_id,title,amount,type,category,category_id,wallet_id,occurred_at,note,receipt_path,recurrence_id").order("occurred_at", { ascending: false }).limit(500),
            supabase.from("recurring_transactions").select("id,user_id,wallet_id,category_id,title,amount,type,amount_type,estimated_amount,processing_mode,status,frequency,interval,start_date,end_type,end_date,occurrence_limit,reminder_days,month_end_mode,last_processed_at,next_run_at,active,auto_create,note").order("next_run_at"),
            supabase.from("wallets").select("id,user_id,name,type,balance,reserved_amount,currency,color,icon").order("created_at")
          ]);
          loadedTransactions = (freshTransactions.data ?? []).map((row: Record<string, unknown>) => mapTransaction(row));
          loadedRecurring = (freshRecurring.data ?? []).map((row: Record<string, unknown>) => mapRecurring(row));
          loadedWallets = (freshWallets.data ?? []).map((row: Record<string, unknown>) => mapWallet(row));
          
          if (failedDueToBalance > 0) {
            showNotice(\`Đã tự động ghi nhận \${automated} lịch. Cảnh báo: \${failedDueToBalance} lịch bị hoãn do ví không đủ số dư.\`);
          } else {
            showNotice(\`Đã tự động ghi nhận \${automated} giao dịch định kỳ đến hạn.\`);
          }
        }
      }`;

const createDuePattern = /async function createDueTransaction\(item: RecurringTransaction\) \{[\s\S]*?showNotice\("Đã ghi nhận giao dịch đến hạn\."\);\s*await loadData\(false\);\s*\}/;
const createDueNew = `async function createDueTransaction(item: RecurringTransaction) {
    if (saving) return;
    setSaving(true);
    try {
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

        const scheduledDate = currentRunAt.split('T')[0];
        const nextRunAt = advanceRecurring(currentRunAt, item.frequency, item.interval || 1, item.month_end_mode || "last_day");
        
        // Check Idempotency via recurring_occurrences
        const { data: occData, error: occError } = await supabase.from("recurring_occurrences").insert({
          user_id: user.id, recurring_transaction_id: item.id, scheduled_for: scheduledDate,
          amount: item.amount, status: "confirmed"
        }).select("id").single();

        if (occError) {
          if (occError.code === '23505' || occError.message.includes('duplicate')) {
            currentRunAt = nextRunAt;
            continue;
          } else {
             throw occError;
          }
        }

        // Insert transaction
        const { data: txData, error: txError } = await supabase.from("transactions").insert({ 
          user_id: user.id, title: item.title, amount: item.amount, type: item.type, category: category?.name ?? "Khác", 
          category_id: item.category_id, wallet_id: item.wallet_id, occurred_at: currentRunAt, note: item.note, recurrence_id: item.id 
        }).select("id").single();
        
        if (txError) throw txError;
        
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
      } else {
        showNotice("Giao dịch này đã được xử lý.");
      }
    } catch (err) {
      showNotice(err instanceof Error ? err.message : "Có lỗi xảy ra khi xử lý.");
    } finally {
      setSaving(false);
    }
  }

  async function skipDueTransaction(item: RecurringTransaction) {
    if (saving) return;
    setSaving(true);
    try {
      let currentRunAt = item.next_run_at;
      const scheduledDate = currentRunAt.split('T')[0];
      
      const { error: occError } = await supabase.from("recurring_occurrences").insert({
        user_id: user.id,
        recurring_transaction_id: item.id,
        scheduled_for: scheduledDate,
        amount: item.amount,
        status: 'skipped'
      });

      if (occError && occError.code !== '23505' && !occError.message.includes('duplicate')) {
         throw occError;
      }
      
      const nextRunAt = advanceRecurring(currentRunAt, item.frequency, item.interval || 1, item.month_end_mode || "last_day");
      const { error: updateError } = await supabase.from("recurring_transactions").update({ next_run_at: nextRunAt, last_processed_at: new Date().toISOString() }).eq("id", item.id);
      if (updateError) throw updateError;
      
      showNotice(\`Đã bỏ qua kỳ \${formatDate(currentRunAt, language).split(" ")[0]}.\`);
      await loadData(false);
    } catch (err) {
      showNotice(err instanceof Error ? err.message : "Không thể bỏ qua giao dịch.");
    } finally {
      setSaving(false);
    }
  }`;

const footerPattern = /\{isDue && insufficient && item\.processing_mode !== "auto" && \([\s\S]*?\{item\.status === "active" \? "⏸ Tạm dừng" : "▶ Tiếp tục"\}/;
const footerNew = `{isDue && insufficient && item.processing_mode !== "auto" && (
                          <div style={{display: "flex", gap: "5px", flexWrap: "wrap", marginTop: "10px"}}>
                            <button type="button" className="recurring-due-btn danger" onClick={handleChooseAnotherWallet} style={{flex: 1}}>
                              Đổi ví khác
                            </button>
                            <button type="button" className="recurring-due-btn danger" onClick={() => skipDueTransaction(item)} style={{flex: 1, backgroundColor: "#666", color: "white"}}>
                              Bỏ qua kỳ này
                            </button>
                          </div>
                        )}
                        {/* Secondary Menu / Actions */}
                        <div className="recurring-actions">
                          <button type="button" onClick={() => openModal({ kind: "recurring", item })}>✎ Sửa</button>
                          <button type="button" onClick={async () => {
                              const newStatus = item.status === "active" ? "paused" : "active";
                              let nextRunAt = item.next_run_at;
                              if (newStatus === "active" && new Date(nextRunAt) < new Date()) {
                                 let safeLoop = 0;
                                 while(new Date(nextRunAt) < new Date() && safeLoop < 100) {
                                    nextRunAt = advanceRecurring(nextRunAt, item.frequency, item.interval || 1, item.month_end_mode || "last_day");
                                    safeLoop++;
                                 }
                                 window.alert(\`Lịch định kỳ đã quá hạn. Ngày tiếp theo sẽ được tự động dời tới: \${formatDate(nextRunAt, language)}\`);
                              }
                              await supabase.from("recurring_transactions").update({ status: newStatus, next_run_at: nextRunAt }).eq("id", item.id);
                              await loadData(false);
                          }}>{item.status === "active" ? "⏸ Tạm dừng" : "▶ Tiếp tục"}`;

content = content.replace(runAutomationPattern, runAutomationNew);
content = content.replace(createDuePattern, createDueNew);
content = content.replace(footerPattern, footerNew);

if (!content.includes(runAutomationNew)) console.error("runAutomation failed to replace");
if (!content.includes(createDueNew)) console.error("createDueTransaction failed to replace");
if (!content.includes(footerNew)) console.error("footer failed to replace");

fs.writeFileSync(file, content, 'utf8');
console.log("Patched successfully.");
