COMMENT ON FUNCTION wholesale_notification_recipients_for_event(BIGINT, BIGINT) IS
'SECURITY DEFINER allows the function to read wholesale and notification rows needed for authorized recipient lookup while preserving explicit actor, business-party, and wholesale.manage checks.';
