/**
 * Somali sample data for the development seed.
 *
 * FICTION NOTICE
 * --------------
 * Every business, person, address and phone number below is invented for local
 * development. None of it refers to a real company, a real clinic, a real
 * person, or a reachable phone number.
 *
 * The numbers use the +252 country code with a 90 operator prefix and a run of
 * zeros in the middle (+252 90 000 01xx). That shape is deliberately obvious:
 * Somalia has no officially reserved fictional range the way +1-555-01xx does
 * in North America, so the placeholder is carried by how the digits read rather
 * than by a guarantee from the regulator. Nothing here must ever reach a real
 * deployment.
 *
 * Category names are English only. `business_categories` has a single
 * `category_name` column and no translation table, so an Arabic name would need
 * a schema change to go alongside the English one. That is worth doing
 * properly, not faking in a seed file.
 *
 * There is no `data/seed` marker column in the schema, so ownership of these
 * rows is tracked by slug: `SEED_SLUGS` is the set the seed owns, and re-running
 * replaces exactly those rows and nothing else. A business created by hand
 * through the API survives every re-seed.
 */

export interface SeedCategory {
    slug: string;
    name: string;
    description: string;
    icon: string;
    sortOrder: number;
}

/**
 * The six categories the marketplace ships with.
 *
 * `restaurants` and `hotels` already exist from the 004 seed data and are
 * updated in place. The other four are created here. Categories seeded by 004
 * that are not in this list are deactivated rather than deleted, because
 * `businesses.business_category_id` is ON DELETE RESTRICT and a delete would
 * fail on any business still pointing at it.
 */
export const SEED_CATEGORIES: SeedCategory[] = [
    { slug: 'restaurants', name: 'Restaurants', description: 'Restaurants, cafés and takeaway kitchens', icon: 'utensils', sortOrder: 10 },
    { slug: 'hospitals', name: 'Hospitals', description: 'Hospitals, clinics and medical centres', icon: 'hospital', sortOrder: 20 },
    { slug: 'pharmacies', name: 'Pharmacies', description: 'Pharmacies and chemists', icon: 'pill', sortOrder: 30 },
    { slug: 'wedding-halls', name: 'Wedding Halls', description: 'Wedding halls, event venues and conference centres', icon: 'calendar', sortOrder: 40 },
    { slug: 'hotels', name: 'Hotels', description: 'Hotels, guesthouses and short-stay apartments', icon: 'bed', sortOrder: 50 },
    { slug: 'shops', name: 'Shops', description: 'Retail shops, supermarkets and markets', icon: 'shopping-bag', sortOrder: 60 },
];

/**
 * Categories 004 seeded that this seed does not own.
 *
 * Deactivated so the public directory shows the six above and nothing else.
 * A future migration may drop them once no business references them.
 */
export const RETIRED_CATEGORY_SLUGS = [
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
];

export interface SeedHours {
    /** 0 = Sunday .. 6 = Saturday, matching Date#getDay(). */
    day: number;
    /** null means closed that day. */
    open: string | null;
}

/** Business hours are a plain shape here; the table takes the pairs. */
export type Weekday = 0 | 1 | 2 | 3 | 4 | 5 | 6;

export interface SeedReview {
    /** Index into SEED_REVIEWERS, 0-based. */
    reviewer: number;
    rating: 1 | 2 | 3 | 4 | 5;
    text: string;
}

export interface SeedBusiness {
    name: string;
    slug: string;
    category: string;
    city: string;
    district: string;
    address: string;
    description: string;
    phone: string;
    whatsapp: string;
    featured: boolean;
    /** Whole week, 0 = Sunday. A null `open` means the day is closed. */
    hours: SeedDayHours[];
    reviews: SeedReview[];
}

/**
 * Opening hours are written out as explicit open/close pairs rather than
 * "open, plus fourteen hours". The pairs are what the reviewer sees on the
 * public profile, so computing them from a rule would hide the real schedule
 * behind arithmetic nobody can check at a glance.
 *
 * A null `open` means closed that day. Times that cross midnight are avoided:
 * opening_hours_order requires closes_at > opens_at, and "18:00 to 02:00"
 * would need a rule about which day the close belongs to.
 */
export interface SeedDayHours {
    day: Weekday;
    open: string | null;
    close?: string | null;
}

const WEEKDAYS: Weekday[] = [0, 1, 2, 3, 4, 5, 6];

/** Open every hour of every day: a hospital, a hotel reception. */
const ALL_DAY: SeedDayHours[] = WEEKDAYS.map((day) => ({ day, open: '00:00', close: '23:59' }));

/** Restaurants: lunch to late evening, closed on Sunday. */
const RESTAURANT_HOURS: SeedDayHours[] = WEEKDAYS.map((day) => (
    day === 0 ? { day, open: null } : { day, open: '12:00', close: '23:00' }
));

/** Pharmacies: 08:00 to 21:00, closed on Friday. */
const PHARMACY_HOURS: SeedDayHours[] = WEEKDAYS.map((day) => (
    day === 5 ? { day, open: null } : { day, open: '08:00', close: '21:00' }
));

/** Daytime retail: 07:00 to 19:00, closed on Friday and Sunday. */
const SHOP_HOURS: SeedDayHours[] = WEEKDAYS.map((day) => (
    day === 0 || day === 5 ? { day, open: null } : { day, open: '07:00', close: '19:00' }
));

/** Event halls: 10:00 to 22:00, closed on Sunday. */
const HALL_HOURS: SeedDayHours[] = WEEKDAYS.map((day) => (
    day === 0 ? { day, open: null } : { day, open: '10:00', close: '22:00' }
));

export const SEED_BUSINESSES: SeedBusiness[] = [
    {
        name: 'Lila Restaurant',
        slug: 'lila-restaurant-mogadishu',
        category: 'restaurants',
        city: 'Mogadishu',
        district: 'Hamar Weyne',
        address: '12 Marina Street, Hamar Weyne',
        description:
            'Somali grill and coastal seafood house. Lunch plates, family sharing '
            + 'platters and a separate family section on the upper floor.',
        phone: '+252900000101',
        whatsapp: '+252900000101',
        featured: true,
        hours: RESTAURANT_HOURS,
        reviews: [
            { reviewer: 0, rating: 5, text: 'The bariis and the octopus grill are worth the trip. Service was quick even when it was full.' },
            { reviewer: 1, rating: 4, text: 'Good food, generous portions. The family section is much quieter than the ground floor.' },
            { reviewer: 2, rating: 5, text: 'We booked for a family celebration and they handled the whole evening for us.' },
        ],
    },
    {
        name: 'Mogadishu General Hospital',
        slug: 'mogadishu-general-hospital',
        category: 'hospitals',
        city: 'Mogadishu',
        district: 'Hodan',
        address: '1 Hospital Road, Hodan',
        description:
            'General hospital with an emergency department, outpatient clinics and '
            + 'an on-site laboratory. Open around the clock, every day.',
        phone: '+252900000102',
        whatsapp: '+252900000102',
        featured: false,
        hours: ALL_DAY,
        reviews: [
            { reviewer: 3, rating: 4, text: 'The emergency desk was responsive at 2am. Triage took about twenty minutes.' },
            { reviewer: 4, rating: 4, text: 'Clean and orderly. Waiting times in the morning are long, so come early.' },
            { reviewer: 5, rating: 3, text: 'Good for emergencies. The outpatient queues need work, and there is little seating.' },
            { reviewer: 0, rating: 4, text: 'The lab results came back the same day, which was a relief.' },
        ],
    },
    {
        name: 'Baab Qurugo Pharmacy',
        slug: 'baab-qurugo-pharmacy',
        category: 'pharmacies',
        city: 'Mogadishu',
        district: 'Benadir',
        address: '4 Aden Adde Road, Benadir',
        description:
            'Neighbourhood pharmacy and chemist. Prescription dispensing, basic '
            + 'health supplies and a small range of baby care products.',
        phone: '+252900000103',
        whatsapp: '+252900000103',
        featured: false,
        hours: PHARMACY_HOURS,
        reviews: [
            { reviewer: 1, rating: 5, text: 'The pharmacist explained the dosage carefully instead of just handing it over.' },
            { reviewer: 2, rating: 4, text: 'Always has the basics in stock. Closed on Friday afternoons, which took me a while to learn.' },
        ],
    },
    {
        name: 'Sabriga Wedding Hall',
        slug: 'sabriga-wedding-hall',
        category: 'wedding-halls',
        city: 'Mogadishu',
        district: 'Wadajir',
        address: 'Sabriga Road, Wadajir',
        description:
            'Event hall for weddings, engagements and conferences. Seats 400, with '
            + 'catering options, separate bridal rooms and on-site parking.',
        phone: '+252900000104',
        whatsapp: '+252900000104',
        featured: true,
        hours: HALL_HOURS,
        reviews: [
            { reviewer: 3, rating: 5, text: 'They handled two hundred guests and the coordination was calm throughout.' },
            { reviewer: 4, rating: 4, text: 'Spacious and air conditioned. The parking area fills up fast, so send cars early.' },
            { reviewer: 5, rating: 5, text: 'The bridal rooms are well decorated and the family lounge upstairs is a real relief.' },
        ],
    },
    {
        name: 'Hargeisa Star Restaurant',
        slug: 'hargeisa-star-restaurant',
        category: 'restaurants',
        city: 'Hargeisa',
        district: 'Abdi Aynanshe',
        address: '22 Aynanshe Street, Abdi Aynanshe',
        description:
            'Family restaurant serving Somali grill, camel dishes and cold drinks. '
            + 'Large shaded terrace at the back.',
        phone: '+252900000105',
        whatsapp: '+252900000105',
        featured: false,
        hours: RESTAURANT_HOURS,
        reviews: [
            { reviewer: 1, rating: 4, text: 'The camel stew is excellent and the terrace keeps it cool in the afternoon.' },
            { reviewer: 0, rating: 4, text: 'Reliable, consistent food. Gets busy at sunset on weekends.' },
        ],
    },
    {
        name: 'Quraysh Pharmacy',
        slug: 'quraysh-pharmacy-hargeisa',
        category: 'pharmacies',
        city: 'Hargeisa',
        district: "Gul'",
        address: '7 Independence Street, Gul\u2019',
        description:
            'Pharmacy and wellness counter. Chronic medicine refills, blood '
            + 'pressure checks and a small range of vitamins.',
        phone: '+252900000106',
        whatsapp: '+252900000106',
        featured: false,
        hours: PHARMACY_HOURS,
        reviews: [
            { reviewer: 2, rating: 5, text: 'They keep my father monthly medication in stock and hold it for him when he cannot come in.' },
            { reviewer: 3, rating: 4, text: 'Helpful staff and fair prices. The blood pressure check is free.' },
        ],
    },
    {
        name: 'Kismayo Grand Hotel',
        slug: 'kismayo-grand-hotel',
        category: 'hotels',
        city: 'Kismayo',
        district: 'Tawfiiq',
        address: '3 Beach Road, Tawfiiq',
        description:
            'Hotel with sea-facing rooms, a restaurant and event space. Airport '
            + 'transfer on request. Reception staffed around the clock.',
        phone: '+252900000107',
        whatsapp: '+252900000107',
        featured: true,
        hours: ALL_DAY,
        reviews: [
            { reviewer: 4, rating: 5, text: 'The sea view rooms are worth the extra. Staff arranged an airport transfer without any fuss.' },
            { reviewer: 5, rating: 4, text: 'Comfortable beds and reliable hot water, which matters more than the decoration.' },
            { reviewer: 0, rating: 4, text: 'Good location near the beach road. The restaurant closes a little early.' },
            { reviewer: 1, rating: 3, text: 'Fine for a night, and the staff are friendly, but the corridors need refurbishing.' },
        ],
    },
    {
        name: 'Jubba Shopping Centre',
        slug: 'jubba-shopping-centre',
        category: 'shops',
        city: 'Kismayo',
        district: 'Faarax Omar',
        address: '15 Main Market Street, Faarax Omar',
        description:
            'General store: groceries, household goods, school supplies and a small '
            + 'counter for phone accessories.',
        phone: '+252900000108',
        whatsapp: '+252900000108',
        featured: false,
        hours: SHOP_HOURS,
        reviews: [
            { reviewer: 2, rating: 4, text: 'Everything on one list, which saves a trip. School supplies are cheaper than the market stalls.' },
            { reviewer: 3, rating: 3, text: 'Good range, but the aisles get crowded at the weekend and stock moves slowly.' },
        ],
    },
    {
        name: 'Bosaso Medical Centre',
        slug: 'bosaso-medical-centre',
        category: 'hospitals',
        city: 'Bosaso',
        district: 'Sanaag',
        address: '2 Hospital Road, Sanaag',
        description:
            'Medical centre offering general consultations, paediatric care, '
            + 'maternal services and a pharmacy on site.',
        phone: '+252900000109',
        whatsapp: '+252900000109',
        featured: false,
        hours: ALL_DAY,
        reviews: [
            { reviewer: 4, rating: 4, text: 'The paediatric nurse was patient with my son and the pharmacy had what we needed on the spot.' },
            { reviewer: 5, rating: 3, text: 'Reasonable for the town. Waiting can be long, and the laboratory is limited.' },
        ],
    },
    {
        name: 'Bosaso Wedding Palace',
        slug: 'bosaso-wedding-palace',
        category: 'wedding-halls',
        city: 'Bosaso',
        district: 'Sanaag',
        address: '8 Celebration Avenue, Sanaag',
        description:
            'Hall for weddings and majlis gatherings. Three halls of different '
            + 'sizes, with a kitchen for outside caterers.',
        phone: '+252900000110',
        whatsapp: '+252900000110',
        featured: false,
        hours: HALL_HOURS,
        reviews: [
            { reviewer: 0, rating: 4, text: 'We used the medium hall for a majlis. Clean, with plenty of seating and good ventilation.' },
            { reviewer: 1, rating: 4, text: 'They let us use our own caterer, which saved a lot. Book well ahead.' },
            { reviewer: 2, rating: 5, text: 'The large hall fits our family comfortably and the staff stay until everything is packed away.' },
        ],
    },
    {
        name: 'Baidoa Community Hospital',
        slug: 'baidoa-community-hospital',
        category: 'hospitals',
        city: 'Baidoa',
        district: 'Tawfiiq',
        address: '1 Aid Road, Tawfiiq',
        description:
            'Community hospital serving Baidoa. General outpatient care, maternal '
            + 'health and basic inpatient beds.',
        phone: '+252900000111',
        whatsapp: '+252900000111',
        featured: false,
        hours: ALL_DAY,
        reviews: [
            { reviewer: 3, rating: 4, text: 'The maternity ward staff were kind and attentive. Bring your own supplies.' },
            { reviewer: 4, rating: 3, text: 'It does essential work with limited equipment. Prescriptions sometimes need filling elsewhere.' },
        ],
    },
    {
        name: 'Garowe Fresh Mart',
        slug: 'garowe-fresh-mart',
        category: 'shops',
        city: 'Garowe',
        district: 'Abdi Dhexe',
        address: '5 Market Road, Abdi Dhexe',
        description:
            'Supermarket and fresh produce. Fruit, vegetables, meat counter, and a '
            + 'deli counter for grilled items to take away.',
        phone: '+252900000112',
        whatsapp: '+252900000112',
        featured: false,
        hours: SHOP_HOURS,
        reviews: [
            { reviewer: 5, rating: 4, text: 'The produce section is fresher than the market and the deli counter is a good lunch stop.' },
            { reviewer: 0, rating: 4, text: 'Good range and honest weighing. It gets busy on the first of the month.' },
        ],
    },
];

/**
 * Six invented reviewers, shared across the directory.
 *
 * `reviews_business_user_unique` allows one review per (business, user), so a
 * business draws from this pool without any reviewer appearing twice against
 * the same business. Six reviewers is enough for the four or five reviews each
 * business gets.
 */
export const SEED_REVIEWERS = [
    { email: 'hodan.cusmaan@example.test', fullName: 'Hodan Cusmaan' },
    { email: 'faarax.qaad@example.test', fullName: 'Faarax Qaad' },
    { email: 'shirin.owlad@example.test', fullName: 'Shirin Owlad' },
    { email: 'khadar.nuura@example.test', fullName: 'Khadar Nuura' },
    { email: 'hodan.cali@example.test', fullName: 'Hodan Cali' },
    { email: 'sahra.abdi@example.test', fullName: 'Sahra Abdi' },
];

/** The platform administrator the seed owns. */
export const SEED_ADMIN = { email: 'admin@hq.test', fullName: 'HQ Platform Admin' };

/**
 * Business owners, one per business, cycling through this list.
 *
 * An owner is a plain user account here. They are not "real" people: the names
 * and addresses are invented and the accounts exist only so that membership,
 * ownership and the staff endpoints have something to resolve.
 */
export const SEED_OWNERS = [
    { email: 'owner.layla@example.test', fullName: 'Layla Barre' },
    { email: 'owner.omar@example.test', fullName: 'Omar Dahir' },
    { email: 'owner.amina@example.test', fullName: 'Amina Yusuf' },
    { email: 'owner.halima@example.test', fullName: 'Halima Aden' },
    { email: 'owner.mustafa@example.test', fullName: 'Mustafa Warsame' },
    { email: 'owner.zahra@example.test', fullName: 'Zahra Ismail' },
];

export const SEED_PASSWORD = 'Password123!';

/**
 * Slugs the previous seed owned.
 *
 * Listed so the replacement deletes them. Anything not in this list and not in
 * `SEED_BUSINESSES` is left alone.
 */
export const LEGACY_BUSINESS_SLUGS = [
    'abc-clinic-damascus',
    'abc-clinic-homs',
    'city-pharmacy-1',
    'new-tech-store',
];

/** Users the previous seed created, likewise. */
export const LEGACY_USER_EMAILS = [
    'ahmed@hq.test',
    'mohamed@hq.test',
    'ali@hq.test',
    'sara@hq.test',
];

