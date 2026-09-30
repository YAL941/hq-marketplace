import { FooterHTMLAttributes, forwardRef } from 'react';
import { cn } from '../lib/utils';
import { Link } from 'react-router-dom';
import { ShoppingBag, Facebook, Twitter, Instagram, Linkedin } from 'lucide-react';

interface FooterProps extends FooterHTMLAttributes<HTMLFooterElement> {}

export const Footer = forwardRef<HTMLFooterElement, FooterProps>(
  ({ className, ...props }, ref) => {
    return (
      <footer
        ref={ref}
        className={cn('bg-navy-900 text-white py-12', className)}
        {...props}
      >
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-8">
            <div className="lg:col-span-2">
              <Link to="/" className="flex items-center gap-2 mb-4" aria-label="HQ Marketplace Home">
                <div className="w-10 h-10 rounded-xl bg-primary-500 flex items-center justify-center">
                  <ShoppingBag className="w-6 h-6 text-white" />
                </div>
                <span className="text-2xl font-bold">HQ Marketplace</span>
              </Link>
              <p className="text-navy-300 max-w-sm mb-6">
                More Than a Marketplace. Discover Businesses. Connect. Grow.
              </p>
              <div className="flex gap-4">
                <a href="#" className="text-navy-400 hover:text-white transition-colors" aria-label="Facebook">
                  <Facebook className="w-5 h-5" />
                </a>
                <a href="#" className="text-navy-400 hover:text-white transition-colors" aria-label="Twitter">
                  <Twitter className="w-5 h-5" />
                </a>
                <a href="#" className="text-navy-400 hover:text-white transition-colors" aria-label="Instagram">
                  <Instagram className="w-5 h-5" />
                </a>
                <a href="#" className="text-navy-400 hover:text-white transition-colors" aria-label="LinkedIn">
                  <Linkedin className="w-5 h-5" />
                </a>
              </div>
            </div>

            <div>
              <h4 className="font-semibold mb-4">Explore</h4>
              <ul className="space-y-2 text-navy-300">
                <li><Link to="/explore" className="hover:text-white transition-colors">All Businesses</Link></li>
                <li><Link to="/categories" className="hover:text-white transition-colors">Categories</Link></li>
                <li><Link to="#" className="hover:text-white transition-colors">Top Rated</Link></li>
                <li><Link to="#" className="hover:text-white transition-colors">New Businesses</Link></li>
              </ul>
            </div>

            <div>
              <h4 className="font-semibold mb-4">Categories</h4>
              <ul className="space-y-2 text-navy-300">
                <li><Link to="/categories/healthcare" className="hover:text-white transition-colors">Healthcare</Link></li>
                <li><Link to="/categories/restaurants" className="hover:text-white transition-colors">Restaurants</Link></li>
                <li><Link to="/categories/hotels" className="hover:text-white transition-colors">Hotels</Link></li>
                <li><Link to="/categories/beauty-wellness" className="hover:text-white transition-colors">Beauty & Wellness</Link></li>
              </ul>
            </div>

            <div>
              <h4 className="font-semibold mb-4">Support</h4>
              <ul className="space-y-2 text-navy-300">
                <li><Link to="#" className="hover:text-white transition-colors">Help Center</Link></li>
                <li><Link to="#" className="hover:text-white transition-colors">Contact Us</Link></li>
                <li><Link to="#" className="hover:text-white transition-colors">FAQ</Link></li>
                <li><Link to="#" className="hover:text-white transition-colors">Safety Guidelines</Link></li>
              </ul>
            </div>
          </div>

          <div className="mt-12 pt-8 border-t border-navy-800 flex flex-col md:flex-row items-center justify-between gap-4">
            <p className="text-navy-400 text-sm">
              © 2024 HQ Marketplace. All rights reserved.
            </p>
            <div className="flex gap-6 text-sm text-navy-400">
              <Link to="#" className="hover:text-white transition-colors">Privacy Policy</Link>
              <Link to="#" className="hover:text-white transition-colors">Terms of Service</Link>
              <Link to="#" className="hover:text-white transition-colors">Cookie Policy</Link>
            </div>
          </div>
        </div>
      </footer>
    );
  }
);

Footer.displayName = 'Footer';