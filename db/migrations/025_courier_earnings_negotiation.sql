ALTER TABLE orders
    ADD COLUMN delivery_earning_amount NUMERIC(14, 2),
    ADD CONSTRAINT orders_delivery_earning_positive CHECK (
        delivery_earning_amount IS NULL OR delivery_earning_amount > 0
    );
