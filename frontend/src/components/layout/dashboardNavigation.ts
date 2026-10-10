import {
  BarChart3, LayoutDashboard, MapPin, Package, Settings, ShoppingBag, Star, Truck, Users,
} from 'lucide-react';

export const dashboardNavigation = [
  { heading: null, items: [{ key: 'sidebar.overview', path: '', icon: LayoutDashboard }] },
  {
    heading: 'sidebar.management',
    items: [
      { key: 'sidebar.products', path: '/products', icon: Package },
      { key: 'sidebar.services', path: '/services', icon: Truck },
      { key: 'sidebar.locations', path: '/locations', icon: MapPin },
    ],
  },
  {
    heading: 'sidebar.operations',
    items: [
      { key: 'sidebar.orders', path: '/orders', icon: ShoppingBag },
      { key: 'sidebar.customers', path: '/customers', icon: Users },
    ],
  },
  { heading: 'sidebar.engagement', items: [{ key: 'sidebar.reviews', path: '/reviews', icon: Star }] },
  { heading: 'sidebar.performance', items: [{ key: 'sidebar.analytics', path: '/analytics', icon: BarChart3 }] },
  {
    heading: 'sidebar.account',
    items: [{ key: 'sidebar.settings', path: '/dashboard/settings', icon: Settings }],
  },
] as const;

export const businessDashboardPath = (businessId: string) => `/dashboard/business/${businessId}`;
