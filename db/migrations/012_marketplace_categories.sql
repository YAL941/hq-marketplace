-- Expand the business directory catalog without deleting categories that may
-- already be referenced by businesses.
INSERT INTO business_categories
    (category_name, category_slug, description, icon, sort_order, is_active)
VALUES
    ('Restaurants', 'restaurants', 'Restaurants, cafes and takeaway kitchens', 'utensils', 10, TRUE),
    ('Hospitals', 'hospitals', 'Hospitals and medical centres', 'hospital', 20, TRUE),
    ('Pharmacies', 'pharmacies', 'Pharmacies and chemists', 'pill', 30, TRUE),
    ('Wedding Halls', 'wedding-halls', 'Wedding halls and event venues', 'calendar', 40, TRUE),
    ('Hotels', 'hotels', 'Hotels, guesthouses and short-stay apartments', 'bed', 50, TRUE),
    ('Shops', 'shops', 'Retail shops, supermarkets and markets', 'shopping-bag', 60, TRUE),
    ('Healthcare', 'healthcare', 'Clinics, laboratories and other healthcare providers', 'heart-pulse', 70, TRUE),
    ('Grocery & Retail', 'grocery-retail', 'Groceries, supermarkets and general retail', 'shopping-bag', 80, TRUE),
    ('Events & Venues', 'events-venues', 'Event spaces, conference centres and venues', 'calendar', 90, TRUE),
    ('Agriculture & Livestock', 'agriculture', 'Farms, livestock, fisheries and agriculture suppliers', 'leaf', 100, TRUE),
    ('Education & Training', 'education', 'Schools, universities, training centres and tutors', 'graduation-cap', 110, TRUE),
    ('Transport & Delivery', 'transportation', 'Transport, delivery, logistics and vehicle hire', 'truck', 120, TRUE),
    ('Professional Services', 'professional-services', 'Legal, accounting, consulting and marketing services', 'briefcase', 130, TRUE),
    ('Technology & Electronics', 'technology', 'IT, software, electronics sales and repair', 'monitor', 140, TRUE),
    ('Beauty & Wellness', 'beauty-wellness', 'Salons, spas, fitness and wellness providers', 'sparkles', 150, TRUE),
    ('Local Products & Crafts', 'local-products', 'Local makers, handmade goods and crafts', 'shirt', 160, TRUE),
    ('Clinics & Laboratories', 'clinics-laboratories', 'Medical clinics, diagnostic centres and laboratories', 'stethoscope', 170, TRUE),
    ('Automotive & Repairs', 'automotive', 'Vehicle sales, garages, parts and repairs', 'car', 180, TRUE),
    ('Construction & Real Estate', 'construction-real-estate', 'Construction, property sales, rentals and management', 'building', 190, TRUE),
    ('Finance & Insurance', 'finance-insurance', 'Financial services, money transfer and insurance', 'landmark', 200, TRUE),
    ('Telecom & Internet', 'telecom-internet', 'Telecommunications, mobile services and internet providers', 'wifi', 210, TRUE),
    ('Travel & Tourism', 'travel-tourism', 'Travel agencies, tour operators and tourism services', 'plane', 220, TRUE),
    ('Home Services', 'home-services', 'Cleaning, plumbing, electrical and home maintenance', 'wrench', 230, TRUE),
    ('Water & Energy', 'water-energy', 'Water, electricity, solar and energy services', 'zap', 240, TRUE),
    ('NGOs & Community Services', 'ngo-community-services', 'Nonprofits, charities and community organisations', 'heart-handshake', 250, TRUE),
    ('Other', 'other', 'Businesses that do not fit another category', 'circle-ellipsis', 999, TRUE)
ON CONFLICT (category_slug) DO UPDATE SET
    category_name = EXCLUDED.category_name,
    description = EXCLUDED.description,
    icon = EXCLUDED.icon,
    sort_order = EXCLUDED.sort_order,
    is_active = TRUE;
