-- Persist TLS negotiation failures as a distinct, sanitized worker health code.
CREATE OR REPLACE FUNCTION notification_api.worker_heartbeat(
    p_smtp_configured BOOLEAN, p_smtp_error_code TEXT, p_smtp_succeeded BOOLEAN
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $function$
BEGIN
    IF p_smtp_error_code IS NOT NULL AND p_smtp_error_code NOT IN (
        'smtp_timeout', 'smtp_connection_failed', 'smtp_tls_failed', 'smtp_authentication_failed',
        'smtp_temporary_rejection', 'smtp_permanent_rejection', 'smtp_send_failed'
    ) THEN
        RAISE EXCEPTION 'invalid SMTP failure code' USING ERRCODE = '22023';
    END IF;
    IF p_smtp_error_code IS NOT NULL AND p_smtp_succeeded THEN
        RAISE EXCEPTION 'conflicting SMTP outcome' USING ERRCODE = '22023';
    END IF;
    INSERT INTO notification_private.notification_worker_state AS existing(
        singleton, smtp_configured, last_seen_at, smtp_last_error_code,
        smtp_last_error_at, smtp_last_success_at
    )
    VALUES (TRUE, p_smtp_configured, pg_catalog.clock_timestamp(), p_smtp_error_code,
            CASE WHEN p_smtp_error_code IS NOT NULL THEN pg_catalog.clock_timestamp() END,
            CASE WHEN p_smtp_succeeded THEN pg_catalog.clock_timestamp() END)
    ON CONFLICT (singleton) DO UPDATE
       SET smtp_configured = EXCLUDED.smtp_configured,
           last_seen_at = EXCLUDED.last_seen_at,
           smtp_last_error_code = CASE WHEN p_smtp_error_code IS NOT NULL THEN p_smtp_error_code
                                       WHEN p_smtp_succeeded THEN NULL ELSE existing.smtp_last_error_code END,
           smtp_last_error_at = CASE WHEN p_smtp_error_code IS NOT NULL THEN pg_catalog.clock_timestamp()
                                     ELSE existing.smtp_last_error_at END,
           smtp_last_success_at = CASE WHEN p_smtp_succeeded THEN pg_catalog.clock_timestamp()
                                       ELSE existing.smtp_last_success_at END,
           updated_at = pg_catalog.clock_timestamp();
END
$function$;
