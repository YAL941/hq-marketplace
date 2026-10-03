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
  user_id: number;
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
  business_id: number;
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
  user: { user_id: number; email: string | null; full_name: string };
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
  business: {
    business_id: string;
    business_name: string;
    business_slug: string;
    status: string;
  } | null;
}

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
  business_id: number;
  business_name: string;
  business_slug: string;
  business_description?: string;
  business_category_id?: number;
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

export interface BusinessStatistics {
  business_id: number;
  total_orders: number;
  completed_orders: number;
  cancelled_orders: number;
  pending_orders: number;
  total_customers: number;
  total_products: number;
  total_services: number;
  total_reviews: number;
  average_rating: number;
  total_revenue: number;
  computed_at: string;
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

export interface Product {
  product_id: number;
  business_id: number;
  category_id?: number;
  product_name: string;
  description?: string;
  price: string;
  discount_price?: string;
  currency: string;
  sku?: string;
  image_url?: string;
  stock_quantity: number;
  is_stock_tracked: boolean;
  status: 'draft' | 'active' | 'inactive' | 'archived';
  rating_avg: string;
  rating_count: number;
  created_at: string;
  updated_at: string;
  deleted_at?: string;
}

export interface ProductListQuery {
  status?: string;
  categoryId?: number;
  search?: string;
  limit?: number;
  offset?: number;
}

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
export interface Service {
  service_id: number;
  business_id: number;
  service_category_id?: number;
  location_id?: number;
  service_name: string;
  description?: string;
  price: string;
  currency: string;
  duration_minutes?: number;
  capacity?: number;
  is_bookable: boolean;
  status: 'draft' | 'active' | 'inactive' | 'archived';
  rating_avg: string;
  rating_count: number;
  created_at: string;
  updated_at: string;
  deleted_at?: string;
}

export interface ServiceListQuery {
  status?: string;
  serviceCategoryId?: number;
  search?: string;
  limit?: number;
  offset?: number;
}

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
export interface Order {
  order_id: number;
  order_number: string;
  business_id: number;
  customer_id: number;
  location_id?: number;
  order_type: 'product' | 'service' | 'mixed' | 'booking';
  order_status: 'pending' | 'confirmed' | 'in_progress' | 'ready' | 'out_for_delivery' | 'completed' | 'cancelled' | 'rejected' | 'refunded';
  subtotal: string;
  delivery_fee: string;
  discount_amount: string;
  tax_amount: string;
  total_amount: string;
  currency: string;
  customer_note?: string;
  delivery_address?: string;
  scheduled_for?: string;
  confirmed_at?: string;
  completed_at?: string;
  cancelled_at?: string;
  cancellation_reason?: string;
  created_at: string;
  updated_at: string;
}

export interface OrderItem {
  order_item_id: number;
  order_id: number;
  business_id: number;
  product_id?: number;
  service_id?: number;
  item_type: 'product' | 'service';
  item_name: string;
  quantity: string;
  unit_price: string;
  total_price: string;
  notes?: string;
  created_at: string;
}

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

export interface OrderListQuery {
  orderStatus?: string;
  customerId?: number;
  limit?: number;
  offset?: number;
}

// Reviews
export interface Review {
  review_id: number;
  business_id: number;
  user_id: number;
  order_id?: number;
  rating: number;
  review_text?: string;
  business_response?: string;
  responded_at?: string;
  status: 'pending' | 'published' | 'rejected' | 'hidden';
  created_at: string;
  updated_at: string;
  user_full_name?: string;
}

export interface ReviewListQuery {
  status?: string;
  minRating?: number;
  businessId?: number;
  limit?: number;
  offset?: number;
}

export interface CreateReviewInput {
  businessId: number;
  orderId?: number | null;
  rating: number;
  reviewText?: string | null;
}

// Locations
export interface Location {
  location_id: number;
  business_id: number;
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

// Business Members
export interface BusinessMember {
  business_user_id: number;
  user_id: number;
  full_name: string;
  email: string;
  role_key: string;
  role_name: string;
  status: string;
  joined_at: string;
}

export interface AddMemberInput {
  userId: number;
  roleKey: 'business_owner' | 'business_manager' | 'business_employee';
}