-- destructive: false
UPDATE reviews r
   SET status = 'pending'
  FROM review_migration_state.pending_reviews_033 backup
 WHERE backup.review_type = 'business'
   AND backup.review_id = r.review_id
   AND r.status = 'published';

UPDATE product_reviews r
   SET status = 'pending'
  FROM review_migration_state.pending_reviews_033 backup
 WHERE backup.review_type = 'product'
   AND backup.review_id = r.product_review_id
   AND r.status = 'published';

DROP SCHEMA review_migration_state CASCADE;
