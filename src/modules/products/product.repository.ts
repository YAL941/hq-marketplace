import type { PoolClient } from 'pg';
import { forbidden, notFound } from '../../db/errors.js';
import { hasBusinessPermission, type TenantContext } from '../../db/tenant.js';

export interface ProductRow {
    product_id: string;
    business_id: string;
    category_id: string | null;
    product_name: string;
    description: string | null;
    price: string;
    discount_price: string | null;
    currency: string;
    sku: string | null;
    image_url: string | null;
    stock_quantity: number;
    is_stock_tracked: boolean;
    status: string;
    rating_avg: string;
    rating_count: number;
    created_at: Date;
    updated_at: Date;
}

export interface ListProductsQuery {
    status?: string;
    categoryId?: number;
    search?: string;
    limit?: number;
    offset?: number;
}

const MAX_PAGE_SIZE = 100;

/**
 * Every statement below is scoped by business_id. That is the first line of
 * defence; RLS is the second, and it is enforced by PostgreSQL itself even
 * if a WHERE clause were ever removed by mistake.
 */
export async function listProductsForBusiness(
    client: PoolClient,
    businessId: number,
    q: ListProductsQuery,
): Promise<ProductRow[]> {
    const conditions: string[] = ['p.business_id = $1', 'p.deleted_at IS NULL'];
    const params: unknown[] = [businessId];

    if (q.status) {
        params.push(q.status);
        conditions.push(`p.status = $${params.length}`);
    }
    if (q.categoryId !== undefined) {
        params.push(q.categoryId);
        conditions.push(`p.category_id = $${params.length}`);
    }
    if (q.search) {
        params.push(`%${q.search.toLowerCase()}%`);
        conditions.push(`lower(p.product_name) LIKE $${params.length}`);
    }

    params.push(Math.min(q.limit ?? 50, MAX_PAGE_SIZE));
    const limitIdx = params.length;
    params.push(Math.max(q.offset ?? 0, 0));
    const offsetIdx = params.length;

    const { rows } = await client.query<ProductRow>(
        `SELECT p.*
           FROM products p
          WHERE ${conditions.join(' AND ')}
          ORDER BY p.created_at DESC, p.product_id DESC
          LIMIT $${limitIdx} OFFSET $${offsetIdx}`,
        params,
    );
    return rows;
}

export async function getProductForBusiness(
    client: PoolClient,
    businessId: number,
    productId: number,
): Promise<ProductRow | null> {
    const { rows } = await client.query<ProductRow>(
        'SELECT * FROM products WHERE product_id = $1 AND business_id = $2 AND deleted_at IS NULL',
        [productId, businessId],
    );
    return rows[0] ?? null;
}

export interface CreateProductInput {
    productName: string;
    categoryId?: number | null;
    description?: string | null;
    price: number;
    currency?: string;
    sku?: string | null;
    imageUrl?: string | null;
    stockQuantity?: number;
    status?: string;
}

export async function createProduct(
    ctx: TenantContext,
    client: PoolClient,
    businessId: number,
    input: CreateProductInput,
): Promise<ProductRow> {
    if (!(await hasBusinessPermissionInClient(client, ctx, businessId, 'products.create'))) {
        throw forbidden('Missing permission: products.create');
    }
    const { rows } = await client.query<ProductRow>(
        `INSERT INTO products
            (business_id, category_id, product_name, description, price, currency, sku, image_url,
             stock_quantity, status)
         VALUES ($1, $2, $3, $4, $5, COALESCE($6::char(3), 'USD'), $7, $8, $9, COALESCE($10::catalog_status, 'draft'::catalog_status))
         RETURNING *`,
        [
            businessId,
            input.categoryId ?? null,
            input.productName,
            input.description ?? null,
            input.price,
            input.currency ?? null,
            input.sku ?? null,
            input.imageUrl ?? null,
            input.stockQuantity ?? 0,
            input.status ?? null,
        ],
    );
    return rows[0]!;
}

export async function updateProduct(
    client: PoolClient,
    businessId: number,
    productId: number,
    patch: Partial<CreateProductInput>,
): Promise<ProductRow | null> {
    const columns: Record<string, string> = {
        productName: 'product_name',
        categoryId: 'category_id',
        description: 'description',
        price: 'price',
        currency: 'currency',
        sku: 'sku',
        imageUrl: 'image_url',
        stockQuantity: 'stock_quantity',
        status: 'status',
    };
    const sets: string[] = [];
    const params: unknown[] = [productId, businessId];
    for (const [key, column] of Object.entries(columns)) {
        const value = (patch as Record<string, unknown>)[key];
        if (value !== undefined) {
            params.push(value);
            sets.push(`${column} = $${params.length}`);
        }
    }
    if (sets.length === 0) return getProductForBusiness(client, businessId, productId);

    const { rows } = await client.query<ProductRow>(
        `UPDATE products SET ${sets.join(', ')}
          WHERE product_id = $1 AND business_id = $2 AND deleted_at IS NULL
          RETURNING *`,
        params,
    );
    return rows[0] ?? null;
}

/** Soft delete: product rows referenced by order_items must survive. */
export async function archiveProduct(client: PoolClient, businessId: number, productId: number): Promise<boolean> {
    const { rowCount } = await client.query(
        `UPDATE products SET deleted_at = now(), status = 'archived'
          WHERE product_id = $1 AND business_id = $2 AND deleted_at IS NULL`,
        [productId, businessId],
    );
    return (rowCount ?? 0) > 0;
}

/** Public catalogue listing. RLS decides which businesses are visible. */
export async function listPublicProducts(
    client: PoolClient,
    q: { categoryId?: number; businessId?: number; search?: string; limit?: number; offset?: number },
): Promise<ProductRow[]> {
    const conditions: string[] = ['p.status = $1', 'p.deleted_at IS NULL'];
    const params: unknown[] = ['active'];

    if (q.businessId !== undefined) {
        params.push(q.businessId);
        conditions.push(`p.business_id = $${params.length}`);
    }
    if (q.categoryId !== undefined) {
        params.push(q.categoryId);
        conditions.push(`p.category_id = $${params.length}`);
    }
    if (q.search) {
        params.push(`%${q.search.toLowerCase()}%`);
        conditions.push(`lower(p.product_name) LIKE $${params.length}`);
    }
    params.push(Math.min(q.limit ?? 50, MAX_PAGE_SIZE));
    const limitIdx = params.length;
    params.push(Math.max(q.offset ?? 0, 0));
    const offsetIdx = params.length;

    const { rows } = await client.query<ProductRow>(
        `SELECT p.*
           FROM products p
          WHERE ${conditions.join(' AND ')}
          ORDER BY p.created_at DESC, p.product_id DESC
          LIMIT $${limitIdx} OFFSET $${offsetIdx}`,
        params,
    );
    return rows;
}

export async function requireProduct(client: PoolClient, businessId: number, productId: number): Promise<ProductRow> {
    const product = await getProductForBusiness(client, businessId, productId);
    if (!product) throw notFound('Product not found in this business');
    return product;
}

/** Runs the permission check inside the same transaction/connection. */
async function hasBusinessPermissionInClient(
    client: PoolClient,
    _ctx: TenantContext,
    businessId: number,
    permission: string,
): Promise<boolean> {
    const { rows } = await client.query<{ allowed: boolean }>(
        'SELECT (app_has_business_permission($1, $2) OR app_is_platform_admin()) AS allowed',
        [businessId, permission],
    );
    return rows[0]?.allowed === true;
}
