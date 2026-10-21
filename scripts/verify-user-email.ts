/**
 * Verify a user's email manually.
 * Run with: npx tsx scripts/verify-user-email.ts <email>
 */
import { adminPool, closePools } from '../src/db/pool.js';

const email = process.argv[2]!;
if (!email) {
    console.error('Usage: npx tsx scripts/verify-user-email.ts <email>');
    process.exit(1);
}

async function main(): Promise<void> {
    const { rowCount } = await adminPool.query(
        `UPDATE users
          SET email_verified_at = now(),
              status = 'active'
         WHERE email = $1`,
        [email.toLowerCase()],
    );

    if (rowCount === 0) {
        console.log(`User ${email} not found.`);
        return;
    }

    console.log(`Email verified for ${email}. Status set to active.`);
}

main().catch((error) => {
    console.error(error);
    process.exit(1);
}).finally(() => closePools().catch(() => undefined));