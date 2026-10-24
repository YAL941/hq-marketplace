-- destructive: true
DROP TABLE wholesale_events;
DROP TABLE wholesale_receipt_items;
DROP TABLE wholesale_receipts;
DROP TABLE wholesale_purchase_order_items;
DROP TABLE wholesale_purchase_orders;
DROP TABLE wholesale_rfq_items;
DROP TABLE wholesale_rfqs;
DROP TABLE wholesale_offer_tiers;
DROP TABLE wholesale_offers;
DROP TABLE wholesale_suppliers;

DELETE FROM role_permissions rp
 USING permissions p
 WHERE rp.permission_id = p.permission_id
   AND p.permission_key IN ('wholesale.view', 'wholesale.manage');
DELETE FROM permissions WHERE permission_key IN ('wholesale.view', 'wholesale.manage');
