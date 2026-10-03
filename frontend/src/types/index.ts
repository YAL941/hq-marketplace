// Core API response types
export interface ApiResponse<T> {
  data: T;
  meta?: Record<string, unknown>;
  error?: {
    code: string;
    message: string;
    details?: unknown;
  };
}

/**
 * Pager returned by every paginated public directory response.
 * `total` is the count across all pages, not the length of `data`.
 */
export interface PageMeta {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
  hasNext: boolean;
  hasPrevious: boolean;
}

export interface PaginatedResponse<T> {
  data: T[];
  meta: {
    count: number;
    limit?: number;
    offset?: number;
  };
}

// User & Auth
export interface User {
  user_id: Id;
  email: string;
  full_name: string;
  phone?: string;
  avatar_url?: string;
  status: 'active' | 'pending' | 'suspended' | 'deleted';
  last_login_at?: string;
  created_at: string;
  updated_at: string;
}

export interface PlatformRole {
  role_key: string;
  role_name: string;
  scope: 'platform' | 'business';
}

export interface BusinessMembership {
  business_id: Id;
  business_name: string;
  business_slug: string;
  status: string;
  role_key: string;
  role_name: string;
}

export interface AuthMeResponse {
  user: User | null;
  platformRoles: PlatformRole[];
  businesses: BusinessMembership[];
}

export interface LoginResponse {
  user: { user_id: Id; email: string | null; full_name: string };
  token: string;
}

/** Where an account starts. `business_owner` also creates a business. */
export type AccountRole = 'customer' | 'business_owner';

/**
 * The signup body.
 *
 * `email` and `phone` are both optional in the type and optional on the server,
 * with a shared rule that at least one has to be present. Modelling that as a
 * union would force every caller to branch, and the form already enforces it.
 */
export interface RegisterPayload {
  fullName: string;
  password: string;
  role: AccountRole;
  /** Required by the server when `role` is `business_owner`. */
  businessName?: string;
  email?: string;
  phone?: string;
}

export interface RegisterResponse extends LoginResponse {
  /** The business created alongside a `business_owner` account, else null. */
  business: BusinessSummary | null;
}

/** What onboarding and registration hand back: id, name, slug and status. */
export type BusinessSummary = {
  business_id: string;
  business_name: string;
  business_slug: string;
  status: string;
};

// ---------------------------------------------------------------------------
// Public directory
//
// These mirror what the public routes actually return. Two things to keep in
// mind when reading them:
//
//   * `business_id` is a **string** on every public route. The ids are bigints
//     and are serialised as strings so a large id cannot lose precision in
//     JSON. Do not type it as number here, or `Number(business_id)` will
//     silently corrupt it.
//   * There is no `verified` field anywhere. The directory does not publish
//     verification state, and nothing in the UI may imply that a business is
//     checked. `is_featured` is editorial and is not a trust signal.
// ---------------------------------------------------------------------------

/** The list projection: what a card needs. */
export interface PublicBusinessCard {
  business_id: string;
  business_name: string;
  business_slug: string;
  category_name: string | null;
  category_slug: string | null;
  city: string | null;
  district: string | null;
  logo_url: string | null;
  cover_image_url: string | null;
  business_description: string | null;
  is_featured: boolean;
  created_at: string;
  /** Decimal string, null when the business has no reviews yet. */
  average_rating: string | null;
  review_count: number;
  is_open_now?: boolean;
}

/** One weekday. The server always returns all seven, closed days included. */
export interface OpeningHour {
  /** 0 = Sunday through 6 = Saturday, matching Postgres `day_of_week`. */
  day_of_week: number;
  /** "HH:MM", or null on a closed day. */
  opens_at: string | null;
  closes_at: string | null;
  is_closed: boolean;
}

export type RatingDistribution = Record<'1' | '2' | '3' | '4' | '5', number>;

/** The full profile behind GET /businesses/:businessId. */
export interface PublicBusinessProfile extends PublicBusinessCard {
  business_description: string | null;
  address: string | null;
  phone: string | null;
  /** Digits only, optionally with a leading +. Null when not published. */
  whatsapp_number: string | null;
  website: string | null;
  latitude: number | null;
  longitude: number | null;
  rating_distribution: RatingDistribution;
  opening_hours: OpeningHour[];
}

/** A published review. The reviewer's account is never published. */
export interface PublicReview {
  review_id: string;
  rating: number;
  review_text: string | null;
  business_response: string | null;
  responded_at: string | null;
  created_at: string;
  author_name: string;
}

export interface PublicCategory {
  category_id: string;
  category_name: string;
  category_slug: string;
  description: string | null;
  business_count: number;
}

export interface PublicCity {
  city: string;
  business_count: number;
}

export type DirectorySort = 'newest' | 'rating' | 'featured';

export interface PublicDirectoryQuery {
  /** Free-text name search. */
  q?: string;
  /** Slug, which is what a public URL carries. */
  category?: string;
  categoryId?: number;
  city?: string;
  sort?: DirectorySort;
  featured?: boolean;
  page?: number;
  /** The server caps this at 50 and rejects anything higher. */
  limit?: number;
}

// Business
export interface Business {
  business_id: Id;
  business_name: string;
  business_slug: string;
  business_description?: string;
  business_category_id?: Id;
  phone?: string;
  email?: string;
  website?: string;
  address?: string;
  city?: string;
  district?: string;
  latitude?: number;
  longitude?: number;
  logo_url?: string;
  cover_image_url?: string;
  status: 'pending' | 'active' | 'suspended' | 'closed' | 'rejected';
  is_verified: boolean;
  verification_status: 'pending' | 'verified' | 'rejected';
  created_at: string;
  updated_at: string;
  deleted_at?: string;
  category_name?: string;
  /**
   * Rating rollup joined in by the public directory query, absent on staff
   * routes. Use the Public* types above for anything the directory serves.
   */
  average_rating?: string | null;
  review_count?: number;
  whatsapp_number?: string | null;
  is_featured?: boolean;
}

// Categories
export interface BusinessCategory {
  category_id: number;
  category_name: string;
  category_slug: string;
  description?: string;
  icon?: string;
  sort_order: number;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

/**
 * What a category card renders. The public /categories route returns exactly
 * this and nothing more, so cards take it rather than the admin record.
 */
export type CategorySummary = PublicCategory;

/**
 * `Product`, `ProductInput`, `ProductListQuery`, `Service`, `ServiceInput`,
 * `ServiceListQuery`, `Order`, `OrderItem`, `OrderDetail`, `OrderListQuery`,
 * `BusinessReview`, `ReviewListQuery`, `BusinessStatistics`, `BusinessMember`
 * and `Id`/`CatalogueStatus`/`OrderStatus` live in the owner dashboard block at
 * the end of this file. They used to be declared here with `number` ids and
 * `number` money, which does not match what the API actually sends.
 *
 * One rule for ids: a path or query id is a **string**, because the columns are
 * bigints and are serialised as text. A body id (`CreateOrderInput.businessId`,
 * `ProductInput.categoryId`, `AddMemberInput.userId`) stays a **number**,
 * because the server validates those with `z.number()`.
 */

export interface CreateProductInput {
  productName: string;
  categoryId?: number | null;
  description?: string | null;
  price: number;
  currency?: string;
  sku?: string | null;
  imageUrl?: string | null;
  stockQuantity?: number;
  status?: string;
}

// Services
export interface CreateServiceInput {
  serviceName: string;
  serviceCategoryId?: number | null;
  locationId?: number | null;
  description?: string | null;
  price: number;
  currency?: string;
  durationMinutes?: number | null;
  capacity?: number | null;
  isBookable?: boolean;
  status?: string;
}

// Orders
export interface CreateOrderInput {
  businessId: number;
  locationId?: number | null;
  items: Array<{
    productId?: number;
    serviceId?: number;
    quantity: number;
  }>;
  deliveryFee?: number;
  discountAmount?: number;
  taxAmount?: number;
  currency?: string;
  customerNote?: string | null;
  deliveryAddress?: string | null;
  scheduledFor?: string | null;
}

// Reviews
export interface CreateReviewInput {
  businessId: number;
  orderId?: number | null;
  rating: number;
  reviewText?: string | null;
}

// Locations
export interface Location {
  location_id: Id;
  business_id: Id;
  location_name: string;
  address?: string;
  city?: string;
  district?: string;
  latitude?: number;
  longitude?: number;
  phone?: string;
  is_primary: boolean;
  is_active: boolean;
  /**
   * Staff-managed branch hours. Public opening hours live on the business as
   * `OpeningHour[]` and are served with the business profile instead.
   */
  working_hours?: Record<string, string[]>;
  created_at: string;
  updated_at: string;
}

export interface CreateLocationInput {
  locationName: string;
  address?: string | null;
  city?: string | null;
  district?: string | null;
  latitude?: number | null;
  longitude?: number | null;
  phone?: string | null;
  isPrimary?: boolean;
  isActive?: boolean;
  workingHours?: Record<string, string[]> | null;
}

export interface AddMemberInput {
  userId: number;
  roleKey: 'business_owner' | 'business_manager' | 'business_employee';
}

// ---------------------------------------------------------------------------
// Owner dashboard
//
// Every shape below mirrors a row the server actually returns. Amounts are
// strings because the columns are NUMERIC: the driver hands them over as text
// so that a value like 1234567890123456.78 is not silently rounded by a JS
// double, and parsing them here would lose that. Money is formatted with
// formatCurrency at the point of display, not on the way in.

/** `bigint` columns arrive serialised, so ids stay strings. */
export type Id = string;

export type CatalogueStatus = 'draft' | 'active' | 'inactive' | 'archived';

export interface Product {
  product_id: Id;
  business_id: Id;
  category_id: Id | null;
  product_name: string;
  description: string | null;
  price: string;
  discount_price: string | null;
  currency: string;
  sku: string | null;
  image_url: string | null;
  stock_quantity: number;
  is_stock_tracked: boolean;
  status: CatalogueStatus;
  rating_avg: string;
  rating_count: number;
  created_at: string;
  updated_at: string;
}

export interface Service {
  service_id: Id;
  business_id: Id;
  service_category_id: Id | null;
  location_id: Id | null;
  service_name: string;
  description: string | null;
  price: string;
  currency: string;
  duration_minutes: number | null;
  capacity: number | null;
  is_bookable: boolean;
  status: CatalogueStatus;
  rating_avg: string;
  rating_count: number;
  created_at: string;
  updated_at: string;
}

export interface ProductInput {
  productName: string;
  categoryId?: number | null;
  description?: string | null;
  /** A number, not a string: the schema is `z.number().nonnegative()`. */
  price: number;
  currency?: string;
  sku?: string | null;
  imageUrl?: string | null;
  stockQuantity?: number;
  status?: CatalogueStatus;
}

export interface ServiceInput {
  serviceName: string;
  serviceCategoryId?: number | null;
  locationId?: number | null;
  description?: string | null;
  price: number;
  currency?: string;
  durationMinutes?: number | null;
  capacity?: number | null;
  isBookable?: boolean;
  status?: CatalogueStatus;
}

export type OrderStatus =
  | 'pending'
  | 'confirmed'
  | 'in_progress'
  | 'ready'
  | 'out_for_delivery'
  | 'completed'
  | 'cancelled'
  | 'rejected'
  | 'refunded';

/** The only statuses the owner is allowed to move an order into. */
export type SettableOrderStatus = Exclude<OrderStatus, 'pending' | 'refunded'>;

export interface Order {
  order_id: Id;
  order_number: string;
  business_id: Id;
  customer_id: Id;
  location_id: Id | null;
  order_type: string;
  order_status: OrderStatus;
  subtotal: string;
  delivery_fee: string;
  discount_amount: string;
  tax_amount: string;
  total_amount: string;
  currency: string;
  customer_note: string | null;
  delivery_address: string | null;
  scheduled_for: string | null;
  created_at: string;
  updated_at: string;
}

/**
 * One line of an order.
 *
 * `item_name` is a copy the order took when it was placed, so a product deleted
 * since then still shows its name on the order. The owning product or service is
 * an id and nothing else: this endpoint does not join to either table.
 */
export interface OrderItem {
  order_item_id: Id;
  product_id: Id | null;
  service_id: Id | null;
  item_type: string;
  item_name: string;
  quantity: number;
  unit_price: string;
  total_price: string;
  notes: string | null;
}

export interface OrderDetail {
  order: Order;
  items: OrderItem[];
}

export type ReviewStatus = 'pending' | 'published' | 'rejected' | 'hidden';

/**
 * A review as the owner's endpoint returns it.
 *
 * There is no reviewer name on this row: the endpoint selects `r.*`, and only
 * the public endpoint reads `app_public_reviews()`, which is the one that
 * publishes a display name. `user_id` is the only trace of who wrote it, and it
 * is not a name, so the UI shows a neutral label instead of guessing one.
 */
export interface BusinessReview {
  review_id: Id;
  business_id: Id;
  user_id: Id;
  order_id: Id | null;
  rating: number;
  review_text: string | null;
  business_response: string | null;
  status: ReviewStatus;
  created_at: string;
  updated_at: string;
}

/**
 * The one row `business_statistics` holds.
 *
 * There is no time series here. Every chart a dashboard usually draws needs a
 * series, so anything that plots one has no data behind it and is not rendered.
 */
export interface BusinessStatistics {
  business_id: Id;
  total_orders: number;
  completed_orders: number;
  cancelled_orders: number;
  pending_orders: number;
  total_customers: number;
  total_products: number;
  total_services: number;
  total_reviews: number;
  average_rating: string;
  total_revenue: string;
  computed_at: string;
}

export interface BusinessMember {
  business_user_id: Id;
  user_id: Id;
  full_name: string;
  email: string;
  role_key: string;
  role_name: string;
  status: string;
  joined_at: string;
}

/** The subset of the business row the settings screen edits. */
export interface BusinessProfilePatch {
  businessName?: string;
  businessDescription?: string | null;
  businessCategoryId?: number | null;
  phone?: string | null;
  /**
   * Sent as `whatsapp`, not as the column name: the route maps it to
   * `whatsapp_number` and normalises it to E.164 like the phone.
   */
  whatsapp?: string | null;
  email?: string | null;
  website?: string | null;
  address?: string | null;
  city?: string | null;
  district?: string | null;
  logoUrl?: string | null;
  coverImageUrl?: string | null;
}

/**
 * The body of a business registration.
 *
 * `businessCategoryId` is a **number** even though `category_id` arrives as a
 * string everywhere else: the route validates it with `z.number().int()`.
 * `phone` and `whatsapp` are sent as typed and normalised by the server, which
 * is the copy of the rules in `lib/phone.ts` mirrored on the other side.
 */
export interface BusinessRegistrationInput {
  businessName: string;
  businessCategoryId?: number;
  description?: string;
  phone?: string;
  whatsapp?: string;
  email?: string;
  address?: string;
  city?: string;
  district?: string;
}

/**
 * The staff read of a business: `GET /api/business/:businessId`.
 *
 * This is the only read that returns a business which is not public yet. The
 * public profile answers 404 for `pending` and `rejected`, so an owner opening
 * their own dashboard has to come here or see nothing at all.
 */
export interface StaffBusinessProfile extends BusinessRecord {
  /** Joined for display only; the id is `business_category_id`. */
  category_name: string | null;
  category_slug: string | null;
  whatsapp_number: string | null;
  /** Why it was rejected, or null. Only ever set by an admin decision. */
  rejection_reason: string | null;
  verified_at: string | null;
}

/** The three business states the admin queue can filter by. */
export type AdminBusinessStatus = 'pending' | 'active' | 'rejected';

/**
 * One row of the admin verification queue.
 *
 * `owner_*` is who registered it: an admin's first question about an
 * application is who is behind it, so the account's name and email travel with
 * the row rather than needing a second lookup.
 */
export interface AdminBusinessRow {
  business_id: Id;
  business_name: string;
  business_slug: string;
  business_description: string | null;
  category_name: string | null;
  category_slug: string | null;
  address: string | null;
  city: string | null;
  district: string | null;
  phone: string | null;
  whatsapp_number: string | null;
  email: string | null;
  status: AdminBusinessStatus;
  verification_status: string;
  is_verified: boolean;
  rejection_reason: string | null;
  verified_at: string | null;
  created_at: string;
  owner_user_id: Id | null;
  owner_full_name: string | null;
  owner_email: string | null;
}

/**
 * What a verification decision returns.
 *
 * It is a summary on purpose: the admin asked to change the verification, not to
 * read the business, so the rest of the row is not repeated here.
 */
export interface VerificationDecision {
  business_id: Id;
  business_name: string;
  business_slug: string;
  status: string;
  verification_status: string;
  is_verified: boolean;
  verified_at: string | null;
  rejection_reason: string | null;
}

/** The body of a decision. `reason` is required, and long enough, to reject. */
export interface VerificationInput {
  decision: 'approve' | 'reject';
  reason?: string;
  /** Re-deciding a business that already carries this decision is a 409. */
  force?: boolean;
}

export interface BusinessRecord {
  business_id: Id;
  business_name: string;
  business_slug: string;
  business_description: string | null;
  business_category_id: Id | null;
  phone: string | null;
  email: string | null;
  website: string | null;
  address: string | null;
  city: string | null;
  district: string | null;
  logo_url: string | null;
  cover_image_url: string | null;
  status: string;
  is_verified: boolean;
  verification_status: string;
  created_at: string;
  updated_at: string;
}

/**
 * The metadata every owner-scoped list returns.
 *
 * `count` is the length of the page that came back, not the size of the table.
 * There is no total and no totalPages anywhere in these endpoints, so a pager
 * can offer next and previous but cannot say how many pages there are.
 */
export interface StaffListMeta {
  count: number;
  businessId: Id;
}

export interface StaffListQuery {
  limit?: number;
  offset?: number;
}

export interface ProductListQuery extends StaffListQuery {
  status?: CatalogueStatus;
  categoryId?: number;
  /**
   * Named `search` by the server; `q` is rejected by its schema and silently
   * dropped, which would leave the search box looking broken. The public
   * directory is the one that calls it `q`.
   */
  search?: string;
}

export interface ServiceListQuery extends StaffListQuery {
  status?: CatalogueStatus;
  serviceCategoryId?: number;
  search?: string;
}

export interface OrderListQuery extends StaffListQuery {
  orderStatus?: OrderStatus;
  customerId?: number;
}

export interface ReviewListQuery extends StaffListQuery {
  status?: ReviewStatus;
  minRating?: number;
}