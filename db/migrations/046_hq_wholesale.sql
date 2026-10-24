CREATE TABLE wholesale_suppliers (
    business_id BIGINT PRIMARY KEY REFERENCES businesses (business_id) ON DELETE RESTRICT,
    status TEXT NOT NULL DEFAULT 'pending',
    description TEXT,
    applied_by BIGINT REFERENCES users (user_id) ON DELETE SET NULL,
    applied_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    reviewed_by BIGINT REFERENCES users (user_id) ON DELETE SET NULL,
    reviewed_at TIMESTAMPTZ,
    rejection_reason TEXT,
    CONSTRAINT wholesale_suppliers_status_valid
        CHECK (status IN ('pending', 'approved', 'rejected', 'suspended')),
    CONSTRAINT wholesale_suppliers_review_consistent CHECK (
        (status = 'pending' AND reviewed_at IS NULL)
        OR (status <> 'pending' AND reviewed_at IS NOT NULL)
    ),
    CONSTRAINT wholesale_suppliers_description_length
        CHECK (description IS NULL OR char_length(description) <= 2000),
    CONSTRAINT wholesale_suppliers_reason_length
        CHECK (rejection_reason IS NULL OR char_length(rejection_reason) <= 500)
);

CREATE TABLE wholesale_offers (
    offer_id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    supplier_business_id BIGINT NOT NULL REFERENCES wholesale_suppliers (business_id) ON DELETE RESTRICT,
    product_id BIGINT NOT NULL,
    wholesale_price NUMERIC(14, 2) NOT NULL,
    currency CHAR(3) NOT NULL,
    minimum_order_quantity INTEGER NOT NULL,
    available_quantity INTEGER NOT NULL,
    status TEXT NOT NULL DEFAULT 'active',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT wholesale_offers_product_supplier_fk
        FOREIGN KEY (product_id, supplier_business_id)
        REFERENCES products (product_id, business_id) ON DELETE RESTRICT,
    CONSTRAINT wholesale_offers_price_positive CHECK (wholesale_price > 0),
    CONSTRAINT wholesale_offers_currency_format CHECK (currency ~ '^[A-Z]{3}$'),
    CONSTRAINT wholesale_offers_moq_positive CHECK (minimum_order_quantity > 0),
    CONSTRAINT wholesale_offers_available_non_negative CHECK (available_quantity >= 0),
    CONSTRAINT wholesale_offers_status_valid CHECK (status IN ('active', 'inactive'))
);
ALTER TABLE wholesale_offers
    ADD CONSTRAINT wholesale_offers_id_product_unique UNIQUE (offer_id, product_id);

CREATE INDEX ix_wholesale_offers_product_active
    ON wholesale_offers (product_id, currency, wholesale_price)
    WHERE status = 'active';
CREATE INDEX ix_wholesale_offers_supplier_status
    ON wholesale_offers (supplier_business_id, status, updated_at DESC);
CREATE TRIGGER trg_wholesale_offers_updated_at
    BEFORE UPDATE ON wholesale_offers
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE wholesale_offer_tiers (
    tier_id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    offer_id BIGINT NOT NULL REFERENCES wholesale_offers (offer_id) ON DELETE CASCADE,
    minimum_quantity INTEGER NOT NULL,
    maximum_quantity INTEGER,
    unit_price NUMERIC(14, 2) NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT wholesale_offer_tiers_range CHECK (
        minimum_quantity > 0 AND (maximum_quantity IS NULL OR maximum_quantity >= minimum_quantity)
    ),
    CONSTRAINT wholesale_offer_tiers_price_positive CHECK (unit_price > 0),
    CONSTRAINT wholesale_offer_tiers_min_unique UNIQUE (offer_id, minimum_quantity)
);
CREATE INDEX ix_wholesale_offer_tiers_offer_range
    ON wholesale_offer_tiers (offer_id, minimum_quantity, maximum_quantity);

CREATE TABLE wholesale_rfqs (
    rfq_id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    buyer_business_id BIGINT NOT NULL REFERENCES businesses (business_id) ON DELETE RESTRICT,
    supplier_business_id BIGINT NOT NULL REFERENCES wholesale_suppliers (business_id) ON DELETE RESTRICT,
    status TEXT NOT NULL DEFAULT 'pending',
    delivery_location_id BIGINT,
    delivery_address TEXT,
    delivery_city TEXT,
    requested_delivery_date DATE,
    buyer_note TEXT,
    supplier_note TEXT,
    valid_until TIMESTAMPTZ,
    created_by BIGINT REFERENCES users (user_id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT wholesale_rfqs_buyer_supplier_distinct CHECK (buyer_business_id <> supplier_business_id),
    CONSTRAINT wholesale_rfqs_buyer_location_fk
        FOREIGN KEY (delivery_location_id, buyer_business_id)
        REFERENCES business_locations (location_id, business_id) ON DELETE RESTRICT,
    CONSTRAINT wholesale_rfqs_status_valid CHECK (
        status IN ('pending', 'quoted', 'accepted', 'rejected', 'expired', 'cancelled')
    ),
    CONSTRAINT wholesale_rfqs_notes_length CHECK (
        (buyer_note IS NULL OR char_length(buyer_note) <= 2000)
        AND (supplier_note IS NULL OR char_length(supplier_note) <= 2000)
    )
);
CREATE INDEX ix_wholesale_rfqs_buyer ON wholesale_rfqs (buyer_business_id, status, created_at DESC);
CREATE INDEX ix_wholesale_rfqs_supplier ON wholesale_rfqs (supplier_business_id, status, created_at DESC);
CREATE TRIGGER trg_wholesale_rfqs_updated_at
    BEFORE UPDATE ON wholesale_rfqs
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE wholesale_rfq_items (
    rfq_item_id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    rfq_id BIGINT NOT NULL REFERENCES wholesale_rfqs (rfq_id) ON DELETE RESTRICT,
    offer_id BIGINT NOT NULL,
    product_id BIGINT NOT NULL REFERENCES products (product_id) ON DELETE RESTRICT,
    requested_quantity INTEGER NOT NULL,
    quoted_unit_price NUMERIC(14, 2),
    CONSTRAINT wholesale_rfq_items_quantity_positive CHECK (requested_quantity > 0),
    CONSTRAINT wholesale_rfq_items_quoted_price_positive CHECK (
        quoted_unit_price IS NULL OR quoted_unit_price > 0
    ),
    CONSTRAINT wholesale_rfq_items_offer_unique UNIQUE (rfq_id, offer_id),
    CONSTRAINT wholesale_rfq_items_offer_product_fk
        FOREIGN KEY (offer_id, product_id) REFERENCES wholesale_offers (offer_id, product_id) ON DELETE RESTRICT
);
CREATE INDEX ix_wholesale_rfq_items_rfq ON wholesale_rfq_items (rfq_id, rfq_item_id);

CREATE TABLE wholesale_purchase_orders (
    purchase_order_id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    order_number TEXT NOT NULL UNIQUE,
    buyer_business_id BIGINT NOT NULL REFERENCES businesses (business_id) ON DELETE RESTRICT,
    supplier_business_id BIGINT NOT NULL REFERENCES wholesale_suppliers (business_id) ON DELETE RESTRICT,
    rfq_id BIGINT UNIQUE REFERENCES wholesale_rfqs (rfq_id) ON DELETE RESTRICT,
    status TEXT NOT NULL DEFAULT 'pending_confirmation',
    currency CHAR(3) NOT NULL,
    total_amount NUMERIC(14, 2) NOT NULL,
    delivery_location_id BIGINT,
    delivery_address TEXT,
    delivery_city TEXT,
    requested_delivery_date DATE,
    buyer_note TEXT,
    supplier_note TEXT,
    created_by BIGINT REFERENCES users (user_id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT wholesale_purchase_orders_buyer_supplier_distinct CHECK (buyer_business_id <> supplier_business_id),
    CONSTRAINT wholesale_purchase_orders_buyer_location_fk
        FOREIGN KEY (delivery_location_id, buyer_business_id)
        REFERENCES business_locations (location_id, business_id) ON DELETE RESTRICT,
    CONSTRAINT wholesale_purchase_orders_status_valid CHECK (
        status IN ('pending_confirmation', 'confirmed', 'processing', 'shipped',
                   'partially_delivered', 'delivered', 'cancelled')
    ),
    CONSTRAINT wholesale_purchase_orders_currency_format CHECK (currency ~ '^[A-Z]{3}$'),
    CONSTRAINT wholesale_purchase_orders_total_non_negative CHECK (total_amount >= 0)
);
CREATE INDEX ix_wholesale_purchase_orders_buyer ON wholesale_purchase_orders (buyer_business_id, status, created_at DESC);
CREATE INDEX ix_wholesale_purchase_orders_supplier ON wholesale_purchase_orders (supplier_business_id, status, created_at DESC);
CREATE TRIGGER trg_wholesale_purchase_orders_updated_at
    BEFORE UPDATE ON wholesale_purchase_orders
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE wholesale_purchase_order_items (
    purchase_order_item_id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    purchase_order_id BIGINT NOT NULL REFERENCES wholesale_purchase_orders (purchase_order_id) ON DELETE RESTRICT,
    offer_id BIGINT NOT NULL,
    product_id BIGINT NOT NULL REFERENCES products (product_id) ON DELETE RESTRICT,
    ordered_quantity INTEGER NOT NULL,
    received_quantity INTEGER NOT NULL DEFAULT 0,
    unit_price NUMERIC(14, 2) NOT NULL,
    CONSTRAINT wholesale_purchase_order_items_quantity_valid
        CHECK (ordered_quantity > 0 AND received_quantity >= 0 AND received_quantity <= ordered_quantity),
    CONSTRAINT wholesale_purchase_order_items_price_positive CHECK (unit_price > 0),
    CONSTRAINT wholesale_purchase_order_items_offer_unique UNIQUE (purchase_order_id, offer_id),
    CONSTRAINT wholesale_purchase_order_items_offer_product_fk
        FOREIGN KEY (offer_id, product_id) REFERENCES wholesale_offers (offer_id, product_id) ON DELETE RESTRICT
);
CREATE INDEX ix_wholesale_purchase_order_items_order
    ON wholesale_purchase_order_items (purchase_order_id, purchase_order_item_id);

CREATE TABLE wholesale_receipts (
    receipt_id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    purchase_order_id BIGINT NOT NULL REFERENCES wholesale_purchase_orders (purchase_order_id) ON DELETE RESTRICT,
    buyer_business_id BIGINT NOT NULL REFERENCES businesses (business_id) ON DELETE RESTRICT,
    location_id BIGINT,
    idempotency_key TEXT NOT NULL,
    received_by BIGINT REFERENCES users (user_id) ON DELETE SET NULL,
    note TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT wholesale_receipts_buyer_location_fk
        FOREIGN KEY (location_id, buyer_business_id)
        REFERENCES business_locations (location_id, business_id) ON DELETE RESTRICT,
    CONSTRAINT wholesale_receipts_idempotency_key_valid
        CHECK (char_length(idempotency_key) BETWEEN 8 AND 128),
    CONSTRAINT wholesale_receipts_note_length CHECK (note IS NULL OR char_length(note) <= 1000),
    CONSTRAINT wholesale_receipts_idempotency_unique UNIQUE (purchase_order_id, idempotency_key)
);
CREATE INDEX ix_wholesale_receipts_order ON wholesale_receipts (purchase_order_id, created_at);

CREATE TABLE wholesale_receipt_items (
    receipt_item_id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    receipt_id BIGINT NOT NULL REFERENCES wholesale_receipts (receipt_id) ON DELETE RESTRICT,
    purchase_order_item_id BIGINT NOT NULL REFERENCES wholesale_purchase_order_items (purchase_order_item_id) ON DELETE RESTRICT,
    received_quantity INTEGER NOT NULL CHECK (received_quantity > 0),
    stock_movement_id BIGINT REFERENCES stock_movements (stock_movement_id) ON DELETE RESTRICT,
    CONSTRAINT wholesale_receipt_items_order_item_unique UNIQUE (receipt_id, purchase_order_item_id)
);

CREATE TABLE wholesale_events (
    event_id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    buyer_business_id BIGINT REFERENCES businesses (business_id) ON DELETE RESTRICT,
    supplier_business_id BIGINT REFERENCES businesses (business_id) ON DELETE RESTRICT,
    actor_user_id BIGINT REFERENCES users (user_id) ON DELETE SET NULL,
    entity_type TEXT NOT NULL,
    entity_id BIGINT NOT NULL,
    event_type TEXT NOT NULL,
    details JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT wholesale_events_entity_type_valid CHECK (entity_type IN ('supplier', 'offer', 'rfq', 'purchase_order', 'receipt')),
    CONSTRAINT wholesale_events_type_length CHECK (char_length(event_type) BETWEEN 1 AND 64)
);
CREATE INDEX ix_wholesale_events_buyer ON wholesale_events (buyer_business_id, created_at DESC);
CREATE INDEX ix_wholesale_events_supplier ON wholesale_events (supplier_business_id, created_at DESC);

INSERT INTO permissions (permission_key, description, resource, action) VALUES
    ('wholesale.view', 'Discover suppliers and view wholesale purchasing activity', 'wholesale', 'view'),
    ('wholesale.manage', 'Manage supplier offers, quotations and wholesale purchase orders', 'wholesale', 'manage')
ON CONFLICT (permission_key) DO NOTHING;

INSERT INTO role_permissions (role_id, permission_id)
SELECT r.role_id, p.permission_id
  FROM roles r CROSS JOIN permissions p
 WHERE (r.role_key IN ('business_owner', 'business_manager')
        AND p.permission_key IN ('wholesale.view', 'wholesale.manage'))
    OR (r.role_key = 'business_employee' AND p.permission_key = 'wholesale.view')
    OR (r.role_key = 'platform_admin' AND p.permission_key IN ('wholesale.view', 'wholesale.manage'))
ON CONFLICT DO NOTHING;

ALTER TABLE wholesale_suppliers ENABLE ROW LEVEL SECURITY;
CREATE POLICY wholesale_suppliers_read ON wholesale_suppliers
    FOR SELECT USING (
        app_is_business_member(business_id)
        OR app_is_platform_admin()
        OR (status = 'approved' AND EXISTS (
            SELECT 1 FROM businesses b WHERE b.business_id = wholesale_suppliers.business_id
              AND b.status = 'active' AND b.is_verified AND b.verification_status = 'verified'
        ))
    );
CREATE POLICY wholesale_suppliers_insert ON wholesale_suppliers
    FOR INSERT WITH CHECK (
        app_has_business_permission(business_id, 'wholesale.manage')
        AND EXISTS (
            SELECT 1 FROM businesses b WHERE b.business_id = wholesale_suppliers.business_id
              AND b.status = 'active' AND b.is_verified AND b.verification_status = 'verified'
        )
    );
CREATE POLICY wholesale_suppliers_update ON wholesale_suppliers
    FOR UPDATE USING (app_is_platform_admin() OR app_has_business_permission(business_id, 'wholesale.manage'))
    WITH CHECK (app_is_platform_admin() OR app_has_business_permission(business_id, 'wholesale.manage'));

ALTER TABLE wholesale_offers ENABLE ROW LEVEL SECURITY;
CREATE POLICY wholesale_offers_read ON wholesale_offers
    FOR SELECT USING (
        app_is_business_member(supplier_business_id)
        OR app_is_platform_admin()
        OR (status = 'active' AND EXISTS (
            SELECT 1 FROM wholesale_suppliers ws
            JOIN businesses b ON b.business_id = ws.business_id
            WHERE ws.business_id = wholesale_offers.supplier_business_id AND ws.status = 'approved'
              AND b.status = 'active' AND b.is_verified AND b.verification_status = 'verified'
        ))
    );
CREATE POLICY wholesale_offers_insert ON wholesale_offers
    FOR INSERT WITH CHECK (
        app_has_business_permission(supplier_business_id, 'wholesale.manage')
        AND EXISTS (SELECT 1 FROM wholesale_suppliers ws
                    WHERE ws.business_id = supplier_business_id AND ws.status = 'approved')
    );
CREATE POLICY wholesale_offers_update ON wholesale_offers
    FOR UPDATE USING (app_has_business_permission(supplier_business_id, 'wholesale.manage'))
    WITH CHECK (app_has_business_permission(supplier_business_id, 'wholesale.manage'));

ALTER TABLE wholesale_offer_tiers ENABLE ROW LEVEL SECURITY;
CREATE POLICY wholesale_offer_tiers_read ON wholesale_offer_tiers
    FOR SELECT USING (EXISTS (
        SELECT 1 FROM wholesale_offers o
        WHERE o.offer_id = wholesale_offer_tiers.offer_id
    ));
CREATE POLICY wholesale_offer_tiers_insert ON wholesale_offer_tiers
    FOR INSERT WITH CHECK (EXISTS (
        SELECT 1 FROM wholesale_offers o
        WHERE o.offer_id = wholesale_offer_tiers.offer_id
          AND app_has_business_permission(o.supplier_business_id, 'wholesale.manage')
    ));
CREATE POLICY wholesale_offer_tiers_delete ON wholesale_offer_tiers
    FOR DELETE USING (EXISTS (
        SELECT 1 FROM wholesale_offers o
        WHERE o.offer_id = wholesale_offer_tiers.offer_id
          AND app_has_business_permission(o.supplier_business_id, 'wholesale.manage')
    ));

ALTER TABLE wholesale_rfqs ENABLE ROW LEVEL SECURITY;
CREATE POLICY wholesale_rfqs_read ON wholesale_rfqs
    FOR SELECT USING (
        app_has_business_permission(buyer_business_id, 'wholesale.view')
        OR app_has_business_permission(supplier_business_id, 'wholesale.view')
        OR app_is_platform_admin()
    );
CREATE POLICY wholesale_rfqs_insert ON wholesale_rfqs
    FOR INSERT WITH CHECK (app_has_business_permission(buyer_business_id, 'wholesale.manage'));
CREATE POLICY wholesale_rfqs_update ON wholesale_rfqs
    FOR UPDATE USING (
        app_has_business_permission(buyer_business_id, 'wholesale.manage')
        OR app_has_business_permission(supplier_business_id, 'wholesale.manage')
        OR app_is_platform_admin()
    ) WITH CHECK (
        app_has_business_permission(buyer_business_id, 'wholesale.manage')
        OR app_has_business_permission(supplier_business_id, 'wholesale.manage')
        OR app_is_platform_admin()
    );

ALTER TABLE wholesale_rfq_items ENABLE ROW LEVEL SECURITY;
CREATE POLICY wholesale_rfq_items_read ON wholesale_rfq_items
    FOR SELECT USING (EXISTS (SELECT 1 FROM wholesale_rfqs r WHERE r.rfq_id = wholesale_rfq_items.rfq_id));
CREATE POLICY wholesale_rfq_items_insert ON wholesale_rfq_items
    FOR INSERT WITH CHECK (EXISTS (
        SELECT 1 FROM wholesale_rfqs r
        WHERE r.rfq_id = wholesale_rfq_items.rfq_id
          AND app_has_business_permission(r.buyer_business_id, 'wholesale.manage')
    ));
CREATE POLICY wholesale_rfq_items_update ON wholesale_rfq_items
    FOR UPDATE USING (EXISTS (
        SELECT 1 FROM wholesale_rfqs r
        WHERE r.rfq_id = wholesale_rfq_items.rfq_id
          AND app_has_business_permission(r.supplier_business_id, 'wholesale.manage')
    )) WITH CHECK (EXISTS (
        SELECT 1 FROM wholesale_rfqs r
        WHERE r.rfq_id = wholesale_rfq_items.rfq_id
          AND app_has_business_permission(r.supplier_business_id, 'wholesale.manage')
    ));

ALTER TABLE wholesale_purchase_orders ENABLE ROW LEVEL SECURITY;
CREATE POLICY wholesale_purchase_orders_read ON wholesale_purchase_orders
    FOR SELECT USING (
        app_has_business_permission(buyer_business_id, 'wholesale.view')
        OR app_has_business_permission(supplier_business_id, 'wholesale.view')
        OR app_is_platform_admin()
    );
CREATE POLICY wholesale_purchase_orders_insert ON wholesale_purchase_orders
    FOR INSERT WITH CHECK (app_has_business_permission(buyer_business_id, 'wholesale.manage'));
CREATE POLICY wholesale_purchase_orders_update ON wholesale_purchase_orders
    FOR UPDATE USING (
        app_has_business_permission(buyer_business_id, 'wholesale.manage')
        OR app_has_business_permission(supplier_business_id, 'wholesale.manage')
        OR app_is_platform_admin()
    ) WITH CHECK (
        app_has_business_permission(buyer_business_id, 'wholesale.manage')
        OR app_has_business_permission(supplier_business_id, 'wholesale.manage')
        OR app_is_platform_admin()
    );

ALTER TABLE wholesale_purchase_order_items ENABLE ROW LEVEL SECURITY;
CREATE POLICY wholesale_purchase_order_items_read ON wholesale_purchase_order_items
    FOR SELECT USING (EXISTS (
        SELECT 1 FROM wholesale_purchase_orders po
        WHERE po.purchase_order_id = wholesale_purchase_order_items.purchase_order_id
    ));
CREATE POLICY wholesale_purchase_order_items_insert ON wholesale_purchase_order_items
    FOR INSERT WITH CHECK (EXISTS (
        SELECT 1 FROM wholesale_purchase_orders po
        WHERE po.purchase_order_id = wholesale_purchase_order_items.purchase_order_id
          AND app_has_business_permission(po.buyer_business_id, 'wholesale.manage')
    ));
CREATE POLICY wholesale_purchase_order_items_update ON wholesale_purchase_order_items
    FOR UPDATE USING (EXISTS (
        SELECT 1 FROM wholesale_purchase_orders po
        WHERE po.purchase_order_id = wholesale_purchase_order_items.purchase_order_id
          AND (app_has_business_permission(po.buyer_business_id, 'wholesale.manage')
               OR app_has_business_permission(po.supplier_business_id, 'wholesale.manage'))
    )) WITH CHECK (EXISTS (
        SELECT 1 FROM wholesale_purchase_orders po
        WHERE po.purchase_order_id = wholesale_purchase_order_items.purchase_order_id
          AND (app_has_business_permission(po.buyer_business_id, 'wholesale.manage')
               OR app_has_business_permission(po.supplier_business_id, 'wholesale.manage'))
    ));

ALTER TABLE wholesale_receipts ENABLE ROW LEVEL SECURITY;
CREATE POLICY wholesale_receipts_read ON wholesale_receipts
    FOR SELECT USING (
        app_has_business_permission(buyer_business_id, 'wholesale.view')
        OR app_is_platform_admin()
    );
CREATE POLICY wholesale_receipts_insert ON wholesale_receipts
    FOR INSERT WITH CHECK (
        app_has_business_permission(buyer_business_id, 'wholesale.manage')
        AND app_has_business_permission(buyer_business_id, 'inventory.manage')
    );

ALTER TABLE wholesale_receipt_items ENABLE ROW LEVEL SECURITY;
CREATE POLICY wholesale_receipt_items_read ON wholesale_receipt_items
    FOR SELECT USING (EXISTS (SELECT 1 FROM wholesale_receipts r WHERE r.receipt_id = wholesale_receipt_items.receipt_id));
CREATE POLICY wholesale_receipt_items_insert ON wholesale_receipt_items
    FOR INSERT WITH CHECK (EXISTS (
        SELECT 1 FROM wholesale_receipts r
        WHERE r.receipt_id = wholesale_receipt_items.receipt_id
          AND app_has_business_permission(r.buyer_business_id, 'inventory.manage')
    ));

ALTER TABLE wholesale_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY wholesale_events_read ON wholesale_events
    FOR SELECT USING (
        (buyer_business_id IS NOT NULL AND app_has_business_permission(buyer_business_id, 'wholesale.view'))
        OR (supplier_business_id IS NOT NULL AND app_has_business_permission(supplier_business_id, 'wholesale.view'))
        OR app_is_platform_admin()
    );
CREATE POLICY wholesale_events_insert ON wholesale_events
    FOR INSERT WITH CHECK (
        (buyer_business_id IS NOT NULL AND app_has_business_permission(buyer_business_id, 'wholesale.manage'))
        OR (supplier_business_id IS NOT NULL AND app_has_business_permission(supplier_business_id, 'wholesale.manage'))
        OR app_is_platform_admin()
    );
