# Security fixes — batch A

## Read-only inventory of unsafe URL values

Run this only against the development database `hq_marketplace`, never against
production. The query reads only record IDs and counts; it does not select URL
values. It detects values whose scheme is not HTTP(S), or whose local upload
path does not match the row's owning business and image slot.

```sql
BEGIN TRANSACTION READ ONLY;

SELECT 'businesses.website' AS column_name,
       count(*) AS invalid_count,
       COALESCE(array_agg(business_id ORDER BY business_id), ARRAY[]::bigint[]) AS record_ids
FROM businesses
WHERE website IS NOT NULL
  AND (website ~ '[[:cntrl:]]' OR website !~* '^https?://[^/?#[:space:]]+')
UNION ALL
SELECT 'businesses.logo_url',
       count(*),
       COALESCE(array_agg(business_id ORDER BY business_id), ARRAY[]::bigint[])
FROM businesses
WHERE logo_url IS NOT NULL
  AND (logo_url ~ '[[:cntrl:]]'
       OR (logo_url !~* '^https?://[^/?#[:space:]]+'
           AND logo_url !~ ('^/uploads/' || business_id::text || '/logo/[0-9a-f]{32}\.webp$')))
UNION ALL
SELECT 'businesses.cover_image_url',
       count(*),
       COALESCE(array_agg(business_id ORDER BY business_id), ARRAY[]::bigint[])
FROM businesses
WHERE cover_image_url IS NOT NULL
  AND (cover_image_url ~ '[[:cntrl:]]'
       OR (cover_image_url !~* '^https?://[^/?#[:space:]]+'
           AND cover_image_url !~ ('^/uploads/' || business_id::text || '/cover/[0-9a-f]{32}\.webp$')))
UNION ALL
SELECT 'products.image_url',
       count(*),
       COALESCE(array_agg(product_id ORDER BY product_id), ARRAY[]::bigint[])
FROM products
WHERE image_url IS NOT NULL
  AND (image_url ~ '[[:cntrl:]]'
       OR (image_url !~* '^https?://[^/?#[:space:]]+'
           AND image_url !~ ('^/uploads/' || business_id::text || '/products/' || product_id::text || '/[0-9a-f]{32}\.webp$')));

ROLLBACK;
```

Review each reported ID in the development environment. Replace an unsafe
external address only after verifying it with the business owner; otherwise
clear the relevant URL column. For a managed path, re-upload the image through
the authenticated media endpoint rather than editing the stored path manually.
Apply any approved cleanup through a separately reviewed migration or
administrative maintenance procedure, with a backup first; do not bulk rewrite
unknown values or run this cleanup against production without a reviewed plan.
