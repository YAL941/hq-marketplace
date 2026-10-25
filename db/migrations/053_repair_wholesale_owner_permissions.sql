-- Restore the Wholesale permissions expected for business owners without
-- changing memberships, business records, or permissions for other roles.
CREATE TABLE migration_053_wholesale_owner_permission_grants (
    role_id BIGINT NOT NULL REFERENCES roles (role_id) ON DELETE CASCADE,
    permission_id BIGINT NOT NULL REFERENCES permissions (permission_id) ON DELETE CASCADE,
    PRIMARY KEY (role_id, permission_id)
);

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM roles
         WHERE role_key = 'business_owner'
           AND scope = 'business'
           AND is_active
    ) THEN
        RAISE EXCEPTION 'Cannot repair Wholesale permissions: active business_owner role is missing';
    END IF;

    IF EXISTS (
        SELECT permission_key
          FROM (VALUES ('wholesale.view'), ('wholesale.manage')) AS expected(permission_key)
         WHERE NOT EXISTS (
             SELECT 1 FROM permissions p WHERE p.permission_key = expected.permission_key
         )
    ) THEN
        RAISE EXCEPTION 'Cannot repair Wholesale permissions: expected permissions are missing';
    END IF;
END $$;

WITH inserted_grants AS (
    INSERT INTO role_permissions (role_id, permission_id)
    SELECT r.role_id, p.permission_id
      FROM roles r
      CROSS JOIN permissions p
     WHERE r.role_key = 'business_owner'
       AND r.scope = 'business'
       AND r.is_active
       AND p.permission_key IN ('wholesale.view', 'wholesale.manage')
    ON CONFLICT DO NOTHING
    RETURNING role_id, permission_id
)
INSERT INTO migration_053_wholesale_owner_permission_grants (role_id, permission_id)
SELECT role_id, permission_id
  FROM inserted_grants;
