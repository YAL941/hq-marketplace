import { config } from '../src/config.js';
import { applyGrants } from '../src/db/grants.js';
import { adminPool, closePools } from '../src/db/pool.js';
async function main() {
    const result = await applyGrants(adminPool, config.APP_DB_USER, config.APP_DB_PASSWORD);
    console.log(`[grants] ${result.created ? 'created' : 'updated'} role ${config.APP_DB_USER}`);
    console.log('[grants] done. The API must connect with APP_DB_USER, never with the owner role.');
}
main()
    .then(closePools)
    .catch(async (error) => {
    console.error('[grants]', error.message);
    await closePools();
    process.exit(1);
});
//# sourceMappingURL=apply-grants.js.map