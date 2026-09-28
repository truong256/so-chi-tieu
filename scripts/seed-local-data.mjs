import { createClient } from '@supabase/supabase-js';

// Local Supabase default service_role key and API URL
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || 'http://127.0.0.1:54321';
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 
  // Supabase CLI standard local service_role key
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTYyODc2OTYwMCwiZXhwIjE5NDQzNDU2MDB9.s9qd9UjXvM1mY4x4EwP_f8Qz0X8-f2x4e0_9sX2k5y0';

const supabaseAdmin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: {
    autoRefreshToken: false,
    persistSession: false,
  },
});

async function findOrCreateUser(email, password, fullName, username) {
  // Check if user already exists
  const { data: usersData, error: listError } = await supabaseAdmin.auth.admin.listUsers();
  if (listError) {
    throw new Error(`Failed to list users: ${listError.message}`);
  }

  const existing = usersData.users.find((u) => u.email === email);
  if (existing) {
    console.log(`User ${email} already exists (${existing.id})`);
    return existing;
  }

  const { data, error } = await supabaseAdmin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: {
      full_name: fullName,
      username,
    },
  });

  if (error) {
    throw new Error(`Failed to create user ${email}: ${error.message}`);
  }

  console.log(`Created user ${email} (${data.user.id})`);
  return data.user;
}

async function seedData() {
  console.log('Seeding local Supabase Auth & application data...');

  const TEST_PASSWORD = process.env.LOCAL_TEST_PASSWORD || 'TestPass123!@#';

  // 1. Create Admin
  const adminUser = await findOrCreateUser(
    'admin@local.test',
    TEST_PASSWORD,
    'Admin Test',
    'admin_test'
  );

  // Set role to admin in user_roles
  const { error: roleError } = await supabaseAdmin
    .from('user_roles')
    .upsert({ user_id: adminUser.id, role: 'admin' }, { onConflict: 'user_id' });

  if (roleError) {
    console.warn(`Warning setting admin role: ${roleError.message}`);
  } else {
    console.log('Admin role granted to admin@local.test');
  }

  // 2. Create User A
  const userA = await findOrCreateUser(
    'user.a@local.test',
    TEST_PASSWORD,
    'Nguyễn Văn A',
    'user_a'
  );

  // 3. Create User B
  const userB = await findOrCreateUser(
    'user.b@local.test',
    TEST_PASSWORD,
    'Trần Thị B',
    'user_b'
  );

  // Seed wallets for User A
  const { data: walletsA, error: wAError } = await supabaseAdmin
    .from('wallets')
    .upsert(
      [
        {
          user_id: userA.id,
          name: 'Tiền mặt',
          type: 'cash',
          balance: 2000000,
          currency: 'VND',
          color: '#10B981',
        },
        {
          user_id: userA.id,
          name: 'Tài khoản Vietcombank',
          type: 'bank',
          balance: 15000000,
          currency: 'VND',
          color: '#3B82F6',
        },
      ],
      { onConflict: 'user_id,name' }
    )
    .select();

  if (wAError) console.warn('Error inserting wallets for User A:', wAError.message);

  // Seed wallets for User B
  const { error: wBError } = await supabaseAdmin
    .from('wallets')
    .upsert(
      [
        {
          user_id: userB.id,
          name: 'Ví MoMo',
          type: 'ewallet',
          balance: 500000,
          currency: 'VND',
          color: '#EC4899',
        },
        {
          user_id: userB.id,
          name: 'Techcombank',
          type: 'bank',
          balance: 8000000,
          currency: 'VND',
          color: '#EF4444',
        },
      ],
      { onConflict: 'user_id,name' }
    )
    .select();

  if (wBError) console.warn('Error inserting wallets for User B:', wBError.message);

  // Seed categories for User A
  const { data: catA, error: catAError } = await supabaseAdmin
    .from('categories')
    .upsert(
      [
        { user_id: userA.id, name: 'Lương', kind: 'income', color: '#10B981' },
        { user_id: userA.id, name: 'Ăn uống', kind: 'expense', color: '#F59E0B' },
        { user_id: userA.id, name: 'Di chuyển', kind: 'expense', color: '#6366F1' },
      ],
      { onConflict: 'user_id,name,kind' }
    )
    .select();

  if (catAError) console.warn('Error inserting categories for User A:', catAError.message);

  // Seed sample transactions for User A
  if (walletsA && walletsA.length > 0 && catA && catA.length > 0) {
    const cashWallet = walletsA.find((w) => w.name === 'Tiền mặt') || walletsA[0];
    const foodCat = catA.find((c) => c.name === 'Ăn uống') || catA[0];

    const { error: txError } = await supabaseAdmin.from('transactions').insert([
      {
        user_id: userA.id,
        wallet_id: cashWallet.id,
        category_id: foodCat.id,
        title: 'Cà phê sáng',
        amount: 45000,
        type: 'expense',
        category: foodCat.name,
        occurred_at: new Date().toISOString(),
        payment_source_type: 'wallet',
      },
    ]);
    if (txError) console.warn('Note on transaction insert:', txError.message);
  }

  console.log('Local seed completed successfully!');
}

seedData().catch((err) => {
  console.error('Seed failed:', err);
  process.exit(1);
});
