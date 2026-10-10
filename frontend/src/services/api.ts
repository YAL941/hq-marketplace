import axios, { AxiosError, InternalAxiosRequestConfig } from 'axios';
import type {
  AdminBusinessRow,
  AdminBusinessCounts,
  AdminBusinessFilter,
  AdminBusinessNotifications,
  AdminBusinessDecisionResponse,
  ApiResponse,
  AuthMeResponse,
  BusinessMember,
  BusinessProfilePatch,
  BusinessRecord,
  BusinessRegistrationInput,
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
  StaffBusinessProfile,
  VerificationInput,
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
    /**
     * Per-field context. Typed as a loose record rather than a fixed shape
     * because the upload routes report `maxBytes` alongside `field`, which the
     * other schemas do not: a typed union here would mean the file-too-large
     * message cannot name the ceiling the server actually enforced.
     */
    details?: ({ field?: string; reason?: string; maxBytes?: number } & Record<string, unknown>) | string;
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
  /** The ceiling the server enforced, on a FILE_TOO_LARGE upload refusal. */
  maxBytes?: number;
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
      maxBytes:
        details && typeof details === 'object' && typeof details.maxBytes === 'number'
          ? details.maxBytes
          : undefined,
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
   * `businessCategoryId` is a JSON **number** because the route validates it with
   * `z.number()`, even though every category id arrives as a string. Phone and
   * WhatsApp are sent as typed: the route normalises them to E.164 and answers a
   * bad one with 400 and `details.field`, which is what the form needs.
   */
  registerBusiness: (data: BusinessRegistrationInput) =>
    api.post<ApiResponse<BusinessSummary>>('/businesses/register', data),
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

  /**
   * GET /business/:businessId — the business as its own staff sees it.
   *
   * The public profile answers 404 for a business that is still pending or has
   * been rejected, which is exactly the business an owner most needs to read.
   * This one has no visibility predicate: membership is checked by
   * `resolveBusiness`, and RLS returns nothing for anyone else.
   */
  getForBusiness: (businessId: Id) =>
    api.get<ApiResponse<StaffBusinessProfile>>(`/business/${businessId}`),
};

/** Reference data for the public directory. No authentication. */
export const directoryApi = {
  /** GET /categories — includes `business_count` for each category. */
  categories: () => api.get<ApiResponse<PublicCategory[]>>('/categories'),

  /** GET /cities — only cities that have at least one public business. */
  cities: () => api.get<ApiResponse<PublicCity[]>>('/cities'),
};

/** Account-scoped saved businesses; every route requires authentication. */
export const favoriteApi = {
  list: () => api.get<ApiResponse<PublicBusinessCard[]>>('/favorites'),
  save: (businessId: string) => api.put('/favorites/' + encodeURIComponent(businessId)),
  remove: (businessId: string) => api.delete('/favorites/' + encodeURIComponent(businessId)),
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
    scheduledFor?: string | null;
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
export interface ReviewEligibility {
  eligible: boolean;
  order_id: Id | null;
  already_reviewed: boolean;
}

export const reviewApi = {
  eligibility: (businessId: Id) =>
    api.get<ApiResponse<ReviewEligibility>>(`/reviews/eligibility/${businessId}`),

  create: (data: { businessId: number; orderId: number; rating: number; reviewText?: string | null }) =>
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

/**
 * Platform administration.
 *
 * Every call here answers 403 unless the caller holds `platform_admin`, and that
 * is checked twice: once in the middleware before any query runs, and again
 * against the `business.verify` permission for the decision itself. A 403 from
 * this client therefore means the account is not an admin, not that the request
 * was malformed.
 *
 * The list is paged with `page`/`limit` rather than `offset`, because these are
 * the platform routes rather than the business-scoped ones, and the server caps
 * `limit` at 50.
 */
export const adminApi = {
  listBusinesses: (params: { status?: AdminBusinessFilter; search?: string; page?: number; limit?: number }) =>
    api.get<ApiResponse<AdminBusinessRow[]> & { counts: AdminBusinessCounts }>(
      '/admin/businesses',
      { params },
    ),

  getBusinessNotifications: () =>
    api.get<ApiResponse<AdminBusinessNotifications>>('/admin/businesses/notifications'),

  markBusinessNotificationsSeen: () =>
    api.post<ApiResponse<{ success: boolean }>>('/admin/businesses/notifications/mark-seen'),

  setBusinessStatus: (businessId: Id, data: { status: 'active' | 'rejected'; reason?: string }) =>
    api.patch<AdminBusinessDecisionResponse>(`/admin/businesses/${businessId}/status`, data),

  decideVerification: (businessId: Id, data: VerificationInput) =>
    api.patch<AdminBusinessDecisionResponse>(`/admin/businesses/${businessId}/verification`, data),
};

/**
 * Image uploads.
 *
 * The three uploads and their three removals are the only calls in this file
 * that do not send JSON, and the two details below are what make them work.
 *
 * **`Content-Type` is deleted, not set.** The shared axios instance declares
 * `application/json` as a default header. Left in place it would be sent on a
 * FormData request without the multipart boundary the server needs to find the
 * file, and the upload would arrive as one unparseable part. Passing
 * `'multipart/form-data'` explicitly is the more commonly seen fix and it is
 * also wrong here: the value still has no boundary, because only the browser
 * knows where it put one. Removing the header entirely is what lets the browser
 * set it correctly.
 *
 * **The field is named `file`**, which is the single name the API reads. A
 * `FormData` field name is part of the contract, not a label, so it is a
 * constant rather than something derived from `kind`.
 *
 * Each upload answers with the updated row, the same body the matching PATCH
 * returns, so the caller updates its state from the response instead of
 * re-reading. Each removal answers 204 with no body.
 *
 * The verb is PUT, not POST, and not by accident: the route replaces the stored
 * file and the column in one step, so uploading twice for the same slot is one
 * overwrite rather than a second file. That also means the request is not
 * idempotent in the naive sense — it consumes a write-rate token every time —
 * which is the server's choice and is why there is no client-side retry here.
 */
const UPLOAD_FIELD = 'file';

function uploadRequest<T>(url: string, file: File, onUploadProgress?: (percent: number) => void) {
  const form = new FormData();
  form.append(UPLOAD_FIELD, file, file.name);

  return api.put<ApiResponse<T>>(url, form, {
    headers: { 'Content-Type': undefined },
    onUploadProgress: (event) => {
      // `total` is undefined when the browser cannot tell (some mobile
      // browsers, chunked bodies). Reporting 100 optimistically would make the
      // bar jump to the end and back, so the caller is told nothing instead.
      if (!onUploadProgress || !event.total) return;
      onUploadProgress(Math.round((event.loaded / event.total) * 100));
    },
  });
}

export const mediaApi = {
  /** PUT /business/:businessId/logo — `business.edit` required. */
  uploadLogo: (businessId: Id, file: File, onUploadProgress?: (percent: number) => void) =>
    uploadRequest<BusinessRecord>(`/business/${businessId}/logo`, file, onUploadProgress),

  /** PUT /business/:businessId/cover — `business.edit` required. */
  uploadCover: (businessId: Id, file: File, onUploadProgress?: (percent: number) => void) =>
    uploadRequest<BusinessRecord>(`/business/${businessId}/cover`, file, onUploadProgress),

  /** PUT /business/:businessId/products/:productId/image — `products.edit` required. */
  uploadProductImage: (
    businessId: Id,
    productId: Id,
    file: File,
    onUploadProgress?: (percent: number) => void,
  ) => uploadRequest<Product>(`/business/${businessId}/products/${productId}/image`, file, onUploadProgress),

  /** DELETE, 204 with no body. Only removes a file this API produced. */
  removeLogo: (businessId: Id) => api.delete(`/business/${businessId}/logo`),

  removeCover: (businessId: Id) => api.delete(`/business/${businessId}/cover`),

  removeProductImage: (businessId: Id, productId: Id) =>
    api.delete(`/business/${businessId}/products/${productId}/image`),
};

export default api;