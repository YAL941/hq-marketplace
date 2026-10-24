UPDATE order_items oi
   SET inventory_location_id = (
       SELECT bl.location_id
         FROM business_locations bl
        WHERE bl.business_id = oi.business_id
          AND bl.is_active
        ORDER BY bl.is_primary DESC, bl.created_at, bl.location_id
        LIMIT 1
   )
 WHERE oi.product_id IS NOT NULL
   AND EXISTS (
       SELECT 1 FROM stock_movements sm
        WHERE sm.product_id = oi.product_id
          AND sm.business_id = oi.business_id
          AND sm.movement_type = 'opening_balance'
          AND sm.source_type = 'migration'
          AND sm.source_reference = '040'
   );

-- Products with no active location retain their unassigned stock bucket.
UPDATE order_items oi
   SET inventory_location_id = NULL
 WHERE oi.product_id IS NOT NULL
   AND EXISTS (
       SELECT 1 FROM stock_movements sm
        WHERE sm.product_id = oi.product_id
          AND sm.business_id = oi.business_id
          AND sm.movement_type = 'opening_balance'
          AND sm.source_type = 'migration'
          AND sm.source_reference = '040'
   )
   AND NOT EXISTS (
       SELECT 1 FROM business_locations bl
        WHERE bl.business_id = oi.business_id
          AND bl.is_active
   );