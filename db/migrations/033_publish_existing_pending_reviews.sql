-- Publish reviews that were waiting for manual moderation before automatic
-- publishing was enabled. Keep the affected IDs so this data change can be
-- reversed without changing reviews that were already published, hidden, or
-- rejected.
CREATE SCHEMA review_migration_state;

CREATE TABLE review_migration_state.pending_reviews_033 (
    review_type TEXT NOT NULL CHECK (review_type IN ('business', 'product')),
    review_id   BIGINT NOT NULL,
    PRIMARY KEY (review_type, review_id)
);

INSERT INTO review_migration_state.pending_reviews_033 (review_type, review_id)
SELECT 'business', review_id
  FROM reviews
 WHERE status = 'pending';

INSERT INTO review_migration_state.pending_reviews_033 (review_type, review_id)
SELECT 'product', product_review_id
  FROM product_reviews
 WHERE status = 'pending';

UPDATE reviews
   SET status = 'published'
 WHERE status = 'pending';

UPDATE product_reviews
   SET status = 'published'
 WHERE status = 'pending';
