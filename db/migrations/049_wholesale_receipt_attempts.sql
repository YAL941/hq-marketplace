CREATE TABLE wholesale_receipt_attempts (
    buyer_business_id BIGINT NOT NULL,
    purchase_order_id BIGINT NOT NULL,
    supplier_business_id BIGINT NOT NULL,
    attempt_id TEXT NOT NULL,
    payload_hash CHAR(64) NOT NULL,
    state TEXT NOT NULL DEFAULT 'pending',
    receipt_id BIGINT UNIQUE,
    result JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    completed_at TIMESTAMPTZ,
    CONSTRAINT wholesale_receipt_attempts_pk
        PRIMARY KEY (buyer_business_id, purchase_order_id, attempt_id),
    CONSTRAINT wholesale_receipt_attempts_order_fk
        FOREIGN KEY (purchase_order_id, buyer_business_id, supplier_business_id)
        REFERENCES wholesale_purchase_orders (purchase_order_id, buyer_business_id, supplier_business_id) ON DELETE RESTRICT,
    CONSTRAINT wholesale_receipt_attempts_receipt_fk
        FOREIGN KEY (receipt_id) REFERENCES wholesale_receipts (receipt_id) ON DELETE RESTRICT,
    CONSTRAINT wholesale_receipt_attempts_id_valid
        CHECK (char_length(attempt_id) BETWEEN 8 AND 128),
    CONSTRAINT wholesale_receipt_attempts_hash_valid
        CHECK (payload_hash ~ '^[0-9a-f]{64}$'),
    CONSTRAINT wholesale_receipt_attempts_state_valid
        CHECK (state IN ('pending', 'completed')),
    CONSTRAINT wholesale_receipt_attempts_result_consistent
        CHECK (
            (state = 'pending' AND receipt_id IS NULL AND result IS NULL AND completed_at IS NULL)
            OR
            (state = 'completed' AND receipt_id IS NOT NULL AND result IS NOT NULL AND completed_at IS NOT NULL)
        )
);

CREATE INDEX ix_wholesale_receipt_attempts_order
    ON wholesale_receipt_attempts (buyer_business_id, purchase_order_id, created_at DESC);

ALTER TABLE wholesale_receipt_attempts ENABLE ROW LEVEL SECURITY;
CREATE POLICY wholesale_receipt_attempts_read ON wholesale_receipt_attempts
    FOR SELECT USING (
        app_has_business_permission(buyer_business_id, 'inventory.manage')
        OR app_is_platform_admin()
    );
CREATE POLICY wholesale_receipt_attempts_insert ON wholesale_receipt_attempts
    FOR INSERT WITH CHECK (
        app_has_business_permission(buyer_business_id, 'wholesale.manage')
        AND app_has_business_permission(buyer_business_id, 'inventory.manage')
    );
CREATE POLICY wholesale_receipt_attempts_update ON wholesale_receipt_attempts
    FOR UPDATE USING (
        app_has_business_permission(buyer_business_id, 'wholesale.manage')
        AND app_has_business_permission(buyer_business_id, 'inventory.manage')
    ) WITH CHECK (
        app_has_business_permission(buyer_business_id, 'wholesale.manage')
        AND app_has_business_permission(buyer_business_id, 'inventory.manage')
    );
