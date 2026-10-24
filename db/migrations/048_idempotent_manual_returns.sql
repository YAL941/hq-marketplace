CREATE UNIQUE INDEX uq_stock_movements_manual_return_idempotency
    ON stock_movements (business_id, source_reference)
    WHERE source_type = 'manual_return';
