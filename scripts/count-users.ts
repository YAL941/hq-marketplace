/**
 * Quick count of registered users.
 * Run with: npx tsx scripts/count-users.ts
 */
import { adminPool, closePools } from '../src/db/pool.js';

async function main(): Promise<void> {
    const { rows } = await adminPool.query(`
        SELECT
            count(*)                                    AS total_users,
            count(*) FILTER (WHERE status = 'active')  AS active,
            count(*) FILTER (WHERE status = 'pending') AS pending,
            count(*) FILTER (WHERE status = 'suspended') AS suspended,
            count(*) FILTER (WHERE status = 'deleted') AS deleted
        FROM users
    `);

    const r = rows[0];
    console.log('Registered users:');
    console.log(`  Total:    ${r.total_users}`);
    console.log(`  Active:   ${r.active}`);
    console.log(`  Pending:  ${r.pending}`);
    console.log(`  Suspended:${r.suspended}`);
    console.log(`  Deleted:  ${r.deleted}`);
}

main().catch((error) => {
    console.error(error);
    process.exit(1);
}).finally(() => closePools().catch(() => undefined));