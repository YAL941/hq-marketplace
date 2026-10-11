DROP TRIGGER IF EXISTS trg_orders_status_history ON orders;
DROP FUNCTION IF EXISTS append_order_status_history();

ALTER TABLE orders
    DROP CONSTRAINT IF EXISTS orders_payment_method_supported,
    DROP CONSTRAINT IF EXISTS orders_pickup_has_no_delivery_location,
    DROP CONSTRAINT IF EXISTS orders_delivery_location_required,
    DROP CONSTRAINT IF EXISTS orders_delivery_longitude_range,
    DROP CONSTRAINT IF EXISTS orders_delivery_coordinates_range,
    DROP CONSTRAINT IF EXISTS orders_delivery_coordinates_pair,
    DROP COLUMN IF EXISTS status_history,
    DROP COLUMN IF EXISTS payment_method,
    DROP COLUMN IF EXISTS customer_phone,
    DROP COLUMN IF EXISTS delivery_note,
    DROP COLUMN IF EXISTS delivery_longitude,
    DROP COLUMN IF EXISTS delivery_latitude,
    DROP COLUMN IF EXISTS location_consent_at,
    DROP COLUMN IF EXISTS location_consent,
    DROP COLUMN IF EXISTS delivery_requested;

ALTER TABLE businesses
    DROP CONSTRAINT IF EXISTS businesses_delivery_fee_non_negative,
    DROP COLUMN IF EXISTS delivery_fee,
    DROP COLUMN IF EXISTS delivery_enabled;
