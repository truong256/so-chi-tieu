/**
 * tests/ai-evaluation/auth-helper.mjs
 * ==================================
 * Provides dynamically authenticated JWT tokens for test_copilot@sochitieu.com.
 */

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://xqclhgyrkwaipwokooxe.supabase.co';
const API_KEY = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || 'sb_publishable_7A3Jnp28OveJw8Tvg9cY6A_tQ67V5oh';
const TEST_EMAIL = process.env.TEST_EMAIL || 'test_copilot@sochitieu.com';
const TEST_PASSWORD = process.env.TEST_PASSWORD || 'TestPassword123!';

let cachedToken = null;
let tokenExpiresAt = 0;

export async function getTestAuthToken() {
  const now = Math.floor(Date.now() / 1000);
  if (cachedToken && tokenExpiresAt > now + 60) {
    return cachedToken;
  }

  const res = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: {
      'apikey': API_KEY,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      email: TEST_EMAIL,
      password: TEST_PASSWORD
    })
  });

  const data = await res.json();
  if (!data.access_token) {
    throw new Error(`Failed to authenticate ${TEST_EMAIL}: ${JSON.stringify(data)}`);
  }

  cachedToken = data.access_token;
  tokenExpiresAt = now + (data.expires_in || 3600);
  return cachedToken;
}
