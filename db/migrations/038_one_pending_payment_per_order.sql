CREATE UNIQUE INDEX payments_one_pending_per_order
    ON payments (order_id) WHERE status = 'pending';
