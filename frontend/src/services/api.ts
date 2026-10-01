import axios, { AxiosError, InternalAxiosRequestConfig } from 'axios';
import type { ApiResponse, LoginResponse } from '../types';

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

// Public Business API
export const businessApi = {
  // `category` takes the slug a public URL carries; `categoryId` stays for
  // callers that already hold a numeric id. Sending both is the server's call.
  list: (params?: {
    category?: string;
    categoryId?: number;
    city?: string;
    q?: string;
    verifiedOnly?: boolean;
    page?: number;
    limit?: number;
  }) => api.get<ApiResponse<any[]>>('/businesses', { params }),

  get: (businessId: number) =>
    api.get<ApiResponse<any>>(`/businesses/${businessId}`),

  getStatistics: (businessId: number) =>
    api.get<ApiResponse<any>>(`/business/${businessId}/statistics`),

  getMembers: (businessId: number) =>
    api.get<ApiResponse<any[]>>(`/business/${businessId}/members`),

  addMember: (businessId: number, data: { userId: number; roleKey: string }) =>
    api.post<ApiResponse<any>>(`/business/${businessId}/members`, data),

  update: (businessId: number, data: Record<string, any>) =>
    api.patch<ApiResponse<any>>(`/business/${businessId}`, data),
};

// Public directory reference data
export const directoryApi = {
  categories: () =>
    api.get<ApiResponse<any[]>>('/categories'),

  cities: () =>
    api.get<ApiResponse<any[]>>('/cities'),

  reviews: (businessId: number, params?: { page?: number; limit?: number }) =>
    api.get<ApiResponse<any[]>>(`/businesses/${businessId}/reviews`, { params }),
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