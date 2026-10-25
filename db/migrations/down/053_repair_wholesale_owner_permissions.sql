DELETE FROM role_permissions rp
 USING migration_053_wholesale_owner_permission_grants tracked
 WHERE rp.role_id = tracked.role_id
   AND rp.permission_id = tracked.permission_id;

DROP TABLE migration_053_wholesale_owner_permission_grants;
