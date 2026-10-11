-- destructive: true
ALTER TABLE orders
    DROP CONSTRAINT IF EXISTS orders_delivery_earning_positive,
    DROP COLUMN IF EXISTS delivery_earning_amount;
