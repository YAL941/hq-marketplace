-- destructive: false
ALTER TABLE orders
    DROP CONSTRAINT orders_delivery_offer_courier_id_fkey,
    ADD CONSTRAINT orders_delivery_offer_courier_id_fkey
        FOREIGN KEY (delivery_offer_courier_id)
        REFERENCES users (user_id)
        ON DELETE SET NULL;
