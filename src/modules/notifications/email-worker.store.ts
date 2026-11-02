import type { Pool, PoolClient } from 'pg';

export interface ClaimedEmail {
    outbox_id: string;
    lease_token: string;
    event_type: string;
    template_key: string;
    recipient_user_id: string;
    locale: string;
    business_id: string;
    order_id: string;
    payment_id: string | null;
    payload: unknown;
    attempt_count: number;
    max_attempts: number;
}

export interface ResolvedEmailRecipient {
    email: string;
    full_name: string;
    locale: string;
    template_key: string;
    payload: unknown;
}

export interface EmailDeliveryHealth {
    status: 'pending' | 'processing' | 'sent' | 'dead' | 'skipped';
    last_error_code: string | null;
    record_count: string;
}

export interface WorkerSmtpState {
    smtp_configured: boolean;
    smtp_last_error_code: string | null;
    smtp_last_success_at: Date | null;
    last_seen_at: Date;
}

async function asWorker<T>(pool: Pick<Pool, 'connect'>, run: (client: PoolClient) => Promise<T>): Promise<T> {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        await client.query('SET LOCAL ROLE hq_notification_worker');
        const result = await run(client);
        await client.query('COMMIT');
        return result;
    } catch (error) {
        await client.query('ROLLBACK').catch(() => undefined);
        throw error;
    } finally {
        client.release();
    }
}

/** All data-plane access is mediated by the restricted notification API. */
export class PgEmailWorkerStore {
    constructor(private readonly pool: Pick<Pool, 'connect'>) {}

    deliveryHealth(
        smtpConfigured: boolean,
        outcome: { errorCode: string | null; succeeded: boolean },
    ): Promise<{ queue: EmailDeliveryHealth[]; smtp: WorkerSmtpState | null }> {
        return asWorker(this.pool, async (client) => {
            await client.query('SELECT notification_api.worker_heartbeat($1, $2, $3)', [
                smtpConfigured, outcome.errorCode, outcome.succeeded,
            ]);
            const [{ rows: queue }, { rows: smtp }] = await Promise.all([
                client.query<EmailDeliveryHealth>(
                'SELECT * FROM notification_api.delivery_health()',
                ),
                client.query<WorkerSmtpState>('SELECT * FROM notification_api.worker_delivery_state()'),
            ]);
            return { queue, smtp: smtp[0] ?? null };
        });
    }

    claim(limit: number, leaseSeconds: number): Promise<ClaimedEmail[]> {
        return asWorker(this.pool, async (client) => {
            const { rows } = await client.query<ClaimedEmail>(
                'SELECT * FROM notification_api.claim_email_batch($1, $2)', [limit, leaseSeconds],
            );
            return rows;
        });
    }

    async resolve(id: string, token: string): Promise<ResolvedEmailRecipient | null> {
        return asWorker(this.pool, async (client) => {
            const { rows } = await client.query<ResolvedEmailRecipient>(
                'SELECT * FROM notification_api.resolve_email_recipient($1, $2)', [id, token],
            );
            return rows[0] ?? null;
        });
    }

    async acknowledge(id: string, token: string): Promise<boolean> {
        return asWorker(this.pool, async (client) => {
            const { rows } = await client.query<{ acknowledged: boolean }>(
                'SELECT notification_api.acknowledge_email_sent($1, $2) AS acknowledged', [id, token],
            );
            return rows[0]?.acknowledged === true;
        });
    }

    async fail(id: string, token: string, retryable: boolean, code: string): Promise<boolean> {
        if (!/^[a-z0-9_]{1,64}$/.test(code)) throw new Error('Invalid notification failure code');
        return asWorker(this.pool, async (client) => {
            const { rows } = await client.query<{ updated: boolean }>(
                'SELECT notification_api.fail_email($1, $2, $3, $4) AS updated',
                [id, token, retryable, code],
            );
            return rows[0]?.updated === true;
        });
    }
}

/** Fail closed if deployment has connected as a powerful role or granted broad access. */
export async function assertNotificationWorkerIdentity(pool: Pick<Pool, 'query'>): Promise<void> {
    const { rows } = await pool.query<{
        login: string; rolsuper: boolean; rolbypassrls: boolean; is_member: boolean;
        group_login: boolean; group_super: boolean; group_bypass: boolean;
        private_usage: boolean; direct_table_access: boolean; function_executes: boolean; other_memberships: boolean;
        extra_function_executes: boolean; group_memberships: boolean; public_usage: boolean;
        extra_schema_usage: boolean; extra_public_table_access: boolean;
    }>(`SELECT login.rolname AS login, login.rolsuper, login.rolbypassrls,
               pg_catalog.pg_has_role(login.oid, grp.oid, 'MEMBER') AS is_member,
               grp.rolcanlogin AS group_login, grp.rolsuper AS group_super, grp.rolbypassrls AS group_bypass,
               (pg_catalog.has_schema_privilege(login.oid, 'notification_private', 'USAGE')
                OR pg_catalog.has_schema_privilege(grp.oid, 'notification_private', 'USAGE')) AS private_usage,
               EXISTS (SELECT 1 FROM pg_catalog.pg_class c
                        JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
                       WHERE n.nspname = 'notification_private' AND c.relname = 'notification_outbox'
                         AND (pg_catalog.has_table_privilege(login.oid, c.oid, 'SELECT')
                           OR pg_catalog.has_table_privilege(login.oid, c.oid, 'INSERT')
                           OR pg_catalog.has_table_privilege(login.oid, c.oid, 'UPDATE')
                           OR pg_catalog.has_table_privilege(login.oid, c.oid, 'DELETE')
                           OR pg_catalog.has_table_privilege(grp.oid, c.oid, 'SELECT')
                           OR pg_catalog.has_table_privilege(grp.oid, c.oid, 'INSERT')
                           OR pg_catalog.has_table_privilege(grp.oid, c.oid, 'UPDATE')
                           OR pg_catalog.has_table_privilege(grp.oid, c.oid, 'DELETE'))) AS direct_table_access,
               (pg_catalog.has_schema_privilege(grp.oid, 'notification_api', 'USAGE')
                AND (SELECT pg_catalog.count(*) = 7 FROM pg_catalog.pg_proc p
                 JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
                WHERE n.nspname = 'notification_api' AND pg_catalog.has_function_privilege(grp.oid, p.oid, 'EXECUTE'))) AS function_executes,
               EXISTS (SELECT 1 FROM pg_catalog.pg_auth_members m
                        JOIN pg_catalog.pg_roles member_of ON member_of.oid = m.roleid
                       WHERE m.member = login.oid AND member_of.rolname <> 'hq_notification_worker') AS other_memberships,
               EXISTS (SELECT 1 FROM pg_catalog.pg_auth_members m
                        WHERE m.member = grp.oid) AS group_memberships,
               (pg_catalog.has_schema_privilege(grp.oid, 'public', 'USAGE')
                OR pg_catalog.has_schema_privilege(login.oid, 'public', 'USAGE')) AS public_usage,
               EXISTS (SELECT 1 FROM pg_catalog.pg_namespace n
                        WHERE n.nspname NOT IN ('pg_catalog', 'information_schema', 'public', 'notification_api', 'notification_private')
                          AND (pg_catalog.has_schema_privilege(grp.oid, n.oid, 'USAGE')
                            OR pg_catalog.has_schema_privilege(login.oid, n.oid, 'USAGE'))) AS extra_schema_usage,
               EXISTS (SELECT 1 FROM pg_catalog.pg_class c
                        JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
                       WHERE n.nspname = 'public' AND c.relkind IN ('r','p','v','m','f')
                         AND (pg_catalog.has_table_privilege(grp.oid, c.oid, 'SELECT')
                           OR pg_catalog.has_table_privilege(grp.oid, c.oid, 'INSERT')
                           OR pg_catalog.has_table_privilege(grp.oid, c.oid, 'UPDATE')
                           OR pg_catalog.has_table_privilege(grp.oid, c.oid, 'DELETE')
                           OR pg_catalog.has_table_privilege(login.oid, c.oid, 'SELECT')
                           OR pg_catalog.has_table_privilege(login.oid, c.oid, 'INSERT')
                           OR pg_catalog.has_table_privilege(login.oid, c.oid, 'UPDATE')
                           OR pg_catalog.has_table_privilege(login.oid, c.oid, 'DELETE'))) AS extra_public_table_access,
               EXISTS (SELECT 1 FROM pg_catalog.pg_proc p
                        JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
                       WHERE n.nspname = 'notification_api' AND pg_catalog.has_function_privilege(grp.oid, p.oid, 'EXECUTE')
                         AND NOT ((p.proname = 'claim_email_batch' AND p.proargtypes = '23 23'::pg_catalog.oidvector)
                           OR (p.proname = 'resolve_email_recipient' AND p.proargtypes = '20 2950'::pg_catalog.oidvector)
                           OR (p.proname = 'acknowledge_email_sent' AND p.proargtypes = '20 2950'::pg_catalog.oidvector)
                           OR (p.proname = 'fail_email' AND p.proargtypes = '20 2950 16 25'::pg_catalog.oidvector)
                           OR (p.proname = 'delivery_health' AND p.proargtypes = ''::pg_catalog.oidvector)
                           OR (p.proname = 'worker_heartbeat' AND p.proargtypes = '16 25 16'::pg_catalog.oidvector)
                           OR (p.proname = 'worker_delivery_state' AND p.proargtypes = ''::pg_catalog.oidvector))) AS extra_function_executes
          FROM pg_catalog.pg_roles login CROSS JOIN pg_catalog.pg_roles grp
         WHERE login.rolname = current_user AND grp.rolname = 'hq_notification_worker'`);
    const role = rows[0];
    const problems: string[] = [];
    if (!role) problems.push('role_missing');
    else {
        if (role.rolsuper) problems.push('login_superuser');
        if (role.rolbypassrls) problems.push('login_bypassrls');
        if (!role.is_member) problems.push('not_worker_member');
        if (role.group_login || role.group_super || role.group_bypass) problems.push('unsafe_group_role');
        if (role.private_usage) problems.push('private_schema_usage');
        if (role.direct_table_access) problems.push('direct_table_privilege');
        if (!role.function_executes) problems.push('worker_functions_missing');
        if (role.other_memberships) problems.push('extra_role_membership');
        if (role.group_memberships) problems.push('worker_role_has_members');
        if (role.extra_function_executes) problems.push('extra_function_privilege');
        if (role.public_usage) problems.push('public_schema_usage');
        if (role.extra_schema_usage) problems.push('extra_schema_usage');
        if (role.extra_public_table_access) problems.push('public_application_table_privilege');
    }
    if (problems.length > 0) throw new Error(`Notification worker database identity is unsafe: ${problems.join(',')}`);
}
