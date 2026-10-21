/**
 * Check a specific user's status.
 * Run with: npx tsx scripts/check-user.ts <email>
 */
import { adminPool, closePools } from '../src/db/pool.js';

const email = process.argv[2]!;
if (!email) {
    console.error('Usage: npx tsx scripts/check-user.ts <email>');
    process.exit(1);
}

async function main(): Promise<void> {
    const { rows } = await adminPool.query(
        `SELECT user_id, email, phone, full_name, status, email_verified_at, last_login_at, created_at
         FROM users WHERE email = $1`,
        [email.toLowerCase()],
    );

    if (rows.length === 0) {
        console.log(`User ${email} not found.`);
        return;
    }

    const u = rows[0];
    console.log(`User ${u.email}:`);
    console.log(`  ID:          ${u.user_id}`);
    console.log(`  Name:        ${u.full_name}`);
    console.log(`  Phone:       ${u.phone ?? '(none)'}`);
    console.log(`  Status:      ${u.status}`);
    console.log(`  Email verified at: ${u.email_verified_at ?? 'NOT VERIFIED'}`);
    console.log(`  Last login:  ${u.last_login_at ?? 'never'}`);
    console.log(`  Created:     ${u.created_at}`);

    // Check platform roles
    const { rows: roleRows } = await adminPool.query(
        `SELECT r.role_key FROM user_platform_roles upr
         JOIN roles r ON r.role_id = upr.role_id
         WHERE upr.user_id = $1`,
        [u.user_id],
    );
    console.log(`  Roles: ${roleRows.map(r => r.role_key).join(', ') || '(none)'}`);

    // Check pending verification codes
    const { rows: codeRows } = await adminPool.query(
        `SELECT created_at, expires_at, consumed_at, attempts
         FROM user_email_verification_codes
         WHERE user_id = $1 ORDER BY created_at DESC LIMIT 3`,
        [u.user_id],
    );
    if (codeRows.length > 0) {
        console.log(`  Recent verification codes:`);
        for (const c of codeRows) {
            console.log(`    created=${c.created_at} expires=${c.expires_at} consumed=${c.consumed_at ?? 'no'} attempts=${c.attempts}`);
        }
    } else {
        console.log(`  Verification codes: none`);
    }
}

main().catch((error) => {
    console.error(error);
    process.exit(1);
}).finally(() => closePools().catch(() => undefined));