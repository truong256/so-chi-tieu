/**
 * tests/ai-evaluation/seed-test-data.mjs
 * =====================================
 * Seeds deterministic test fixture data for test_copilot@sochitieu.com in Supabase.
 */

import { getTestAuthToken } from './auth-helper.mjs';

const USER_ID = 'c921b6ee-910f-4d4a-9b55-ec273c04830e';
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://xqclhgyrkwaipwokooxe.supabase.co';
const API_KEY = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || 'sb_publishable_7A3Jnp28OveJw8Tvg9cY6A_tQ67V5oh';

async function seedData() {
  console.log('Authenticating test user and seeding deterministic financial fixtures...');
  const token = await getTestAuthToken();
  const headers = {
    'apikey': API_KEY,
    'Authorization': `Bearer ${token}`,
    'Content-Type': 'application/json',
    'Prefer': 'return=representation'
  };

  // 1. Get or create wallets
  const walletsRes = await fetch(`${SUPABASE_URL}/rest/v1/wallets?select=*`, { headers });
  let wallets = await walletsRes.json();
  if (!Array.isArray(wallets)) {
    throw new Error(`Failed to fetch wallets: ${JSON.stringify(wallets)}`);
  }

  let cashWallet = wallets.find(w => w.name === 'Tiền mặt');
  if (cashWallet) {
    await fetch(`${SUPABASE_URL}/rest/v1/wallets?id=eq.${cashWallet.id}`, {
      method: 'PATCH',
      headers,
      body: JSON.stringify({ balance: 5000000, reserved_amount: 500000 })
    });
  } else {
    const createCash = await fetch(`${SUPABASE_URL}/rest/v1/wallets`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        user_id: USER_ID,
        name: 'Tiền mặt',
        type: 'cash',
        balance: 5000000,
        currency: 'VND',
        color: '#D9F45F',
        icon: '💵',
        reserved_amount: 500000
      })
    });
    const created = await createCash.json();
    cashWallet = created[0];
  }

  let bankWallet = wallets.find(w => w.name === 'Tài khoản VCB');
  if (bankWallet) {
    await fetch(`${SUPABASE_URL}/rest/v1/wallets?id=eq.${bankWallet.id}`, {
      method: 'PATCH',
      headers,
      body: JSON.stringify({ balance: 10000000, reserved_amount: 0 })
    });
  } else {
    const createBank = await fetch(`${SUPABASE_URL}/rest/v1/wallets`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        user_id: USER_ID,
        name: 'Tài khoản VCB',
        type: 'bank',
        balance: 10000000,
        currency: 'VND',
        color: '#4F46E5',
        icon: '🏦',
        reserved_amount: 0
      })
    });
    const created = await createBank.json();
    bankWallet = created[0];
  }

  // 2. Get categories
  const catRes = await fetch(`${SUPABASE_URL}/rest/v1/categories?select=*`, { headers });
  const categories = await catRes.json();
  const foodCat = categories.find(c => c.name === 'Ăn uống');
  const houseCat = categories.find(c => c.name === 'Nhà ở' || c.name === 'Tiền nhà') || categories[1];
  const transCat = categories.find(c => c.name === 'Di chuyển') || categories[2];
  const salaryCat = categories.find(c => c.name === 'Lương' || c.kind === 'income') || categories[0];

  // 3. Clear existing transactions for this user
  await fetch(`${SUPABASE_URL}/rest/v1/transactions?user_id=eq.${USER_ID}`, {
    method: 'DELETE',
    headers
  });

  // Current month: 2026-10
  // Previous month: 2026-09
  const transactionsToInsert = [
    // Current month income (15.000.000 VND)
    {
      user_id: USER_ID,
      wallet_id: bankWallet?.id || cashWallet.id,
      category_id: salaryCat.id,
      category: salaryCat.name,
      title: 'Lương tháng 10',
      amount: 15000000,
      type: 'income',
      occurred_at: '2026-10-05T08:00:00Z',
      note: 'Lương chuyển khoản'
    },
    // Current month expenses (Total = 2.100.000 + 1.500.000 + 700.000 + 550.000 = 4.850.000)
    {
      user_id: USER_ID,
      wallet_id: cashWallet.id,
      category_id: foodCat.id,
      category: foodCat.name,
      title: 'Ăn uống gia đình và liên hoan',
      amount: 2100000,
      type: 'expense',
      occurred_at: '2026-10-10T12:00:00Z',
      note: 'Ăn uống'
    },
    {
      user_id: USER_ID,
      wallet_id: bankWallet?.id || cashWallet.id,
      category_id: houseCat.id,
      category: houseCat.name,
      title: 'Tiền thuê nhà tháng 10',
      amount: 1500000,
      type: 'expense',
      occurred_at: '2026-10-02T09:00:00Z',
      note: 'Tiền nhà tháng 10'
    },
    {
      user_id: USER_ID,
      wallet_id: cashWallet.id,
      category_id: transCat.id,
      category: transCat.name,
      title: 'Xăng xe và bảo dưỡng',
      amount: 700000,
      type: 'expense',
      occurred_at: '2026-10-15T15:00:00Z',
      note: 'Xăng xe'
    },
    {
      user_id: USER_ID,
      wallet_id: cashWallet.id,
      category_id: foodCat.id,
      category: foodCat.name,
      title: 'Mua sắm thực phẩm siêu thị',
      amount: 550000,
      type: 'expense',
      occurred_at: '2026-10-20T17:00:00Z',
      note: 'Siêu thị'
    },
    // Previous month expenses (Total = 5.500.000)
    {
      user_id: USER_ID,
      wallet_id: cashWallet.id,
      category_id: foodCat.id,
      category: foodCat.name,
      title: 'Ăn uống tháng 9',
      amount: 3500000,
      type: 'expense',
      occurred_at: '2026-09-12T12:00:00Z',
      note: 'Ăn uống tháng 9'
    },
    {
      user_id: USER_ID,
      wallet_id: bankWallet?.id || cashWallet.id,
      category_id: houseCat.id,
      category: houseCat.name,
      title: 'Tiền nhà tháng 9',
      amount: 2000000,
      type: 'expense',
      occurred_at: '2026-09-02T09:00:00Z',
      note: 'Tiền nhà tháng 9'
    }
  ];

  const txRes = await fetch(`${SUPABASE_URL}/rest/v1/transactions`, {
    method: 'POST',
    headers,
    body: JSON.stringify(transactionsToInsert)
  });
  console.log('Transactions seeded status:', txRes.status);
  if (!txRes.ok) console.log('Tx Error:', await txRes.text());

  // 4. Seed Budget for Ăn uống: 3.000.000 VND limit, 500.000 VND envelope allocation from cash wallet
  await fetch(`${SUPABASE_URL}/rest/v1/budgets?user_id=eq.${USER_ID}`, {
    method: 'DELETE',
    headers
  });
  const budgetRes = await fetch(`${SUPABASE_URL}/rest/v1/budgets`, {
    method: 'POST',
    headers,
    body: JSON.stringify([
      {
        user_id: USER_ID,
        name: 'Ngân sách Ăn uống',
        category_id: foodCat.id,
        amount: 3000000,
        allocated_amount: 500000,
        remaining_amount: 500000,
        source_wallet_id: cashWallet.id,
        spent_amount: 2650000,
        period: 'monthly',
        alert_percent: 80
      }
    ])
  });
  console.log('Budget seeded status:', budgetRes.status);
  if (!budgetRes.ok) console.log('Budget Error:', await budgetRes.text());

  // 5. Seed Savings Goal: Laptop M3 (25.000.000 VND target, 5.000.000 VND current)
  await fetch(`${SUPABASE_URL}/rest/v1/savings_goals?user_id=eq.${USER_ID}`, {
    method: 'DELETE',
    headers
  });
  const goalRes = await fetch(`${SUPABASE_URL}/rest/v1/savings_goals`, {
    method: 'POST',
    headers,
    body: JSON.stringify([
      {
        user_id: USER_ID,
        title: 'Mua Laptop M3',
        target_amount: 25000000,
        current_amount: 5000000,
        deadline: '2026-12-31'
      }
    ])
  });
  console.log('Savings goal seeded status:', goalRes.status);
  if (!goalRes.ok) console.log('Goal Error:', await goalRes.text());

  console.log('Deterministic test fixtures successfully seeded!');
}

seedData().catch(console.error);
