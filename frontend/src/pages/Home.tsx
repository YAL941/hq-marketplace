import { Link } from 'react-router-dom';
import { ShoppingBag, MapPin, Search, Star, Truck, Heart, Shield, ArrowRight, Building2, Store, Utensils, Hotel, HeartPulse, Sparkles, Calendar } from 'lucide-react';
import { BusinessCard } from '../components/business/BusinessCard';
import { CategoryCard } from '../components/business/CategoryCard';
import { Button } from '../components/common/Button';
import { SearchBar } from '../components/common/SearchBar';
import { Badge } from '../components/common/Badge';
import { BusinessCardSkeleton, CategoryCardSkeleton } from '../components/common/Skeleton';
import { useState, useEffect } from 'react';
import { businessApi } from '../services/api';
import type { Business, BusinessCategory } from '../types';
import { cn } from '../lib/utils';

const featuredCategories = [
  { name: 'Healthcare', slug: 'healthcare', icon: HeartPulse, color: 'bg-red-100 text-red-600' },
  { name: 'Restaurants', slug: 'restaurants', icon: Utensils, color: 'bg-orange-100 text-orange-600' },
  { name: 'Hotels', slug: 'hotels', icon: Hotel, color: 'bg-blue-100 text-blue-600' },
  { name: 'Beauty & Wellness', slug: 'beauty-wellness', icon: Sparkles, color: 'bg-pink-100 text-pink-600' },
  { name: 'Shopping', slug: 'grocery-retail', icon: Store, color: 'bg-green-100 text-green-600' },
  { name: 'Events', slug: 'events-venues', icon: Calendar, color: 'bg-purple-100 text-purple-600' },
];

export function HomePage() {
  const [businesses, setBusinesses] = useState<Business[]>([]);
  const [categories, setCategories] = useState<BusinessCategory[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCity, setSelectedCity] = useState('Mogadishu');

  useEffect(() => {
    const fetchData = async () => {
      try {
        const [bizRes, catRes] = await Promise.all([
          businessApi.list({ limit: 8, verifiedOnly: true }),
          businessApi.list({ limit: 100 }), // to get categories from businesses
        ]);
        setBusinesses(bizRes.data.data);
        // Extract unique categories from businesses
        const uniqueCats = new Map();
        catRes.data.data.forEach((b: any) => {
          if (b.category_name && !uniqueCats.has(b.business_category_id)) {
            uniqueCats.set(b.business_category_id, {
              category_id: b.business_category_id,
              category_name: b.category_name,
              category_slug: b.category_name.toLowerCase().replace(/\s+/g, '-'),
              business_count: 0,
            });
          }
          if (b.category_name) {
            const cat = uniqueCats.get(b.business_category_id);
            if (cat) cat.business_count++;
          }
        });
        setCategories(Array.from(uniqueCats.values()));
      } catch (error) {
        console.error('Failed to fetch homepage data:', error);
      } finally {
        setLoading(false);
      }
    };
    fetchData();
  }, []);

  const handleSearch = (query: string) => {
    if (query.trim()) {
      // Navigate to explore with search
      window.location.href = `/explore?search=${encodeURIComponent(query)}&city=${encodeURIComponent(selectedCity)}`;
    }
  };

  return (
    <div className="min-h-screen bg-navy-50">
      {/* Hero Section */}
      <section className="relative bg-gradient-to-br from-navy-900 via-navy-800 to-navy-900 text-white overflow-hidden">
        <div className="absolute inset-0 hero-dots" />
        <div className="relative max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-20 sm:py-28">
          <div className="max-w-3xl">
            <Badge variant="info" className="mb-4 text-sm">Available in Somalia</Badge>
            <h1 className="text-4xl sm:text-5xl lg:text-6xl font-bold leading-tight mb-6">
              Discover the Best Businesses in Somalia
            </h1>
            <p className="text-lg sm:text-xl text-navy-200 mb-8 max-w-2xl">
              Find trusted businesses, services, products and local experiences in one place.
            </p>
            <div className="flex flex-col sm:flex-row gap-4 max-w-xl">
              <SearchBar
                value={searchQuery}
                onChange={setSearchQuery}
                onSearch={handleSearch}
                placeholder="Search businesses, services, products..."
                className="flex-1"
              />
              <select
                value={selectedCity}
                onChange={(e) => setSelectedCity(e.target.value)}
                className="px-4 py-3 bg-white/10 text-white border border-white/20 rounded-button focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent transition-colors min-w-[180px]"
              >
                <option value="Mogadishu">Mogadishu</option>
                <option value="Hargeisa">Hargeisa</option>
                <option value="Bosaso">Bosaso</option>
                <option value="Kismayo">Kismayo</option>
                <option value="Marka">Marka</option>
              </select>
            </div>
          </div>
        </div>
        <div className="absolute bottom-0 left-0 right-0 h-16 bg-gradient-to-t from-navy-50 to-transparent" />
      </section>

      {/* Stats Bar */}
      <section className="bg-white border-b border-navy-200 py-8">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-8 text-center">
            <div>
              <div className="text-3xl font-bold text-navy-900">500+</div>
              <div className="text-navy-500 text-sm">Businesses</div>
            </div>
            <div>
              <div className="text-3xl font-bold text-navy-900">50+</div>
              <div className="text-navy-500 text-sm">Categories</div>
            </div>
            <div>
              <div className="text-3xl font-bold text-navy-900">10K+</div>
              <div className="text-navy-500 text-sm">Reviews</div>
            </div>
            <div>
              <div className="text-3xl font-bold text-navy-900">12</div>
              <div className="text-navy-500 text-sm">Cities</div>
            </div>
          </div>
        </div>
      </section>

      {/* Categories */}
      <section className="py-16 bg-navy-50">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between mb-8">
            <div>
              <h2 className="text-2xl font-bold text-navy-900">Browse by Category</h2>
              <p className="text-navy-500 mt-1">Find what you're looking for</p>
            </div>
            <Link to="/categories" className="text-primary-600 hover:text-primary-700 font-medium flex items-center gap-1">
              View All <ArrowRight className="w-4 h-4" />
            </Link>
          </div>

          {loading ? (
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-4">
              {[...Array(6)].map((_, i) => <CategoryCardSkeleton key={i} />)}
            </div>
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-4">
              {featuredCategories.map((cat) => {
                const matchedCategory = categories.find(c => c.category_slug === cat.slug);
                return (
                  <CategoryCard
                    key={cat.slug}
                    category={{
                      category_id: matchedCategory?.category_id || 0,
                      category_name: cat.name,
                      category_slug: cat.slug,
                      business_count: matchedCategory?.business_count || 0,
                    }}
                    onClick={() => window.location.href = `/categories/${cat.slug}`}
                    businessCount={matchedCategory?.business_count}
                  />
                );
              })}
            </div>
          )}
        </div>
      </section>

      {/* Featured Businesses */}
      <section className="py-16 bg-white">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between mb-8">
            <div>
              <h2 className="text-2xl font-bold text-navy-900">Featured Businesses</h2>
              <p className="text-navy-500 mt-1">Top rated and verified businesses</p>
            </div>
            <Link to="/explore" className="text-primary-600 hover:text-primary-700 font-medium flex items-center gap-1">
              View All <ArrowRight className="w-4 h-4" />
            </Link>
          </div>

          {loading ? (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
              {[...Array(4)].map((_, i) => <BusinessCardSkeleton key={i} />)}
            </div>
          ) : businesses.length > 0 ? (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
              {businesses.map((business) => (
                <BusinessCard
                  key={business.business_id}
                  business={business}
                  onClick={() => window.location.href = `/business/${business.business_id}`}
                />
              ))}
            </div>
          ) : (
            <div className="text-center py-12 text-navy-500">
              No businesses found
            </div>
          )}
        </div>
      </section>

      {/* Why Choose HQ Marketplace */}
      <section className="py-16 bg-navy-50">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-12">
            <h2 className="text-2xl font-bold text-navy-900">Why Choose HQ Marketplace?</h2>
            <p className="text-navy-500 mt-2">The trusted platform for discovering and connecting with local businesses</p>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
            {[
              { icon: Shield, title: 'Verified Businesses', desc: 'All businesses are verified for authenticity and quality' },
              { icon: Star, title: 'Real Reviews', desc: 'Authentic reviews from real customers help you decide' },
              { icon: Truck, title: 'Easy Booking', desc: 'Book appointments and order products seamlessly' },
              { icon: Heart, title: 'Local Focus', desc: 'Supporting local businesses in your community' },
              { icon: Building2, title: 'Business Tools', desc: 'Powerful dashboard for business owners to grow' },
              { icon: MapPin, title: 'Location Based', desc: 'Find businesses near you with accurate locations' },
            ].map((item, i) => (
              <Card key={i} padding="lg" className="text-center">
                <div className="w-14 h-14 rounded-xl bg-primary-100 flex items-center justify-center mx-auto mb-4 text-primary-600">
                  <item.icon className="w-7 h-7" />
                </div>
                <h3 className="text-lg font-semibold text-navy-900 mb-2">{item.title}</h3>
                <p className="text-navy-500">{item.desc}</p>
              </Card>
            ))}
          </div>
        </div>
      </section>

      {/* CTA Section */}
      <section className="py-16 bg-navy-900 text-white">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
          <h2 className="text-3xl font-bold mb-4">Ready to Grow Your Business?</h2>
          <p className="text-navy-200 mb-8 max-w-2xl mx-auto">
            Join thousands of businesses on HQ Marketplace. Get discovered by new customers and manage your business with powerful tools.
          </p>
          <div className="flex flex-col sm:flex-row gap-4 justify-center">
            <Link to="/register">
              <Button size="lg" className="w-full sm:w-auto bg-white text-navy-900 hover:bg-navy-100">
                Register Your Business
              </Button>
            </Link>
            <Link to="/explore">
              <Button variant="outline" size="lg" className="w-full sm:w-auto border-white text-white hover:bg-white/10">
                Explore Marketplace
              </Button>
            </Link>
          </div>
        </div>
      </section>
    </div>
  );
}