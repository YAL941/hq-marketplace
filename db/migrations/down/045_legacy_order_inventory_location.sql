-- destructive: false
UPDATE order_items oi
   SET inventory_location_id = COALESCE(
       o.location_id,
       (
           SELECT bl.location_id
             FROM business_locations bl
            WHERE bl.business_id = oi.business_id
              AND bl.is_active
            ORDER BY bl.is_primary DESC, bl.created_at, bl.location_id
            LIMIT 1
       )
   )
  FROM orders o
 WHERE o.order_id = oi.order_id
   AND oi.product_id IS NOT NULL;