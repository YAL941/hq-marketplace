-- destructive: false
-- Preserve category rows and all business references; only restore the
-- previously retired catalog entries and hide categories added by this change.
UPDATE business_categories
   SET is_active = FALSE
 WHERE category_slug IN (
     'healthcare',
     'grocery-retail',
     'events-venues',
     'agriculture',
     'education',
     'transportation',
     'professional-services',
     'technology',
     'beauty-wellness',
     'local-products',
     'clinics-laboratories',
     'automotive',
     'construction-real-estate',
     'finance-insurance',
     'telecom-internet',
     'travel-tourism',
     'home-services',
     'water-energy',
     'ngo-community-services'
 );
