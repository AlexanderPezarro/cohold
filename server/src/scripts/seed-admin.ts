import authService from '../services/auth.service.js';

export async function seedAdmin(): Promise<void> {
  const email = process.env.OWNER_EMAIL;
  const password = process.env.ADMIN_PASSWORD;

  if (!email || !password) {
    console.log('[seed-admin] OWNER_EMAIL/ADMIN_PASSWORD not both set — skipping.');
    return;
  }

  const setupRequired = await authService.isSetupRequired();
  if (!setupRequired) {
    console.log('[seed-admin] Setup already completed — skipping.');
    return;
  }

  try {
    const user = await authService.createUser(email, password, 'ADMIN');
    console.log('[seed-admin] Preset admin user created:', user.email);
  } catch (error: any) {
    if (error.code === 'P2002') {
      // Benign race: isSetupRequired() and createUser() aren't transactional,
      // so another process could create the user in between (e.g. concurrent
      // restart, or the customer completed the wizard first).
      console.log('[seed-admin] Admin user already exists (race) — skipping.');
      return;
    }
    console.error('[seed-admin] Unexpected error while seeding admin user:', error);
    throw error;
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  seedAdmin()
    .then(() => process.exit(0))
    .catch(() => process.exit(1));
}
