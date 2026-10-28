import { processChat } from '../backend/src/services/ai-chat.service.ts';
import { buildServerFinancialContext } from '../backend/src/services/financial-context.service.ts';
import { getTestAuthToken } from '../tests/ai-evaluation/auth-helper.mjs';

async function testAssistant() {
  console.log('Testing Smart Financial Assistant with Tool Calling...');
  const token = await getTestAuthToken();
  const userId = 'c921b6ee-910f-4d4a-9b55-ec273c04830e';
  const supabaseUrl = 'https://xqclhgyrkwaipwokooxe.supabase.co';
  const supabaseKey = 'sb_publishable_7A3Jnp28OveJw8Tvg9cY6A_tQ67V5oh';

  const toolContext = {
    supabaseUrl,
    supabaseKey,
    token,
    userId,
  };

  const queries = [
    "Tôi có bao nhiêu tiền?",
    "Tháng này tôi đã chi bao nhiêu?",
    "Ngân sách Ăn uống của tôi còn lại bao nhiêu tiền?",
    "Có nên mua điện thoại 15 triệu không?",
    "Tôi nên làm gì với số tiền hiện tại?"
  ];

  for (const q of queries) {
    console.log(`\n======================================================`);
    console.log(`USER: "${q}"`);
    console.log(`======================================================`);
    const serverContext = await buildServerFinancialContext(supabaseUrl, supabaseKey, token, userId, q);
    const start = Date.now();
    const res = await processChat('http://127.0.0.1:11434', {
      message: q,
      history: []
    }, { serverContext, toolContext });
    console.log(`ASSISTANT (${Date.now() - start}ms):`);
    console.log(res.reply);
  }
}

testAssistant().catch(console.error);
