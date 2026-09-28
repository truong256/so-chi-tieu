import fs from 'node:fs';
import path from 'node:path';

const targetMode = process.argv[2] || 'local';
const rootDir = process.cwd();
const envLocalPath = path.join(rootDir, '.env.local');
const envCloudBakPath = path.join(rootDir, '.env.local.cloud.bak');

if (targetMode === 'cloud') {
  if (!fs.existsSync(envCloudBakPath)) {
    console.error('Error: .env.local.cloud.bak does not exist to restore.');
    process.exit(1);
  }
  fs.copyFileSync(envCloudBakPath, envLocalPath);
  console.log('Restored .env.local to Supabase Cloud settings.');
} else if (targetMode === 'local') {
  // Read existing env to preserve GEMINI_API_KEY
  let geminiKey = '';
  if (fs.existsSync(envLocalPath)) {
    const content = fs.readFileSync(envLocalPath, 'utf8');
    const match = content.match(/GEMINI_API_KEY=([^\r\n]*)/);
    if (match) geminiKey = match[1].trim();
  }

  const localEnv = [
    '# Supabase Local Configuration (Auto-generated)',
    'NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54321',
    'NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJpYXQiOjE2Mjg3Njk2MDAsImV4cCI6MTk0NDM0NTYwMH0.EYX4t9h8D86wB2l_g3L5QyL3P4x5o9z7n8V1b2M3c4',
    'NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJpYXQiOjE2Mjg3Njk2MDAsImV4cCI6MTk0NDM0NTYwMH0.EYX4t9h8D86wB2l_g3L5QyL3P4x5o9z7n8V1b2M3c4',
    'SUPABASE_SERVICE_ROLE_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTYyODc2OTYwMCwiZXhwIjE5NDQzNDU2MDB9.s9qd9UjXvM1mY4x4EwP_f8Qz0X8-f2x4e0_9sX2k5y0',
    `GEMINI_API_KEY=${geminiKey}`,
    '',
  ].join('\n');

  fs.writeFileSync(envLocalPath, localEnv, 'utf8');
  console.log('Configured .env.local for Supabase Local (http://127.0.0.1:54321).');
} else {
  console.log('Usage: node scripts/switch-env.mjs [local|cloud]');
}
