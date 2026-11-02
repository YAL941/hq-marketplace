import type { Pool, PoolClient } from 'pg';

export const HQ_APP_FUNCTION_ALLOWLIST = [
    { signature: 'app_user_id()', description: 'RLS session helper' },
    { signature: 'app_is_platform_admin()', description: 'Platform admin RLS helper' },
    { signature: 'app_current_business_id()', description: 'Tenant session helper' },
    { signature: 'app_is_business_member(BIGINT)', description: 'Business membership RLS helper' },
    { signature: 'app_has_business_permission(BIGINT, TEXT)', description: 'Permission RLS and API helper' },
    { signature: 'app_business_ids()', description: 'Business membership RLS helper' },
    { signature: 'app_business_is_public(BIGINT)', description: 'Public business visibility helper' },
    { signature: 'app_business_has_no_members(BIGINT)', description: 'Onboarding RLS helper' },
    { signature: 'app_user_for_login(TEXT)', description: 'Login lookup' },
    { signature: 'app_public_reviews(BIGINT, INTEGER, INTEGER)', description: 'Public review reader' },
    { signature: 'app_public_product_reviews(BIGINT, INTEGER, INTEGER)', description: 'Public product review reader' },
    { signature: 'user_email_is_verified(BIGINT)', description: 'Login email verification' },
    { signature: 'issue_user_email_verification_code(CITEXT, TEXT, TIMESTAMPTZ)', description: 'Email verification issuance' },
    { signature: 'verify_user_email_code(CITEXT, TEXT)', description: 'Email verification consumption' },
    { signature: 'create_user_password_reset_token(CITEXT, TEXT, TIMESTAMPTZ)', description: 'Password reset issuance' },
    { signature: 'consume_user_password_reset_token(TEXT, TEXT)', description: 'Password reset consumption' },
    { signature: 'app_payment_notification_customer(BIGINT)', description: 'Payment notification lookup' },
    { signature: 'increment_business_profile_views(BIGINT)', description: 'Profile view counters' },
    { signature: 'refresh_business_statistics(BIGINT)', description: 'Business statistics refresh' },
    { signature: 'reserve_order_product(BIGINT, BIGINT, INTEGER, BIGINT)', description: 'Checkout stock reservation' },
    { signature: 'lock_order_inventory_products(BIGINT, BIGINT[])', description: 'Checkout inventory locking' },
    { signature: 'record_order_stock_sale(BIGINT)', description: 'Order stock sale recording' },
    { signature: 'apply_inventory_stock_delta(BIGINT, BIGINT, INTEGER)', description: 'Inventory adjustments' },
    { signature: 'apply_verified_payment_event(TEXT, TEXT, TEXT, BIGINT, TEXT, BOOLEAN, INTEGER, JSONB)', description: 'Payment webhook processing' },
    { signature: 'create_wholesale_event_notifications(BIGINT, TEXT, BIGINT, TEXT, BIGINT, JSONB)', description: 'Wholesale notification creation' },
    { signature: 'wholesale_notification_recipients_for_event(BIGINT, BIGINT)', description: 'Wholesale notification replay' },
    { signature: 'enqueue_notification_email(TEXT, TEXT, TEXT, BIGINT, TEXT, BIGINT, BIGINT, BIGINT, JSONB)', description: 'Validated notification outbox enqueue' },
    { signature: 'enqueue_new_order_email(BIGINT)', description: 'Verified merchant recipient resolution for new orders' },
] as const;

const HQ_APP_FUNCTION_SIGNATURES = HQ_APP_FUNCTION_ALLOWLIST.map(({ signature }) => signature);

const SENSITIVE_FUNCTION_SIGNATURES = [
    'app_is_business_member(BIGINT)',
    'app_has_business_permission(BIGINT, TEXT)',
    'app_business_ids()',
    'app_business_is_public(BIGINT)',
    'app_business_has_no_members(BIGINT)',
    'app_user_for_login(TEXT)',
    'refresh_business_statistics(BIGINT)',
    'increment_business_profile_views(BIGINT)',
    'reserve_order_product(BIGINT, BIGINT, INTEGER, BIGINT)',
    'lock_order_inventory_products(BIGINT, BIGINT[])',
    'record_order_stock_sale(BIGINT)',
    'apply_inventory_stock_delta(BIGINT, BIGINT, INTEGER)',
    'issue_user_email_verification_code(CITEXT, TEXT, TIMESTAMPTZ)',
    'verify_user_email_code(CITEXT, TEXT)',
    'user_email_is_verified(BIGINT)',
    'app_public_reviews(BIGINT, INTEGER, INTEGER)',
    'app_public_product_reviews(BIGINT, INTEGER, INTEGER)',
    'enqueue_notification_email(TEXT, TEXT, TEXT, BIGINT, TEXT, BIGINT, BIGINT, BIGINT, JSONB)',
    'enqueue_new_order_email(BIGINT)',
] as const;

const TRIGGER_ONLY_FUNCTION_SIGNATURES = [
    'set_updated_at()',
    'assert_platform_role_scope()',
    'assert_business_role_scope()',
    'set_order_number()',
    'append_order_status_history()',
    'append_delivery_status_history()',
    'restock_cancelled_order()',
    'assert_inventory_product_total()',
    'reconcile_terminal_order_payment()',
] as const;

/**
 * Grants for the application role.
 *
 * The application connects as a role that does NOT own the schema, so its
 * statements are filtered by the RLS policies. Running the API as the owner
 * would silently disable the isolation this project depends on.
 *
 * Accepts a Pool as well as a PoolClient: DDL grants must run outside a
 * transaction block, so this uses the pool directly rather than a client.
 */
export async function applyGrants(
    client: Pick<Pool | PoolClient, 'query'>,
    role: string,
    password: string,
): Promise<{ created: boolean }> {
    const passwordLiteral = `'${password.replace(/'/g, "''")}'`;
    const roleIdent = `"${role.replace(/"/g, '""')}"`;
    const roleLiteral = `'${role.replace(/'/g, "''")}'`;

    const { rows } = await client.query<{ rolname: string }>('SELECT rolname FROM pg_roles WHERE rolname = $1', [role]);
    const created = rows.length === 0;

    if (created) {
        await client.query(`CREATE ROLE ${roleIdent} LOGIN PASSWORD ${passwordLiteral}`);
    } else {
        await client.query(`ALTER ROLE ${roleIdent} LOGIN PASSWORD ${passwordLiteral}`);
    }

    await client.query('REVOKE ALL ON SCHEMA public FROM PUBLIC');
    await client.query(`GRANT USAGE ON SCHEMA public TO ${roleIdent}`);
    await client.query(`GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO ${roleIdent}`);
    await client.query(`GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO ${roleIdent}`);
    // Restrict public-schema execution, then explicitly restore the hq_app API
    // and extension operators it uses. This is based on the repository's only
    // supported runtime database client; compatibility for undocumented SQL
    // clients is an operational decision and is called out in the audit.
    await client.query('REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA public FROM PUBLIC');
    await client.query('REVOKE ALL ON ALL FUNCTIONS IN SCHEMA public FROM ' + roleIdent);
    await client.query('REVOKE ALL ON ALL PROCEDURES IN SCHEMA public FROM ' + roleIdent);

    // Operators supplied by extensions invoke their backing functions
    // implicitly. Keep installed extension routines usable to hq_app after the
    // explicit role revoke above. These are extension-owned, not project APIs.
    await client.query(`
        DO $extension_grants$
        DECLARE function_signature TEXT;
        BEGIN
            FOR function_signature IN
                SELECT p.oid::regprocedure::TEXT
                  FROM pg_catalog.pg_proc p
                  JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
                  JOIN pg_catalog.pg_depend d ON d.classid = 'pg_catalog.pg_proc'::pg_catalog.regclass
                                             AND d.objid = p.oid
                                             AND d.refclassid = 'pg_catalog.pg_extension'::pg_catalog.regclass
                                             AND d.deptype = 'e'
                  JOIN pg_catalog.pg_extension e ON e.oid = d.refobjid
                 WHERE n.nspname = 'public' AND e.extname = 'citext'
            LOOP
                EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO %I', function_signature, ${roleLiteral});
            END LOOP;
        END $extension_grants$
    `);

    // Remove any broad future-function grant from every role that owns
    // default privileges in public. Migrations run through the admin pool, so
    // its current role is the normal migration owner; other owner names are
    // discovered explicitly as well.
    await client.query(`
        DO $do$
        DECLARE
            owner_name TEXT;
        BEGIN
            owner_name := current_user;
            EXECUTE format(
                'ALTER DEFAULT PRIVILEGES FOR ROLE %I IN SCHEMA public
                 REVOKE EXECUTE ON FUNCTIONS FROM %I',
                owner_name, ${roleLiteral}
            );
            EXECUTE format(
                'ALTER DEFAULT PRIVILEGES FOR ROLE %I IN SCHEMA public
                 REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC',
                owner_name
            );
            FOR owner_name IN
                SELECT DISTINCT r.rolname
                  FROM pg_default_acl d
                  JOIN pg_roles r ON r.oid = d.defaclrole
                 WHERE d.defaclnamespace = 'public'::regnamespace
                   AND d.defaclobjtype = 'f'
            LOOP
                EXECUTE format(
                    'ALTER DEFAULT PRIVILEGES FOR ROLE %I IN SCHEMA public
                     REVOKE EXECUTE ON FUNCTIONS FROM %I',
                    owner_name, ${roleLiteral}
                );
                EXECUTE format(
                    'ALTER DEFAULT PRIVILEGES FOR ROLE %I IN SCHEMA public
                     REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC',
                    owner_name
                );
            END LOOP;
        END $do$
    `);

    // Exact direct application and RLS dependencies.
    for (const signature of HQ_APP_FUNCTION_SIGNATURES) {
        await client.query(`GRANT EXECUTE ON FUNCTION ${signature} TO ${roleIdent}`);
    }

    // Sensitive project functions and explicitly PUBLIC-granted migration
    // functions must not remain callable by PUBLIC.
    for (const signature of SENSITIVE_FUNCTION_SIGNATURES) {
        await client.query(`REVOKE ALL ON FUNCTION ${signature} FROM PUBLIC`);
    }

    // Trigger functions execute through triggers, not through hq_app SQL calls.
    for (const signature of TRIGGER_ONLY_FUNCTION_SIGNATURES) {
        await client.query(`REVOKE ALL ON FUNCTION ${signature} FROM ${roleIdent}`);
        await client.query(`REVOKE ALL ON FUNCTION ${signature} FROM PUBLIC`);
    }

    // the migration ledger belongs to the admin role only
    await client.query('DO $do$ BEGIN REVOKE ALL ON schema_migrations FROM PUBLIC; EXCEPTION WHEN undefined_table THEN NULL; END $do$');

    return { created };
}
