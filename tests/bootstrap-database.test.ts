import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import { bootstrapDatabaseRoles } from '../src/db/bootstrap.js';
import { executeOwnershipDownMigration, executeOwnershipMigration } from '../src/db/migrator.js';

describe('controlled database bootstrap', () => {
    it('creates or updates app and definer roles without broad privileges', async () => {
        const statements: string[] = [];
        let existenceCall = 0;
        const client = {
            query: async (sql: string) => {
                statements.push(sql);
                if (/SELECT EXISTS \(SELECT 1 FROM pg_catalog\.pg_roles/.test(sql)) {
                    existenceCall += 1;
                    return { rows: [{ exists: false }] };
                }
                return { rows: [] };
            },
        };

        const result = await bootstrapDatabaseRoles(client as never, 'hq_app', 'safe-bootstrap-password');
        assert.deepEqual(result, { appRoleCreated: true, definerRoleCreated: true });
        assert.equal(existenceCall, 2);
        assert.equal(statements.some((sql) => /CREATE ROLE "?hq_app"?/.test(sql)), true);
        assert.equal(statements.some((sql) => /CREATE ROLE hq_notification_definer NOLOGIN/.test(sql)), true);
        assert.equal(/NOLOGIN/.test(statements.join('\n')), true);
        assert.equal(statements.some((sql) => /NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION NOBYPASSRLS/.test(sql)), true);
    });

    it('rejects a missing or weak application bootstrap password', async () => {
        await assert.rejects(
            () => bootstrapDatabaseRoles({ query: async () => ({ rows: [] }) } as never, 'hq_app', 'short'),
            /at least 16 characters/,
        );
    });

    it('migration 064 requires externally controlled definer lifecycle and clear absence errors', () => {
        const migration = readFileSync(
            new URL('../db/migrations/064_notification_owner_security.sql', import.meta.url),
            'utf8',
        );
        assert.match(migration, /hq_notification_definer is missing; run the controlled database bootstrap/);
        assert.match(migration, /unsafe login or administrative attributes/);
        assert.doesNotMatch(migration, /CREATE ROLE hq_notification_definer/);
    });

    it('Down 064 uses explicit scoped cleanup instead of DROP OWNED', () => {
        const migration = readFileSync(
            new URL('../db/migrations/down/064_notification_owner_security.sql', import.meta.url),
            'utf8',
        );
        assert.doesNotMatch(migration, /DROP OWNED BY/);
        assert.match(migration, /REVOKE SELECT ON TABLE public\.orders/);
        assert.match(migration, /REVOKE USAGE ON SCHEMA public, notification_private/);
        assert.match(migration, /retains unintended owned objects or privileges/);
    });

    const ownershipMigrationCases = [
        { version: '064', name: '064_notification_owner_security' },
        { version: '065', name: '065_notification_operations' },
    ];

    for (const migrationCase of ownershipMigrationCases) {
        it(`${migrationCase.version} uses one atomic GRANT/Migration/REVOKE/COMMIT transaction`, async () => {
            const calls: string[] = [];
            let membership = false;
            const client = {
                query: async (sql: string) => {
                    calls.push(sql);
                    if (sql === 'BEGIN') return { rows: [] };
                    if (/current_user::text/.test(sql)) return { rows: [{ role_name: 'hq_migration_test' }] };
                    if (/WHERE rolname = 'hq_notification_definer'/.test(sql)) return { rows: [{ exists: true }] };
                    if (/pg_auth_members/.test(sql)) return { rows: [{ active: membership }] };
                    if (/^GRANT hq_notification_definer/.test(sql)) {
                        membership = true;
                        return { rows: [] };
                    }
                    if (/^REVOKE hq_notification_definer/.test(sql)) {
                        membership = false;
                        return { rows: [] };
                    }
                    if (sql === 'COMMIT') return { rows: [] };
                    if (sql === 'ROLLBACK') {
                        membership = false;
                        return { rows: [] };
                    }
                    return { rows: [] };
                },
            };

            await executeOwnershipMigration(client as never, {
                version: migrationCase.version,
                name: migrationCase.name,
                sql: `SELECT '${migrationCase.version}' AS migration`,
                downSql: '',
            }, 'checksum');

            assert.equal(membership, false);
            assert.equal(calls.some((sql) => /^GRANT hq_notification_definer/.test(sql)), true);
            assert.equal(calls.some((sql) => /^REVOKE hq_notification_definer/.test(sql)), true);
            assert.ok(calls.indexOf('COMMIT') > calls.findIndex((sql) => /^REVOKE/.test(sql)));
            assert.equal(calls.includes('ROLLBACK'), false);
        });
    }

    for (const migrationCase of ownershipMigrationCases) {
        it(`${migrationCase.version} Down uses one atomic GRANT/Down/REVOKE/COMMIT transaction`, async () => {
            const calls: string[] = [];
            let membership = false;
            const client = {
                query: async (sql: string) => {
                    calls.push(sql);
                    if (sql === 'BEGIN') return { rows: [] };
                    if (/current_user::text/.test(sql)) return { rows: [{ role_name: 'hq_migration_test' }] };
                    if (/WHERE rolname = 'hq_notification_definer'/.test(sql)) return { rows: [{ exists: true }] };
                    if (/pg_auth_members/.test(sql)) return { rows: [{ active: membership }] };
                    if (/SELECT EXISTS \(\s*SELECT 1 FROM schema_migrations/.test(sql)) {
                        return { rows: [{ applied: false }] };
                    }
                    if (/^GRANT hq_notification_definer/.test(sql)) {
                        membership = true;
                        return { rows: [] };
                    }
                    if (/^REVOKE hq_notification_definer/.test(sql)) {
                        membership = false;
                        return { rows: [] };
                    }
                    if (sql === 'COMMIT') return { rows: [] };
                    if (sql === 'ROLLBACK') {
                        membership = false;
                        return { rows: [] };
                    }
                    return { rows: [] };
                },
            };

            await executeOwnershipDownMigration(client as never, {
                version: migrationCase.version,
                name: migrationCase.name,
                sql: '',
                downSql: `SELECT '${migrationCase.version} down'`,
            });

            assert.equal(membership, false);
            assert.equal(calls.some((sql) => /^GRANT hq_notification_definer/.test(sql)), true);
            assert.equal(calls.some((sql) => /^REVOKE hq_notification_definer/.test(sql)), true);
            assert.ok(calls.indexOf('COMMIT') > calls.findIndex((sql) => /^REVOKE/.test(sql)));
            assert.equal(calls.includes('ROLLBACK'), false);
        });
    }

    it('rejects Down 064 while migration 065 remains applied', async () => {
        const client = {
            query: async (sql: string) => {
                if (/current_user::text/.test(sql)) return { rows: [{ role_name: 'hq_migration_test' }] };
                if (/WHERE rolname = 'hq_notification_definer'/.test(sql)) return { rows: [{ exists: true }] };
                if (/pg_auth_members/.test(sql)) return { rows: [{ active: false }] };
                if (/SELECT 1 FROM schema_migrations/.test(sql)) return { rows: [{ applied: true }] };
                if (sql === 'ROLLBACK') return { rows: [] };
                return { rows: [] };
            },
        };

        await assert.rejects(
            () => executeOwnershipDownMigration(client as never, {
                version: '064',
                name: '064_notification_owner_security',
                sql: '',
                downSql: 'SELECT 1',
            }),
            /roll back 065 first/,
        );
    });

    it('rolls back Down 064 GRANT and SQL failure without leaving membership', async () => {
        let membership = false;
        let committed = false;
        const client = {
            query: async (sql: string) => {
                if (/current_user::text/.test(sql)) return { rows: [{ role_name: 'hq_migration_test' }] };
                if (/WHERE rolname = 'hq_notification_definer'/.test(sql)) return { rows: [{ exists: true }] };
                if (/pg_auth_members/.test(sql)) return { rows: [{ active: membership }] };
                if (/SELECT 1 FROM schema_migrations/.test(sql)) return { rows: [{ applied: false }] };
                if (/^GRANT hq_notification_definer/.test(sql)) {
                    membership = true;
                    return { rows: [] };
                }
                if (sql === 'SELECT down_064_failure') throw new Error('injected Down 064 failure');
                if (sql === 'ROLLBACK') {
                    membership = false;
                    return { rows: [] };
                }
                if (sql === 'COMMIT') {
                    committed = true;
                    return { rows: [] };
                }
                return { rows: [] };
            },
        };

        await assert.rejects(
            () => executeOwnershipDownMigration(client as never, {
                version: '064',
                name: '064_notification_owner_security',
                sql: '',
                downSql: 'SELECT down_064_failure',
            }),
            /injected Down 064 failure/,
        );
        assert.equal(membership, false);
        assert.equal(committed, false);
    });

    it('rejects Down pre-existing definer membership without revoking it', async () => {
        const calls: string[] = [];
        const client = {
            query: async (sql: string) => {
                calls.push(sql);
                if (/WHERE rolname = 'hq_notification_definer'/.test(sql)) return { rows: [{ exists: true }] };
                if (/pg_auth_members/.test(sql)) return { rows: [{ active: true }] };
                if (/current_user::text/.test(sql)) return { rows: [{ role_name: 'hq_migration_test' }] };
                if (sql === 'ROLLBACK') return { rows: [] };
                return { rows: [] };
            },
        };

        await assert.rejects(
            () => executeOwnershipDownMigration(client as never, {
                version: '065',
                name: '065_notification_operations',
                sql: '',
                downSql: 'SELECT 1',
            }),
            /unexpected existing hq_notification_definer membership/,
        );
        assert.equal(calls.some((sql) => /^GRANT/.test(sql) || /^REVOKE/.test(sql)), false);
    });

    it('rolls back GRANT and DDL when migration SQL fails', async () => {
        let membership = false;
        let committed = false;
        const client = {
            query: async (sql: string) => {
                if (/current_user::text/.test(sql)) return { rows: [{ role_name: 'hq_migration_test' }] };
                if (/WHERE rolname = 'hq_notification_definer'/.test(sql)) return { rows: [{ exists: true }] };
                if (/pg_auth_members/.test(sql)) return { rows: [{ active: membership }] };
                if (/^GRANT hq_notification_definer/.test(sql)) {
                    membership = true;
                    return { rows: [] };
                }
                if (sql === "SELECT '064' AS migration") throw new Error('injected migration 064 failure');
                if (sql === 'ROLLBACK') {
                    membership = false;
                    return { rows: [] };
                }
                if (sql === 'COMMIT') {
                    committed = true;
                    return { rows: [] };
                }
                return { rows: [] };
            },
        };

        await assert.rejects(
            () => executeOwnershipMigration(client as never, {
                version: '064',
                name: '064_notification_owner_security',
                sql: "SELECT '064' AS migration",
                downSql: '',
            }, 'checksum'),
            /injected migration 064 failure/,
        );
        assert.equal(membership, false);
        assert.equal(committed, false);
    });

    it('rejects unexpected pre-existing membership without revoking it', async () => {
        const calls: string[] = [];
        const client = {
            query: async (sql: string) => {
                calls.push(sql);
                if (/pg_auth_members/.test(sql)) return { rows: [{ active: true }] };
                if (/current_user::text/.test(sql)) return { rows: [{ role_name: 'hq_migration_test' }] };
                if (/WHERE rolname = 'hq_notification_definer'/.test(sql)) return { rows: [{ exists: true }] };
                return { rows: [] };
            },
        };

        await assert.rejects(
            () => executeOwnershipMigration(client as never, {
                version: '064',
                name: '064_notification_owner_security',
                sql: 'SELECT 1',
                downSql: '',
            }, 'checksum'),
            /unexpected existing hq_notification_definer membership/,
        );
        assert.equal(calls.some((sql) => /^GRANT/.test(sql) || /^REVOKE/.test(sql)), false);
    });

    it('blocks COMMIT when REVOKE fails and rolls back the grant and migration DDL', async () => {
        let membership = false;
        let committed = false;
        const client = {
            query: async (sql: string) => {
                if (/current_user::text/.test(sql)) return { rows: [{ role_name: 'hq_migration_test' }] };
                if (/WHERE rolname = 'hq_notification_definer'/.test(sql)) return { rows: [{ exists: true }] };
                if (/pg_auth_members/.test(sql)) return { rows: [{ active: membership }] };
                if (/^GRANT hq_notification_definer/.test(sql)) {
                    membership = true;
                    return { rows: [] };
                }
                if (/^REVOKE hq_notification_definer/.test(sql)) {
                    throw new Error('injected revoke failure');
                }
                if (sql === 'ROLLBACK') {
                    membership = false;
                    return { rows: [] };
                }
                if (sql === 'COMMIT') {
                    committed = true;
                    return { rows: [] };
                }
                return { rows: [] };
            },
        };

        await assert.rejects(
            () => executeOwnershipMigration(client as never, {
                version: '065',
                name: '065_notification_operations',
                sql: 'SELECT 1',
                downSql: '',
            }, 'checksum'),
            /injected revoke failure/,
        );
        assert.equal(membership, false);
        assert.equal(committed, false);
    });

    it('rolls back GRANT and DDL when Migration 065 SQL fails and permits a clean rerun', async () => {
        let membership = false;
        let failMigration = true;
        const client = {
            query: async (sql: string) => {
                if (/current_user::text/.test(sql)) return { rows: [{ role_name: 'hq_migration_test' }] };
                if (/WHERE rolname = 'hq_notification_definer'/.test(sql)) return { rows: [{ exists: true }] };
                if (/pg_auth_members/.test(sql)) return { rows: [{ active: membership }] };
                if (/^GRANT hq_notification_definer/.test(sql)) {
                    membership = true;
                    return { rows: [] };
                }
                if (sql === 'SELECT 065_failure_target' && failMigration) {
                    throw new Error('injected migration 065 failure');
                }
                if (/^REVOKE hq_notification_definer/.test(sql)) {
                    membership = false;
                    return { rows: [] };
                }
                if (sql === 'ROLLBACK') {
                    membership = false;
                    return { rows: [] };
                }
                return { rows: [] };
            },
        };

        await assert.rejects(
            () => executeOwnershipMigration(client as never, {
                version: '065',
                name: '065_notification_operations',
                sql: 'SELECT 065_failure_target',
                downSql: '',
            }, 'checksum'),
            /injected migration 065 failure/,
        );
        assert.equal(membership, false);

        failMigration = false;
        await executeOwnershipMigration(client as never, {
            version: '065',
            name: '065_notification_operations',
            sql: 'SELECT 065_failure_target',
            downSql: '',
        }, 'checksum');
        assert.equal(membership, false);
    });
});
