import axios, { AxiosError, InternalAxiosRequestConfig } from 'axios';
import type {
  ApiResponse,
  AuthMeResponse,
  BusinessMember,
  BusinessProfilePatch,
  BusinessRecord,
  BusinessReview,
  BusinessStatistics,
  BusinessSummary,
  CreateLocationInput,
  Id,
  Location,
  LoginResponse,
  Order,
  OrderDetail,
  OrderListQuery,
  Product,
  ProductInput,
  ProductListQuery,
  PublicBusinessCard,
  PublicBusinessProfile,
  PublicCategory,
  PublicCity,
  PublicDirectoryQuery,
  PublicReview,
  RegisterPayload,
  RegisterResponse,
  ReviewListQuery,
  Service,
  ServiceInput,
  ServiceListQuery,
  SettableOrderStatus,
} from '../types';

/**
 * The page size the owner screens ask for, and the two different contracts the
 * list endpoints actually have.
 *
 * The staff list routes (`/business/:id/products|services|orders|reviews`) take
 * `limit` (capped at 100), `offset` and — for the catalogues — `search`. The
 * public directory routes take `page` and `limit` instead, capped at 50, and
 * name the text filter `q`. They are different schemas, so the staff screens
 * send `offset`/`search`: sending `page` or `q` here is not an error, it is
 * silently dropped, and the search box would look broken instead of failing.
 *
 * 20 is a screenful of cards; the caps themselves are the server's business.
 */
const STAFF_PAGE_SIZE = 20;

/** Strips undefined so axios omits the parameter instead of sending `undefined`. */
function staffParams<T extends object>(query: T | undefined) {
  const clean: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(query ?? {})) {
    if (value !== undefined && value !== '' && value !== null) clean[key] = value;
  }
  return { limit: STAFF_PAGE_SIZE, ...clean };
}

const API_BASE = import.meta.env.VITE_API_BASE || '/api';

const api = axios.create({
  baseURL: API_BASE,
  headers: {
    'Content-Type': 'application/json',
  },
});

let authToken: string | null = null;

export const setAuthToken = (token: string | null) => {
  authToken = token;
  if (token) {
    api.defaults.headers.common['Authorization'] = `Bearer ${token}`;
  } else {
    delete api.defaults.headers.common['Authorization'];
  }
};

api.interceptors.request.use((config: InternalAxiosRequestConfig) => {
  if (authToken && config.headers) {
    config.headers.Authorization = `Bearer ${authToken}`;
  }
  return config;
});

api.interceptors.response.use(
  (response) => response,
  (error: AxiosError) => {
    // A rejected sign-in is a normal outcome, not a lost session, so the login
    // and register calls are exempt. Without this, a wrong password would
    // answer 401, be treated as "your session expired", and reload the page the
    // user is already on — taking the inline error message with it.
    const isAuthAttempt = /\/auth\/(login|register)$/.test(error.config?.url ?? '');
    if (error.response?.status === 401 && !isAuthAttempt) {
      setAuthToken(null);
      if (typeof window !== 'undefined') {
        window.location.href = '/login';
      }
    }
    return Promise.reject(error);
  }
);

/**
 * The error body every failure uses: `{ error: { code, message, details } }`.
 *
 * `details.field` is what lets a form put a message next to the input that
 * caused it. When it is absent the caller has to fall back to a banner, so that
 * absence is reported rather than hidden.
 */
export interface ApiErrorBody {
  error?: {
    code?: string;
    message?: string;
    details?: { field?: string; reason?: string } | string;
  };
}

export interface FieldIssue {
  /**
   * Which input the message belongs to, when the server said.
   *
   * Typed as `string` rather than a fixed union: the auth schema names
   * `identifier`, the business schema names `businessName`, and the catalogue
   * schemas name neither, so a union here would need a new member per form and
   * would silently drop the field a future endpoint reports.
   */
  field?: string;
  /** Server code, e.g. CONFLICT / BAD_REQUEST / UNAUTHORIZED. */
  code?: string;
  status?: number;
  message: string;
}

/** Reads an API failure into something a form can render. */
export function toFieldIssue(error: unknown): FieldIssue {
  if (axios.isAxiosError(error)) {
    const status = error.response?.status;
    const body = error.response?.data as ApiErrorBody | undefined;
    const details = body?.error?.details;
    const field =
      details && typeof details === 'object' && typeof details.field === 'string'
        ? (details.field as FieldIssue['field'])
        : undefined;

    // The server's message is written for a person and is already specific
    // ("This phone number is already registered"), so it is preferred over any
    // client-side wording; the caller supplies a translated fallback.
    return {
      field,
      code: body?.error?.code,
      status,
      message: body?.error?.message ?? '',
    };
  }
  return { message: error instanceof Error ? error.message : '' };
}

// Auth API
export const authApi = {
  register: (data: RegisterPayload) =>
    api.post<ApiResponse<RegisterResponse>>('/auth/register', data),

  /**
   * `identifier` is one field the server reads as either a phone number or an
   * email address; it normalises a phone to the same E.164 form the account was
   * stored with, so the caller may type it however the person prefers.
   */
  login: (data: { identifier: string; password: string }) =>
    api.post<ApiResponse<LoginResponse>>('/auth/login', data),

  me: () => api.get<ApiResponse<AuthMeResponse>>('/auth/me'),

  /**
   * Onboarding for an account that did not ask for a business at signup.
   *
   * `businessCategoryId` and the rest are the body, and the server validates
   * them as numbers and strings respectively; only the ids in a path stay as
   * strings.
   */
  registerBusiness: (data: {
    businessName: string;
    businessCategoryId?: number;
    description?: string;
    phone?: string;
    email?: string;
    address?: string;
    city?: string;
    district?: string;
  }) => api.post<ApiResponse<BusinessSummary>>('/businesses/register', data),
};

/**
 * Public directory.
 *
 * `MAX_PAGE_SIZE` mirrors the server cap in public-query.ts. Sending more than
 * that is a 400, so clamping here turns a mistake into a shorter page instead
 * of a failed request.
 */
const MAX_PAGE_SIZE = 50;
const DEFAULT_PAGE_SIZE = 20;

function pageParams(page?: number, limit?: number) {
  return {
    page: page ?? 1,
    limit: Math.min(limit ?? DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE),
  };
}

export const businessApi = {
  /**
   * GET /businesses — the public storefront listing.
   *
   * `category` is the slug a public URL carries. `q` is the free-text name
   * search. `sort` is newest | rating | featured, and `featured` is a separate
   * boolean filter that can be combined with any sort.
   */
  listPublic: (query: PublicDirectoryQuery = {}) =>
    api.get<ApiResponse<PublicBusinessCard[]>>('/businesses', {
      params: {
        q: query.q,
        category: query.category,
        categoryId: query.categoryId,
        city: query.city,
        sort: query.sort,
        featured: query.featured,
        ...pageParams(query.page, query.limit),
      },
    }),

  /** GET /businesses/:businessId — full public profile with hours and ratings. */
  getPublic: (businessId: string) =>
    api.get<ApiResponse<PublicBusinessProfile>>(`/businesses/${businessId}`),

  /**
   * GET /businesses/slug/:businessSlug — the same profile, addressed by slug.
   *
   * This is the lookup a public URL needs: the profile is reached in one
   * indexed query and the numeric id falls out of the response, so the
   * reviews and locations calls that need an id do not have to guess one.
   */
  getPublicBySlug: (businessSlug: string) =>
    api.get<ApiResponse<PublicBusinessProfile>>(`/businesses/slug/${encodeURIComponent(businessSlug)}`),

  /** GET /businesses/:businessId/reviews — published reviews, newest first. */
  listPublicReviews: (businessId: string, page?: number, limit?: number) =>
    api.get<ApiResponse<PublicReview[]>>(`/businesses/${businessId}/reviews`, {
      params: pageParams(page, limit),
    }),

  /** GET /businesses/:businessId/locations — active branches, anonymous. */
  listPublicLocations: (businessId: string) =>
    api.get<ApiResponse<Location[]>>(`/businesses/${businessId}/locations`),

  /**
   * @deprecated Kept so pages not migrated yet still compile. New code must use
   * `listPublic`, whose parameter names match the server.
   */
  list: (query: PublicDirectoryQuery = {}) => businessApi.listPublic(query),

  /**
   * GET /business/:businessId/statistics — the one row `business_statistics`
   * holds. It refreshes the cache on read, so `computed_at` is when the numbers
   * were calculated, which is shown next to them rather than hidden.
   */
  getStatistics: (businessId: Id) =>
    api.get<ApiResponse<BusinessStatistics>>(`/business/${businessId}/statistics`),

  getMembers: (businessId: Id) =>
    api.get<ApiResponse<BusinessMember[]>>(`/business/${businessId}/members`),

  addMember: (businessId: Id, data: { userId: number; roleKey: string }) =>
    api.post<ApiResponse<BusinessMember>>(`/business/${businessId}/members`, data),

  /** PATCH /business/:businessId — partial update, empty fields rejected. */
  update: (businessId: Id, data: BusinessProfilePatch) =>
    api.patch<ApiResponse<BusinessRecord>>(`/business/${businessId}`, data),
};

/** Reference data for the public directory. No authentication. */
export const directoryApi = {
  /** GET /categories — includes `business_count` for each category. */
  categories: () => api.get<ApiResponse<PublicCategory[]>>('/categories'),

  /** GET /cities — only cities that have at least one public business. */
  cities: () => api.get<ApiResponse<PublicCity[]>>('/cities'),
};

// Products API
export const productApi = {
  /** GET /products — the public catalogue. Anonymous. */
  listPublic: (params?: ProductListQuery) =>
    api.get<ApiResponse<Product[]>>('/products', { params }),

  listForBusiness: (businessId: Id, params?: ProductListQuery) =>
    api.get<ApiResponse<Product[]>>(`/business/${businessId}/products`, { params: staffParams(params) }),

  getForBusiness: (businessId: Id, productId: Id) =>
    api.get<ApiResponse<Product>>(`/business/${businessId}/products/${productId}`),

  create: (businessId: Id, data: ProductInput) =>
    api.post<ApiResponse<Product>>(`/business/${businessId}/products`, data),

  update: (businessId: Id, productId: Id, data: Partial<ProductInput>) =>
    api.patch<ApiResponse<Product>>(`/business/${businessId}/products/${productId}`, data),

  /**
   * DELETE is an archive, not a destroy: the route calls `archiveProduct`, so
   * the row survives with `status = 'archived'` and can be filtered out of the
   * public catalogue instead of vanishing from past orders.
   */
  archive: (businessId: Id, productId: Id) =>
    api.delete(`/business/${businessId}/products/${productId}`),
};

// Services API
export const serviceApi = {
  listPublic: (params?: ServiceListQuery) =>
    api.get<ApiResponse<Service[]>>('/services', { params }),

  listForBusiness: (businessId: Id, params?: ServiceListQuery) =>
    api.get<ApiResponse<Service[]>>(`/business/${businessId}/services`, { params: staffParams(params) }),

  getForBusiness: (businessId: Id, serviceId: Id) =>
    api.get<ApiResponse<Service>>(`/business/${businessId}/services/${serviceId}`),

  create: (businessId: Id, data: ServiceInput) =>
    api.post<ApiResponse<Service>>(`/business/${businessId}/services`, data),

  update: (businessId: Id, serviceId: Id, data: Partial<ServiceInput>) =>
    api.patch<ApiResponse<Service>>(`/business/${businessId}/services/${serviceId}`, data),
};

// Orders API
export const orderApi = {
  /** POST /orders — a customer places an order. */
  create: (data: {
    businessId: number;
    items: Array<{ productId?: number; serviceId?: number; quantity?: number }>;
    locationId?: number | null;
    customerNote?: string | null;
    deliveryAddress?: string | null;
    deliveryFee?: number;
    discountAmount?: number;
    taxAmount?: number;
    currency?: string;
  }) => api.post<ApiResponse<Order>>('/orders', data),

  listMine: () => api.get<ApiResponse<Order[]>>('/orders/mine'),

  getMine: (orderId: Id) => api.get<ApiResponse<OrderDetail>>(`/orders/mine/${orderId}`),

  cancelMine: (orderId: Id, reason?: string) =>
    api.post<ApiResponse<Order>>(`/orders/mine/${orderId}/cancel`, { reason }),

  listForBusiness: (businessId: Id, params?: OrderListQuery) =>
    api.get<ApiResponse<Order[]>>(`/business/${businessId}/orders`, { params: staffParams(params) }),

  /**
   * The detail response carries the order and its lines together.
   *
   * The list route returns orders only, so an order line — an item name, a
   * quantity, a unit price — is available on this call and nowhere else.
   */
  getForBusiness: (businessId: Id, orderId: Id) =>
    api.get<ApiResponse<OrderDetail>>(`/business/${businessId}/orders/${orderId}`),

  /** Only the seven settable statuses are accepted by the route's schema. */
  updateStatus: (businessId: Id, orderId: Id, orderStatus: SettableOrderStatus) =>
    api.patch<ApiResponse<Order>>(`/business/${businessId}/orders/${orderId}/status`, { orderStatus }),
};

// Reviews API
export const reviewApi = {
  create: (data: { businessId: number; orderId?: number | null; rating: number; reviewText?: string | null }) =>
    api.post<ApiResponse<BusinessReview>>('/reviews', data),

  listPublic: (params?: ReviewListQuery & { businessId?: number }) =>
    api.get<ApiResponse<BusinessReview[]>>('/reviews', { params }),

  listForBusiness: (businessId: Id, params?: ReviewListQuery) =>
    api.get<ApiResponse<BusinessReview[]>>(`/business/${businessId}/reviews`, { params: staffParams(params) }),

  respond: (businessId: Id, reviewId: Id, response: string) =>
    api.post<ApiResponse<BusinessReview>>(`/business/${businessId}/reviews/${reviewId}/respond`, { response }),

  moderate: (businessId: Id, reviewId: Id, status: 'published' | 'hidden') =>
    api.patch<ApiResponse<BusinessReview>>(`/business/${businessId}/reviews/${reviewId}/moderate`, { status }),
};

// Locations API
export const locationApi = {
  listForBusiness: (businessId: Id) =>
    api.get<ApiResponse<Location[]>>(`/business/${businessId}/locations`),

  create: (businessId: Id, data: CreateLocationInput) =>
    api.post<ApiResponse<Location>>(`/business/${businessId}/locations`, data),

  update: (businessId: Id, locationId: Id, data: Partial<CreateLocationInput>) =>
    api.patch<ApiResponse<Location>>(`/business/${businessId}/locations/${locationId}`, data),

  listPublic: (businessId: Id) =>
    api.get<ApiResponse<Location[]>>(`/businesses/${businessId}/locations`),
};

export default api;