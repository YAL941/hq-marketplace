import { closePools } from '../src/db/pool.js';
import { migrateDown, migrateUp, migrationStatus } from '../src/db/migrator.js';
async function main() {
    const command = process.argv[2] ?? 'up';
    const allowDataLoss = process.argv.includes('--allow-data-loss');
    switch (command) {
        case 'up': {
            const executed = await migrateUp();
            if (executed.length === 0)
                console.log('[migrate] nothing to apply');
            for (const name of executed)
                console.log(`[migrate] applied ${name}`);
            break;
        }
        case 'down': {
            const name = await migrateDown({ allowDataLoss });
            console.log(name ? `[migrate] rolled back ${name}` : '[migrate] nothing to roll back');
            break;
        }
        case 'status': {
            const rows = await migrationStatus();
            console.log('\n  version  status   applied');
            for (const row of rows) {
                console.log(`  ${row.version.padEnd(8)} ${row.applied ? 'applied' : 'pending'}  ${row.at?.toISOString() ?? '-'}`);
            }
            console.log('');
            break;
        }
        default:
            throw new Error(`unknown command: ${command} (use up | down | status)`);
    }
}
main()
    .then(closePools)
    .catch(async (error) => {
    console.error('[migrate]', error.message);
    await closePools();
    process.exit(1);
});
//# sourceMappingURL=migrate.js.map