import axios, { AxiosError, InternalAxiosRequestConfig } from 'axios';
import type {
  ApiResponse,
  Location,
  LoginResponse,
  PublicBusinessCard,
  PublicBusinessProfile,
  PublicCategory,
  PublicCity,
  PublicDirectoryQuery,
  PublicReview,
} from '../types';

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
    if (error.response?.status === 401) {
      setAuthToken(null);
      if (typeof window !== 'undefined') {
        window.location.href = '/login';
      }
    }
    return Promise.reject(error);
  }
);

// Auth API
export const authApi = {
  register: (data: { email: string; password: string; fullName: string; phone?: string }) =>
    api.post<ApiResponse<LoginResponse>>('/auth/register', data),

  login: (data: { email: string; password: string }) =>
    api.post<ApiResponse<LoginResponse>>('/auth/login', data),

  me: () =>
    api.get<ApiResponse<{ user: any; platformRoles: any[]; businesses: any[] }>>('/auth/me'),

  registerBusiness: (data: {
    businessName: string;
    businessCategoryId?: number;
    description?: string;
    phone?: string;
    email?: string;
    address?: string;
    city?: string;
    district?: string;
  }) => api.post<ApiResponse<any>>('/businesses/register', data),
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

  getStatistics: (businessId: number) =>
    api.get<ApiResponse<any>>(`/business/${businessId}/statistics`),

  getMembers: (businessId: number) =>
    api.get<ApiResponse<any[]>>(`/business/${businessId}/members`),

  addMember: (businessId: number, data: { userId: number; roleKey: string }) =>
    api.post<ApiResponse<any>>(`/business/${businessId}/members`, data),

  update: (businessId: number, data: Record<string, any>) =>
    api.patch<ApiResponse<any>>(`/business/${businessId}`, data),
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
  listPublic: (params?: {
    status?: string;
    categoryId?: number;
    search?: string;
    limit?: number;
    offset?: number;
  }) => api.get<ApiResponse<any[]>>('/products', { params }),

  listForBusiness: (businessId: number, params?: {
    status?: string;
    categoryId?: number;
    search?: string;
    limit?: number;
    offset?: number;
  }) => api.get<ApiResponse<any[]>>(`/business/${businessId}/products`, { params }),

  getForBusiness: (businessId: number, productId: number) =>
    api.get<ApiResponse<any>>(`/business/${businessId}/products/${productId}`),

  create: (businessId: number, data: any) =>
    api.post<ApiResponse<any>>(`/business/${businessId}/products`, data),

  update: (businessId: number, productId: number, data: any) =>
    api.patch<ApiResponse<any>>(`/business/${businessId}/products/${productId}`, data),

  delete: (businessId: number, productId: number) =>
    api.delete(`/business/${businessId}/products/${productId}`),
};

// Services API
export const serviceApi = {
  listPublic: (params?: {
    status?: string;
    serviceCategoryId?: number;
    search?: string;
    limit?: number;
    offset?: number;
  }) => api.get<ApiResponse<any[]>>('/services', { params }),

  listForBusiness: (businessId: number, params?: {
    status?: string;
    serviceCategoryId?: number;
    search?: string;
    limit?: number;
    offset?: number;
  }) => api.get<ApiResponse<any[]>>(`/business/${businessId}/services`, { params }),

  getForBusiness: (businessId: number, serviceId: number) =>
    api.get<ApiResponse<any>>(`/business/${businessId}/services/${serviceId}`),

  create: (businessId: number, data: any) =>
    api.post<ApiResponse<any>>(`/business/${businessId}/services`, data),

  update: (businessId: number, serviceId: number, data: any) =>
    api.patch<ApiResponse<any>>(`/business/${businessId}/services/${serviceId}`, data),
};

// Orders API
export const orderApi = {
  create: (data: any) =>
    api.post<ApiResponse<any>>('/orders', data),

  listMine: () =>
    api.get<ApiResponse<any[]>>('/orders/mine'),

  getMine: (orderId: number) =>
    api.get<ApiResponse<any>>(`/orders/mine/${orderId}`),

  cancelMine: (orderId: number, reason?: string) =>
    api.post<ApiResponse<any>>(`/orders/mine/${orderId}/cancel`, { reason }),

  listForBusiness: (businessId: number, params?: {
    orderStatus?: string;
    customerId?: number;
    limit?: number;
    offset?: number;
  }) => api.get<ApiResponse<any[]>>(`/business/${businessId}/orders`, { params }),

  getForBusiness: (businessId: number, orderId: number) =>
    api.get<ApiResponse<any>>(`/business/${businessId}/orders/${orderId}`),

  updateStatus: (businessId: number, orderId: number, orderStatus: string) =>
    api.patch<ApiResponse<any>>(`/business/${businessId}/orders/${orderId}/status`, { orderStatus }),
};

// Reviews API
export const reviewApi = {
  create: (data: any) =>
    api.post<ApiResponse<any>>('/reviews', data),

  listPublic: (params?: {
    status?: string;
    minRating?: number;
    businessId?: number;
    limit?: number;
    offset?: number;
  }) => api.get<ApiResponse<any[]>>('/reviews', { params }),

  listForBusiness: (businessId: number, params?: {
    status?: string;
    minRating?: number;
    limit?: number;
    offset?: number;
  }) => api.get<ApiResponse<any[]>>(`/business/${businessId}/reviews`, { params }),

  respond: (businessId: number, reviewId: number, response: string) =>
    api.post<ApiResponse<any>>(`/business/${businessId}/reviews/${reviewId}/respond`, { response }),

  moderate: (businessId: number, reviewId: number, status: 'published' | 'hidden') =>
    api.patch<ApiResponse<any>>(`/business/${businessId}/reviews/${reviewId}/moderate`, { status }),
};

// Locations API
export const locationApi = {
  listForBusiness: (businessId: number) =>
    api.get<ApiResponse<any[]>>(`/business/${businessId}/locations`),

  create: (businessId: number, data: any) =>
    api.post<ApiResponse<any>>(`/business/${businessId}/locations`, data),

  update: (businessId: number, locationId: number, data: any) =>
    api.patch<ApiResponse<any>>(`/business/${businessId}/locations/${locationId}`, data),

  listPublic: (businessId: number) =>
    api.get<ApiResponse<any[]>>(`/businesses/${businessId}/locations`),
};

export default api;