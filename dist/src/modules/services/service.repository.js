import { forbidden, notFound } from '../../db/errors.js';
export async function listServicesForBusiness(client, businessId, q) {
    const conditions = ['s.business_id = $1', 's.deleted_at IS NULL'];
    const params = [businessId];
    if (q.status) {
        params.push(q.status);
        conditions.push(`s.status = $${params.length}`);
    }
    if (q.serviceCategoryId !== undefined) {
        params.push(q.serviceCategoryId);
        conditions.push(`s.service_category_id = $${params.length}`);
    }
    if (q.search) {
        params.push(`%${q.search.toLowerCase()}%`);
        conditions.push(`lower(s.service_name) LIKE $${params.length}`);
    }
    params.push(Math.min(q.limit ?? 50, 100));
    const limitIdx = params.length;
    params.push(Math.max(q.offset ?? 0, 0));
    const offsetIdx = params.length;
    const { rows } = await client.query(`SELECT s.* FROM services s
          WHERE ${conditions.join(' AND ')}
          ORDER BY s.created_at DESC, s.service_id DESC
          LIMIT $${limitIdx} OFFSET $${offsetIdx}`, params);
    return rows;
}
export async function createService(client, businessId, input) {
    await assertPermission(client, businessId, 'services.create');
    const { rows } = await client.query(`INSERT INTO services
            (business_id, service_category_id, location_id, service_name, description, price, currency,
             duration_minutes, capacity, is_bookable, status)
         VALUES ($1, $2, $3, $4, $5, $6, COALESCE($7::char(3), 'USD'), $8, $9, COALESCE($10, TRUE), COALESCE($11::catalog_status, 'draft'::catalog_status))
         RETURNING *`, [
        businessId,
        input.serviceCategoryId ?? null,
        input.locationId ?? null,
        input.serviceName,
        input.description ?? null,
        input.price,
        input.currency ?? null,
        input.durationMinutes ?? null,
        input.capacity ?? null,
        input.isBookable ?? null,
        input.status ?? null,
    ]);
    return rows[0];
}
export async function updateService(client, businessId, serviceId, patch) {
    await assertPermission(client, businessId, 'services.edit');
    const columns = {
        serviceName: 'service_name',
        serviceCategoryId: 'service_category_id',
        locationId: 'location_id',
        description: 'description',
        price: 'price',
        currency: 'currency',
        durationMinutes: 'duration_minutes',
        capacity: 'capacity',
        isBookable: 'is_bookable',
        status: 'status',
    };
    const sets = [];
    const params = [serviceId, businessId];
    for (const [key, column] of Object.entries(columns)) {
        const value = patch[key];
        if (value !== undefined) {
            params.push(value);
            sets.push(`${column} = $${params.length}`);
        }
    }
    if (sets.length === 0)
        return getService(client, businessId, serviceId);
    const { rows } = await client.query(`UPDATE services SET ${sets.join(', ')}
          WHERE service_id = $1 AND business_id = $2 AND deleted_at IS NULL
          RETURNING *`, params);
    return rows[0] ?? null;
}
export async function getService(client, businessId, serviceId) {
    const { rows } = await client.query('SELECT * FROM services WHERE service_id = $1 AND business_id = $2 AND deleted_at IS NULL', [serviceId, businessId]);
    if (!rows[0])
        throw notFound('Service not found in this business');
    return rows[0];
}
export async function listPublicServices(client, q) {
    const conditions = ["s.status = 'active'", 's.deleted_at IS NULL'];
    const params = [];
    if (q.businessId !== undefined) {
        params.push(q.businessId);
        conditions.push(`s.business_id = $${params.length}`);
    }
    if (q.serviceCategoryId !== undefined) {
        params.push(q.serviceCategoryId);
        conditions.push(`s.service_category_id = $${params.length}`);
    }
    if (q.search) {
        params.push(`%${q.search.toLowerCase()}%`);
        conditions.push(`lower(s.service_name) LIKE $${params.length}`);
    }
    params.push(Math.min(q.limit ?? 50, 100));
    const limitIdx = params.length;
    params.push(Math.max(q.offset ?? 0, 0));
    const offsetIdx = params.length;
    const { rows } = await client.query(`SELECT s.* FROM services s
          WHERE ${conditions.join(' AND ')}
          ORDER BY s.created_at DESC, s.service_id DESC
          LIMIT $${limitIdx} OFFSET $${offsetIdx}`, params);
    return rows;
}
export async function assertPermission(client, businessId, permission) {
    const { rows } = await client.query('SELECT (app_has_business_permission($1, $2) OR app_is_platform_admin()) AS allowed', [businessId, permission]);
    if (rows[0]?.allowed !== true)
        throw forbidden(`Missing permission: ${permission}`);
}
//# sourceMappingURL=service.repository.js.map