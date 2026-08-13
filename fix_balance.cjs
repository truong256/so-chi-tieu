const fs = require('fs');
const path = require('path');
const file = path.join(__dirname, 'app/dashboard.tsx');
let content = fs.readFileSync(file, 'utf8');

// 1. Fix loadData
const loadDataPattern = /let loadedTransactions = \(transactionResult\.data \?\? \[\]\)\.map\(\(row: Record<string, unknown>\) => mapTransaction\(row\)\);\s*let loadedRecurring = \(recurringResult\.data \?\? \[\]\)\.map\(\(row: Record<string, unknown>\) => mapRecurring\(row\)\);/;
const loadDataReplacement = `let loadedTransactions = (transactionResult.data ?? []).map((row: Record<string, unknown>) => mapTransaction(row));
      let loadedRecurring = (recurringResult.data ?? []).map((row: Record<string, unknown>) => mapRecurring(row));
      let loadedTransfers = (transferResult.data ?? []).map((row: Record<string, unknown>) => mapTransfer(row));
      let loadedBudgets = (budgetResult.data ?? []).map((row: Record<string, unknown>) => mapBudget(row));
      let loadedGoals = (goalResult.data ?? []).map((row: Record<string, unknown>) => mapGoal(row));

      const getAvail = (wId: string) => {
         const w = loadedWallets.find(x => x.id === wId);
         if (!w) return 0;
         let bal = w.balance;
         loadedTransactions.forEach(t => {
            let act = t.wallet_id;
            if (!act && t.payment_source_type === "budget" && t.budget_id) act = loadedBudgets.find(b => b.id === t.budget_id)?.source_wallet_id ?? null;
            if (act === wId) bal += (t.type === "income" ? t.amount : -t.amount);
         });
         loadedTransfers.forEach(t => {
            if (t.from_wallet_id === wId) bal -= t.amount;
            if (t.to_wallet_id === wId) bal += t.amount;
         });
         let res = 0;
         loadedBudgets.forEach(b => { if (b.source_wallet_id === wId && b.remaining_amount > 0 && b.status === "active") res += b.remaining_amount; });
         loadedGoals.forEach(g => { if (g.source_wallet_id === wId && g.reserved_in_wallet > 0) res += g.reserved_in_wallet; });
         return bal - res;
      };`;
content = content.replace(loadDataPattern, loadDataReplacement);

const runAutoPattern = /\/\/ balance check for expense\s*if \(schedule\.type === "expense"\) \{\s*const currentBalance = wallet \? wallet\.balance - wallet\.reserved_amount : 0;\s*if \(currentBalance < schedule\.amount\) \{/g;
const runAutoReplacement = `// balance check for expense
            if (schedule.type === "expense") {
              const currentBalance = getAvail(schedule.wallet_id ?? "");
              if (currentBalance < schedule.amount) {`;
content = content.replace(runAutoPattern, runAutoReplacement);


// 2. Fix createDueTransaction
const createDuePattern = /\/\/ Balance check\s*if \(item\.type === "expense"\) \{\s*const currentBalance = wallet \? wallet\.balance - wallet\.reserved_amount : 0;\s*if \(currentBalance < item\.amount\) \{/g;
const createDueReplacement = `// Balance check
        if (item.type === "expense") {
          const currentBalance = availableBalances.get(item.wallet_id ?? "") ?? 0;
          if (currentBalance < item.amount) {`;
content = content.replace(createDuePattern, createDueReplacement);

// 3. Fix UI rendering
const uiPattern = /let insufficient = false;\s*if \(isDue && item\.type === "expense"\) \{\s*const currentBalance = wallet \? wallet\.balance - wallet\.reserved_amount : 0;\s*if \(currentBalance < item\.amount\) insufficient = true;\s*\}/g;
const uiReplacement = `let insufficient = false;
                  if (isDue && item.type === "expense") {
                    const currentBalance = availableBalances.get(item.wallet_id ?? "") ?? 0;
                    if (currentBalance < item.amount) insufficient = true;
                  }`;
content = content.replace(uiPattern, uiReplacement);

// 4. Also we need to fix the setTransfers/setBudgets at the bottom of loadData
// since we mapped them already, we can just pass them directly to state.
const statePattern = /setTransfers\(\(transferResult\.data \?\? \[\]\)\.map\(\(row: Record<string, unknown>\) => mapTransfer\(row\)\)\);\s*setBudgets\(\(budgetResult\.data \?\? \[\]\)\.map\(\(row: Record<string, unknown>\) => mapBudget\(row\)\)\);\s*setGoals\(\(goalResult\.data \?\? \[\]\)\.map\(\(row: Record<string, unknown>\) => mapGoal\(row\)\)\);/;
const stateReplacement = `setTransfers(loadedTransfers);
      setBudgets(loadedBudgets);
      setGoals(loadedGoals);`;
content = content.replace(statePattern, stateReplacement);

fs.writeFileSync(file, content, 'utf8');
console.log("Fixed balance logic!");
