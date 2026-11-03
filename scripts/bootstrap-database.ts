import { bootstrapDatabaseRoles } from '../src/db/bootstrap.js';
import { adminPool, closeAdminPool } from '../src/db/admin-pool.js';
import { config } from '../src/config.js';

async function main(): Promise<void> {
    const result = await bootstrapDatabaseRoles(adminPool, config.APP_DB_USER, config.APP_DB_PASSWORD);
    console.log(
        `[bootstrap] role lifecycle ready: app=${config.APP_DB_USER} ` +
        `(${result.appRoleCreated ? 'created' : 'updated'}), definer=${result.definerRoleCreated ? 'created' : 'verified'}`,
    );
}

main()
    .then(async () => closeAdminPool())
    .catch(async (error) => {
        console.error('[bootstrap]', error.message);
        await closeAdminPool();
        process.exit(1);
    });
