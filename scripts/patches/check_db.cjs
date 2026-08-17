const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  'https://xqclhgyrkwaipwokooxe.supabase.co',
  'sb_publishable_7A3Jnp28OveJw8Tvg9cY6A_tQ67V5oh'
);

async function check() {
  const { data, error } = await supabase
    .from('recurring_transactions')
    .select('id,user_id,wallet_id,category_id,title,amount,type,amount_type,estimated_amount,frequency,interval,processing_mode,status,start_date,end_type,end_date,occurrence_limit,reminder_days,month_end_mode,last_processed_at,next_run_at,note')
    .limit(1);
    
  if (error) {
    console.error('Error querying recurring_transactions with new columns:', JSON.stringify(error, null, 2));
  } else {
    console.log('Query success! Data:', data);
  }
}

check();
