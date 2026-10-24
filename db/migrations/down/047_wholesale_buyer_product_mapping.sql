-- destructive: true
-- destructive: true
ALTER TABLE wholesale_purchase_order_items
    DROP CONSTRAINT wholesale_purchase_order_items_buyer_product_fk,
    DROP CONSTRAINT wholesale_purchase_order_items_order_business_fk,
    DROP CONSTRAINT wholesale_purchase_order_items_offer_supplier_fk,
    DROP COLUMN buyer_product_id,
    DROP COLUMN supplier_business_id,
    DROP COLUMN buyer_business_id;

ALTER TABLE wholesale_purchase_orders
    DROP CONSTRAINT wholesale_purchase_orders_id_buyer_supplier_unique;

ALTER TABLE wholesale_rfq_items
    DROP CONSTRAINT wholesale_rfq_items_buyer_product_fk,
    DROP CONSTRAINT wholesale_rfq_items_rfq_business_fk,
    DROP CONSTRAINT wholesale_rfq_items_offer_supplier_fk,
    DROP COLUMN buyer_product_id,
    DROP COLUMN supplier_business_id,
    DROP COLUMN buyer_business_id;

ALTER TABLE wholesale_rfqs
    DROP CONSTRAINT wholesale_rfqs_id_buyer_supplier_unique;

ALTER TABLE wholesale_offers
    DROP CONSTRAINT wholesale_offers_id_product_supplier_unique;
