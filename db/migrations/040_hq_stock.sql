ALTER TABLE products
    ADD COLUMN unit_of_measure TEXT NOT NULL DEFAULT 'piece',
    ADD COLUMN minimum_stock INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN barcode TEXT,
    ADD CONSTRAINT products_unit_of_measure_valid
        CHECK (char_length(btrim(unit_of_measure)) BETWEEN 1 AND 32),
    ADD CONSTRAINT products_minimum_stock_non_negative CHECK (minimum_stock >= 0),
    ADD CONSTRAINT products_barcode_valid
        CHECK (barcode IS NULL OR char_length(btrim(barcode)) BETWEEN 1 AND 128),
    ADD CONSTRAINT products_business_barcode_unique UNIQUE (business_id, barcode);

CREATE TABLE inventory_balances (
    inventory_balance_id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    business_id BIGINT NOT NULL REFERENCES businesses (business_id) ON DELETE RESTRICT,
    product_id BIGINT NOT NULL,
    location_id BIGINT,
    quantity INTEGER NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT inventory_balances_quantity_non_negative CHECK (quantity >= 0),
    CONSTRAINT inventory_balances_product_business_fk
        FOREIGN KEY (product_id, business_id)
        REFERENCES products (product_id, business_id) ON DELETE RESTRICT,
    CONSTRAINT inventory_balances_location_business_fk
        FOREIGN KEY (location_id, business_id)
        REFERENCES business_locations (location_id, business_id) ON DELETE RESTRICT,
    CONSTRAINT inventory_balances_location_unique
        UNIQUE NULLS NOT DISTINCT (product_id, location_id)
);

CREATE INDEX ix_inventory_balances_business_location
    ON inventory_balances (business_id, location_id, product_id);

CREATE TRIGGER trg_inventory_balances_updated_at
    BEFORE UPDATE ON inventory_balances
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE stock_movements (
    stock_movement_id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    business_id BIGINT NOT NULL REFERENCES businesses (business_id) ON DELETE RESTRICT,
    product_id BIGINT NOT NULL,
    location_id BIGINT,
    movement_type TEXT NOT NULL,
    quantity INTEGER NOT NULL,
    previous_quantity INTEGER NOT NULL,
    resulting_quantity INTEGER NOT NULL,
    source_type TEXT,
    source_reference TEXT,
    acting_user_id BIGINT REFERENCES users (user_id) ON DELETE SET NULL,
    note TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT stock_movements_product_business_fk
        FOREIGN KEY (product_id, business_id)
        REFERENCES products (product_id, business_id) ON DELETE RESTRICT,
    CONSTRAINT stock_movements_location_business_fk
        FOREIGN KEY (location_id, business_id)
        REFERENCES business_locations (location_id, business_id) ON DELETE RESTRICT,
    CONSTRAINT stock_movements_quantity_positive CHECK (quantity > 0),
    CONSTRAINT stock_movements_quantities_non_negative CHECK (
        previous_quantity >= 0 AND resulting_quantity >= 0
    ),
    CONSTRAINT stock_movements_type_valid CHECK (movement_type IN (
        'opening_balance', 'purchase', 'sale', 'return',
        'adjustment_in', 'adjustment_out', 'cancellation_restore'
    )),
    CONSTRAINT stock_movements_direction_valid CHECK (
        (movement_type IN ('opening_balance', 'purchase', 'return', 'adjustment_in', 'cancellation_restore')
            AND resulting_quantity = previous_quantity + quantity)
        OR (movement_type IN ('sale', 'adjustment_out')
            AND resulting_quantity = previous_quantity - quantity)
    ),
    CONSTRAINT stock_movements_source_valid CHECK (
        (source_type IS NULL AND source_reference IS NULL)
        OR (source_type IS NOT NULL AND source_reference IS NOT NULL)
    )
);

CREATE INDEX ix_stock_movements_business_created
    ON stock_movements (business_id, created_at DESC, stock_movement_id DESC);
CREATE INDEX ix_stock_movements_product_created
    ON stock_movements (business_id, product_id, created_at DESC, stock_movement_id DESC);
CREATE UNIQUE INDEX uq_stock_movements_source_event
    ON stock_movements (source_type, source_reference, product_id, movement_type)
    WHERE source_type IS NOT NULL AND source_reference IS NOT NULL;

CREATE TABLE stock_restock_requests (
    restock_request_id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    business_id BIGINT NOT NULL REFERENCES businesses (business_id) ON DELETE RESTRICT,
    product_id BIGINT NOT NULL,
    location_id BIGINT,
    requested_quantity INTEGER NOT NULL,
    status TEXT NOT NULL DEFAULT 'requested',
    integration_key TEXT NOT NULL DEFAULT 'hq_wholesale',
    external_reference TEXT,
    requested_by BIGINT REFERENCES users (user_id) ON DELETE SET NULL,
    note TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT stock_restock_requests_product_business_fk
        FOREIGN KEY (product_id, business_id)
        REFERENCES products (product_id, business_id) ON DELETE RESTRICT,
    CONSTRAINT stock_restock_requests_location_business_fk
        FOREIGN KEY (location_id, business_id)
        REFERENCES business_locations (location_id, business_id) ON DELETE RESTRICT,
    CONSTRAINT stock_restock_requests_quantity_positive CHECK (requested_quantity > 0),
    CONSTRAINT stock_restock_requests_status_valid
        CHECK (status IN ('requested', 'acknowledged', 'fulfilled', 'cancelled')),
    CONSTRAINT stock_restock_requests_integration_key_valid
        CHECK (integration_key ~ '^[a-z][a-z0-9_]{1,48}$')
);

CREATE INDEX ix_stock_restock_requests_business_created
    ON stock_restock_requests (business_id, created_at DESC, restock_request_id DESC);
CREATE UNIQUE INDEX uq_stock_restock_requests_one_unresolved
    ON stock_restock_requests (business_id, product_id, COALESCE(location_id, 0))
    WHERE status IN ('requested', 'acknowledged');

CREATE TRIGGER trg_stock_restock_requests_updated_at
    BEFORE UPDATE ON stock_restock_requests
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

ALTER TABLE order_items ADD COLUMN inventory_location_id BIGINT;
ALTER TABLE order_items
    ADD CONSTRAINT order_items_inventory_location_business_fk
    FOREIGN KEY (inventory_location_id, business_id)
    REFERENCES business_locations (location_id, business_id) ON DELETE RESTRICT;

-- Existing product quantities become the opening balance at the business's
-- primary active branch, or the unassigned business stock bucket if none exists.
INSERT INTO inventory_balances (business_id, product_id, location_id, quantity)
SELECT p.business_id, p.product_id, primary_location.location_id, p.stock_quantity
  FROM products p
  LEFT JOIN LATERAL (
      SELECT bl.location_id
        FROM business_locations bl
       WHERE bl.business_id = p.business_id AND bl.is_active
       ORDER BY bl.is_primary DESC, bl.created_at, bl.location_id
       LIMIT 1
  ) primary_location ON TRUE
ON CONFLICT ON CONSTRAINT inventory_balances_location_unique DO NOTHING;

INSERT INTO stock_movements (
    business_id, product_id, location_id, movement_type, quantity,
    previous_quantity, resulting_quantity, source_type, source_reference, note
)
SELECT business_id, product_id, location_id, 'opening_balance', quantity,
       0, quantity, 'migration', '040', 'Existing stock at HQ Stock rollout'
  FROM inventory_balances
 WHERE quantity > 0;

UPDATE order_items oi
   SET inventory_location_id = COALESCE(
       o.location_id,
       (
           SELECT bl.location_id
             FROM business_locations bl
            WHERE bl.business_id = oi.business_id AND bl.is_active
            ORDER BY bl.is_primary DESC, bl.created_at, bl.location_id
            LIMIT 1
       )
   )
  FROM orders o
 WHERE o.order_id = oi.order_id
   AND oi.product_id IS NOT NULL;

INSERT INTO permissions (permission_key, description, resource, action) VALUES
    ('inventory.view', 'View stock balances, movements and reports for the current business', 'inventory', 'view'),
    ('inventory.manage', 'Receive, return and adjust stock and manage restock requests for the current business', 'inventory', 'manage')
ON CONFLICT (permission_key) DO NOTHING;

INSERT INTO role_permissions (role_id, permission_id)
SELECT r.role_id, p.permission_id
  FROM roles r
 CROSS JOIN permissions p
 WHERE (r.role_key IN ('business_owner', 'business_manager')
        AND p.permission_key IN ('inventory.view', 'inventory.manage'))
    OR (r.role_key = 'business_employee' AND p.permission_key = 'inventory.view')
    OR (r.role_key = 'platform_admin' AND p.permission_key IN ('inventory.view', 'inventory.manage'))
ON CONFLICT DO NOTHING;

ALTER TABLE inventory_balances ENABLE ROW LEVEL SECURITY;
CREATE POLICY inventory_balances_read ON inventory_balances
    FOR SELECT USING (app_has_business_permission(business_id, 'inventory.view') OR app_is_platform_admin());
CREATE POLICY inventory_balances_insert ON inventory_balances
    FOR INSERT WITH CHECK (app_has_business_permission(business_id, 'inventory.manage') OR app_is_platform_admin());
CREATE POLICY inventory_balances_update ON inventory_balances
    FOR UPDATE
    USING (app_has_business_permission(business_id, 'inventory.manage') OR app_is_platform_admin())
    WITH CHECK (app_has_business_permission(business_id, 'inventory.manage') OR app_is_platform_admin());

ALTER TABLE stock_movements ENABLE ROW LEVEL SECURITY;
CREATE POLICY stock_movements_read ON stock_movements
    FOR SELECT USING (app_has_business_permission(business_id, 'inventory.view') OR app_is_platform_admin());
CREATE POLICY stock_movements_insert ON stock_movements
    FOR INSERT WITH CHECK (app_has_business_permission(business_id, 'inventory.manage') OR app_is_platform_admin());

ALTER TABLE stock_restock_requests ENABLE ROW LEVEL SECURITY;
CREATE POLICY stock_restock_requests_read ON stock_restock_requests
    FOR SELECT USING (app_has_business_permission(business_id, 'inventory.view') OR app_is_platform_admin());
CREATE POLICY stock_restock_requests_insert ON stock_restock_requests
    FOR INSERT WITH CHECK (app_has_business_permission(business_id, 'inventory.manage') OR app_is_platform_admin());
CREATE POLICY stock_restock_requests_update ON stock_restock_requests
    FOR UPDATE
    USING (app_has_business_permission(business_id, 'inventory.manage') OR app_is_platform_admin())
    WITH CHECK (app_has_business_permission(business_id, 'inventory.manage') OR app_is_platform_admin());

DROP FUNCTION reserve_order_product(BIGINT, BIGINT, INTEGER);

CREATE FUNCTION reserve_order_product(
    p_product_id BIGINT,
    p_business_id BIGINT,
    p_quantity INTEGER,
    p_location_id BIGINT
)
RETURNS TABLE (
    reservation_status TEXT,
    product_name TEXT,
    price NUMERIC(14, 2),
    discount_price NUMERIC(14, 2),
    currency TEXT,
    stock_quantity INTEGER,
    is_stock_tracked BOOLEAN
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_product products%ROWTYPE;
    v_location_quantity INTEGER;
BEGIN
    IF app_user_id() IS NULL OR p_quantity <= 0 OR NOT app_business_is_public(p_business_id) THEN
        RAISE EXCEPTION 'not allowed to reserve product stock'
            USING ERRCODE = 'insufficient_privilege';
    END IF;

    IF p_location_id IS NOT NULL AND NOT EXISTS (
        SELECT 1 FROM business_locations bl
         WHERE bl.business_id = p_business_id
           AND bl.location_id = p_location_id
           AND bl.is_active
    ) THEN
        RAISE EXCEPTION 'invalid inventory location' USING ERRCODE = 'foreign_key_violation';
    END IF;

    SELECT p.* INTO v_product
      FROM products p
     WHERE p.product_id = p_product_id
       AND p.business_id = p_business_id
       AND p.deleted_at IS NULL
       AND p.status = 'active'
     FOR UPDATE;

    IF NOT FOUND THEN
        RETURN QUERY SELECT 'not_found'::TEXT, NULL::TEXT, NULL::NUMERIC(14, 2),
                            NULL::NUMERIC(14, 2), NULL::TEXT, NULL::INTEGER, NULL::BOOLEAN;
        RETURN;
    END IF;

    IF v_product.is_stock_tracked THEN
        INSERT INTO inventory_balances (business_id, product_id, location_id, quantity)
        VALUES (p_business_id, p_product_id, p_location_id, 0)
        ON CONFLICT ON CONSTRAINT inventory_balances_location_unique DO NOTHING;

        SELECT ib.quantity INTO v_location_quantity
          FROM inventory_balances ib
         WHERE ib.product_id = p_product_id
           AND ib.business_id = p_business_id
           AND ib.location_id IS NOT DISTINCT FROM p_location_id
         FOR UPDATE;

        IF v_location_quantity < p_quantity THEN
            RETURN QUERY SELECT 'shortage'::TEXT, NULL::TEXT, NULL::NUMERIC(14, 2),
                                NULL::NUMERIC(14, 2), NULL::TEXT, NULL::INTEGER, NULL::BOOLEAN;
            RETURN;
        END IF;

        UPDATE inventory_balances ib
           SET quantity = ib.quantity - p_quantity
         WHERE ib.product_id = p_product_id
           AND ib.business_id = p_business_id
           AND ib.location_id IS NOT DISTINCT FROM p_location_id;

        UPDATE products p
           SET stock_quantity = p.stock_quantity - p_quantity
         WHERE p.product_id = p_product_id AND p.business_id = p_business_id
         RETURNING p.* INTO v_product;
    END IF;

    RETURN QUERY SELECT 'reserved'::TEXT, v_product.product_name, v_product.price,
                        v_product.discount_price, v_product.currency::TEXT,
                        v_product.stock_quantity, v_product.is_stock_tracked;
END;
$$;

REVOKE ALL ON FUNCTION reserve_order_product(BIGINT, BIGINT, INTEGER, BIGINT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION reserve_order_product(BIGINT, BIGINT, INTEGER, BIGINT) TO PUBLIC;

CREATE OR REPLACE FUNCTION restock_cancelled_order()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_item RECORD;
    v_previous_quantity INTEGER;
BEGIN
    IF NEW.order_status IN ('cancelled', 'rejected')
       AND OLD.order_status NOT IN ('cancelled', 'rejected') THEN
        FOR v_item IN
            SELECT oi.product_id, oi.business_id, oi.inventory_location_id,
                   SUM(oi.quantity)::INTEGER AS quantity
              FROM order_items oi
              JOIN products p
                ON p.product_id = oi.product_id
               AND p.business_id = oi.business_id
               AND p.is_stock_tracked
             WHERE oi.order_id = NEW.order_id
               AND oi.product_id IS NOT NULL
             GROUP BY oi.product_id, oi.business_id, oi.inventory_location_id
             ORDER BY oi.product_id, oi.inventory_location_id
        LOOP
            IF EXISTS (
                SELECT 1 FROM stock_movements sm
                 WHERE sm.source_type = 'order'
                   AND sm.source_reference = NEW.order_id::TEXT
                   AND sm.product_id = v_item.product_id
                   AND sm.movement_type = 'cancellation_restore'
            ) THEN
                CONTINUE;
            END IF;

            PERFORM 1 FROM products p
             WHERE p.product_id = v_item.product_id
               AND p.business_id = v_item.business_id
             FOR UPDATE;

            INSERT INTO inventory_balances (business_id, product_id, location_id, quantity)
            VALUES (v_item.business_id, v_item.product_id, v_item.inventory_location_id, 0)
            ON CONFLICT ON CONSTRAINT inventory_balances_location_unique DO NOTHING;

            SELECT ib.quantity INTO v_previous_quantity
              FROM inventory_balances ib
             WHERE ib.product_id = v_item.product_id
               AND ib.business_id = v_item.business_id
               AND ib.location_id IS NOT DISTINCT FROM v_item.inventory_location_id
             FOR UPDATE;

            UPDATE inventory_balances ib
               SET quantity = ib.quantity + v_item.quantity
             WHERE ib.product_id = v_item.product_id
               AND ib.business_id = v_item.business_id
               AND ib.location_id IS NOT DISTINCT FROM v_item.inventory_location_id;

            UPDATE products p
               SET stock_quantity = p.stock_quantity + v_item.quantity
             WHERE p.product_id = v_item.product_id AND p.business_id = v_item.business_id;

            INSERT INTO stock_movements (
                business_id, product_id, location_id, movement_type, quantity,
                previous_quantity, resulting_quantity, source_type, source_reference,
                acting_user_id, note
            ) VALUES (
                v_item.business_id, v_item.product_id, v_item.inventory_location_id,
                'cancellation_restore', v_item.quantity, v_previous_quantity,
                v_previous_quantity + v_item.quantity, 'order', NEW.order_id::TEXT,
                app_user_id(), 'Stock returned because the order was cancelled or rejected'
            );
        END LOOP;
    END IF;
    RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION restock_cancelled_order() FROM PUBLIC;