/**
 * Fix user email verification status.
 * Run with: npx tsx scripts/fix-user-email.ts <email>
 */
import { adminPool, closePools } from '../src/db/pool.js';

const email = process.argv[2]!;
if (!email) {
    console.error('Usage: npx tsx scripts/fix-user-email.ts <email>');
    process.exit(1);
}

async function main(): Promise<void> {
    const { rows, rowCount } = await adminPool.query(
        `UPDATE users
          SET email_verified_at = now(),
              status = 'active'
         WHERE email = $1
         RETURNING user_id, email, status, email_verified_at`,
        [email.toLowerCase()],
    );

    if (rowCount === 0) {
        console.log(`User ${email} not found.`);
        return;
    }

    const u = rows[0];
    console.log(`Fixed: user ${u.user_id} (${u.email}) status=${u.status} email_verified_at=${u.email_verified_at}`);
}

main().catch((error) => {
    console.error(error);
    process.exit(1);
}).finally(() => closePools().catch(() => undefined));