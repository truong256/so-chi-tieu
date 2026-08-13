const fs = require('fs');
const path = require('path');

const file = path.join(__dirname, 'app/dashboard.tsx');
let content = fs.readFileSync(file, 'utf8');

// 1. Update SELECT queries
content = content.replace(
  /supabase\.from\("recurring_transactions"\)\.select\("id,user_id,wallet_id,category_id,title,amount,type,frequency,next_run_at,active,auto_create,note"\)/g,
  'supabase.from("recurring_transactions").select("id,user_id,wallet_id,category_id,title,amount,type,amount_type,estimated_amount,processing_mode,status,frequency,interval,start_date,end_type,end_date,occurrence_limit,reminder_days,month_end_mode,last_processed_at,next_run_at,active,auto_create,note")'
);

// 3. Replace runAutomation logic
const runAutomationOld = `      if (runAutomation) {
        let automated = false;
        for (const schedule of loadedRecurring.filter((item: RecurringTransaction) => item.active && item.auto_create && new Date(item.next_run_at) <= new Date())) {
          let currentRunAt = schedule.next_run_at;
          let safeLoopCounter = 0;
          while (new Date(currentRunAt) <= new Date() && safeLoopCounter < 30) {
            safeLoopCounter++;
            const nextRunAt = advanceRecurring(currentRunAt, schedule.frequency);
            const { data, error: updateError } = await supabase.from("recurring_transactions")
              .update({ next_run_at: nextRunAt })
              .eq("id", schedule.id)
              .eq("next_run_at", currentRunAt)
              .select("id");

            if (!updateError && data && data.length > 0) {
              const category = loadedCategories.find(item => item.id === schedule.category_id);
              await supabase.from("transactions").insert({
                user_id: user.id, title: schedule.title, amount: schedule.amount, type: schedule.type,
                category: category?.name ?? (schedule.type === "income" ? "Thu khác" : "Khác"), category_id: schedule.category_id,
                wallet_id: schedule.wallet_id, occurred_at: currentRunAt, note: schedule.note, recurrence_id: schedule.id,
              });
              automated = true;
              currentRunAt = nextRunAt;
            } else {
              break;
            }
          }
        }
        if (automated) {
          const [freshTransactions, freshRecurring] = await Promise.all([
            supabase.from("transactions").select("id,user_id,title,amount,type,category,category_id,wallet_id,occurred_at,note,receipt_path,recurrence_id").order("occurred_at", { ascending: false }).limit(500),
            supabase.from("recurring_transactions").select("id,user_id,wallet_id,category_id,title,amount,type,frequency,next_run_at,active,auto_create,note").order("next_run_at"),
          ]);
          loadedTransactions = (freshTransactions.data ?? []).map((row: Record<string, unknown>) => mapTransaction(row));
          loadedRecurring = (freshRecurring.data ?? []).map((row: Record<string, unknown>) => mapRecurring(row));
          showNotice("Đã tự động ghi nhận giao dịch định kỳ đến hạn.");
        }
      }`;

const runAutomationNew = `      if (runAutomation) {
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

            const nextRunAt = advanceRecurring(currentRunAt, schedule.frequency, schedule.interval || 1, schedule.month_end_mode || "last_day");
            
            // Insert occurrence to check idempotency
            const { data: occData, error: occError } = await supabase.from("recurring_occurrences").insert({
              user_id: user.id, recurring_transaction_id: schedule.id, scheduled_for: currentRunAt,
              amount: schedule.amount, status: "confirmed"
            }).select("id").single();

            if (occError) {
              // Already exists (another device processed it or it failed previously)
              // Update next_run_at to bypass this date
              const { data: updateData, error: updateError } = await supabase.from("recurring_transactions")
                 .update({ next_run_at: nextRunAt, last_processed_at: new Date().toISOString() })
                 .eq("id", schedule.id)
                 .eq("next_run_at", currentRunAt)
                 .select("id");
              if (!updateError && updateData && updateData.length > 0) {
                 currentRunAt = nextRunAt;
                 continue;
              }
              break;
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
            supabase.from("wallets").select("id,user_id,name,type,balance,reserved_amount,currency,color,icon")
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

content = content.replace(runAutomationOld, runAutomationNew);

fs.writeFileSync(file, content, 'utf8');
console.log("Updated runAutomation successfully!");
