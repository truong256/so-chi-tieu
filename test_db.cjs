const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  'https://xqclhgyrkwaipwokooxe.supabase.co',
  'sb_publishable_7A3Jnp28OveJw8Tvg9cY6A_tQ67V5oh'
);

async function inspect() {
  const { data: wallets } = await supabase.from('wallets').select('*');
  const { data: budgets } = await supabase.from('budgets').select('*');
  const { data: goals } = await supabase.from('savings_goals').select('*');
  const { data: recurring } = await supabase.from('recurring_transactions').select('*');
  const { data: txs } = await supabase.from('transactions').select('*').order('created_at', { ascending: false }).limit(20);

  console.log('=== WALLETS ===');
  console.log(wallets);

  console.log('\n=== BUDGETS ===');
  console.log(budgets);

  console.log('\n=== GOALS ===');
  console.log(goals);

  console.log('\n=== RECURRING ===');
  console.log(recurring);

  console.log('\n=== RECENT TRANSACTIONS ===');
  console.log(txs?.map(t => ({ id: t.id, title: t.title, amount: t.amount, type: t.type, wallet_id: t.wallet_id, budget_id: t.budget_id, payment_source_type: t.payment_source_type })));
}

inspect();
