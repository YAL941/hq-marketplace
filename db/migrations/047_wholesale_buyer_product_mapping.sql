ALTER TABLE wholesale_offers
    ADD CONSTRAINT wholesale_offers_id_product_supplier_unique
        UNIQUE (offer_id, product_id, supplier_business_id);

ALTER TABLE wholesale_rfqs
    ADD CONSTRAINT wholesale_rfqs_id_buyer_supplier_unique
        UNIQUE (rfq_id, buyer_business_id, supplier_business_id);

ALTER TABLE wholesale_rfq_items
    ADD COLUMN buyer_business_id BIGINT NOT NULL,
    ADD COLUMN supplier_business_id BIGINT NOT NULL,
    ADD COLUMN buyer_product_id BIGINT NOT NULL,
    ADD CONSTRAINT wholesale_rfq_items_offer_supplier_fk
        FOREIGN KEY (offer_id, product_id, supplier_business_id)
        REFERENCES wholesale_offers (offer_id, product_id, supplier_business_id) ON DELETE RESTRICT,
    ADD CONSTRAINT wholesale_rfq_items_rfq_business_fk
        FOREIGN KEY (rfq_id, buyer_business_id, supplier_business_id)
        REFERENCES wholesale_rfqs (rfq_id, buyer_business_id, supplier_business_id) ON DELETE RESTRICT,
    ADD CONSTRAINT wholesale_rfq_items_buyer_product_fk
        FOREIGN KEY (buyer_product_id, buyer_business_id)
        REFERENCES products (product_id, business_id) ON DELETE RESTRICT;

ALTER TABLE wholesale_purchase_orders
    ADD CONSTRAINT wholesale_purchase_orders_id_buyer_supplier_unique
        UNIQUE (purchase_order_id, buyer_business_id, supplier_business_id);

ALTER TABLE wholesale_purchase_order_items
    ADD COLUMN buyer_business_id BIGINT NOT NULL,
    ADD COLUMN supplier_business_id BIGINT NOT NULL,
    ADD COLUMN buyer_product_id BIGINT NOT NULL,
    ADD CONSTRAINT wholesale_purchase_order_items_offer_supplier_fk
        FOREIGN KEY (offer_id, product_id, supplier_business_id)
        REFERENCES wholesale_offers (offer_id, product_id, supplier_business_id) ON DELETE RESTRICT,
    ADD CONSTRAINT wholesale_purchase_order_items_order_business_fk
        FOREIGN KEY (purchase_order_id, buyer_business_id, supplier_business_id)
        REFERENCES wholesale_purchase_orders (purchase_order_id, buyer_business_id, supplier_business_id) ON DELETE RESTRICT,
    ADD CONSTRAINT wholesale_purchase_order_items_buyer_product_fk
        FOREIGN KEY (buyer_product_id, buyer_business_id)
        REFERENCES products (product_id, business_id) ON DELETE RESTRICT;
