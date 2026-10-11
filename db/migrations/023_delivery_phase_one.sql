ALTER TABLE businesses
    ADD COLUMN delivery_enabled BOOLEAN NOT NULL DEFAULT FALSE,
    ADD COLUMN delivery_fee NUMERIC(14, 2) NOT NULL DEFAULT 0,
    ADD CONSTRAINT businesses_delivery_fee_non_negative CHECK (delivery_fee >= 0);

ALTER TABLE orders
    ADD COLUMN delivery_requested BOOLEAN NOT NULL DEFAULT FALSE,
    ADD COLUMN location_consent BOOLEAN NOT NULL DEFAULT FALSE,
    ADD COLUMN location_consent_at TIMESTAMPTZ,
    ADD COLUMN delivery_latitude NUMERIC(9, 6),
    ADD COLUMN delivery_longitude NUMERIC(9, 6),
    ADD COLUMN delivery_note TEXT,
    ADD COLUMN customer_phone TEXT,
    ADD COLUMN payment_method TEXT NOT NULL DEFAULT 'cash_on_delivery',
    ADD COLUMN status_history JSONB NOT NULL DEFAULT '[]'::jsonb,
    ADD CONSTRAINT orders_delivery_coordinates_pair CHECK (
        (delivery_latitude IS NULL) = (delivery_longitude IS NULL)
    ),
    ADD CONSTRAINT orders_delivery_coordinates_range CHECK (
        delivery_latitude IS NULL OR delivery_latitude BETWEEN -90 AND 90
    ),
    ADD CONSTRAINT orders_delivery_longitude_range CHECK (
        delivery_longitude IS NULL OR delivery_longitude BETWEEN -180 AND 180
    ),
    ADD CONSTRAINT orders_delivery_location_required CHECK (
        NOT delivery_requested OR (
            location_consent
            AND location_consent_at IS NOT NULL
            AND customer_phone IS NOT NULL
            AND (
                (order_status IN ('completed', 'cancelled')
                    AND delivery_latitude IS NULL AND delivery_longitude IS NULL)
                OR (order_status NOT IN ('completed', 'cancelled')
                    AND delivery_latitude IS NOT NULL AND delivery_longitude IS NOT NULL)
            )
        )
    ),
    ADD CONSTRAINT orders_pickup_has_no_delivery_location CHECK (
        delivery_requested OR (
            NOT location_consent
            AND location_consent_at IS NULL
            AND delivery_latitude IS NULL
            AND delivery_longitude IS NULL
        )
    ),
    ADD CONSTRAINT orders_payment_method_supported CHECK (payment_method = 'cash_on_delivery');

CREATE OR REPLACE FUNCTION append_order_status_history()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    IF TG_OP = 'INSERT' OR OLD.order_status IS DISTINCT FROM NEW.order_status THEN
        NEW.status_history := COALESCE(NEW.status_history, '[]'::jsonb) || jsonb_build_array(
            jsonb_build_object(
                'status', NEW.order_status,
                'changed_at', now(),
                'changed_by', app_user_id()
            )
        );
    END IF;

    IF NEW.delivery_requested AND NEW.order_status IN ('completed', 'cancelled') THEN
        NEW.delivery_latitude := NULL;
        NEW.delivery_longitude := NULL;
    END IF;

    RETURN NEW;
END;
$$;

CREATE TRIGGER trg_orders_status_history
    BEFORE INSERT OR UPDATE OF order_status ON orders
    FOR EACH ROW EXECUTE FUNCTION append_order_status_history();
