import { formatCurrency } from '../../lib/utils';
import { Card } from '../common/Card';
import { Badge } from '../common/Badge';
import { Tag, User } from 'lucide-react';
import type { Product } from '../../types';

interface ProductCardProps {
  product: Product;
  onClick?: () => void;
  showBusiness?: boolean;
  businessName?: string;
}

export function ProductCard({ product, onClick, showBusiness, businessName }: ProductCardProps) {
  const hasDiscount = product.discount_price && parseFloat(product.discount_price) < parseFloat(product.price);
  const displayPrice = hasDiscount ? product.discount_price ?? product.price : product.price;
  const originalPrice = hasDiscount ? product.price : null;

  return (
    <Card
      padding="none"
      className="overflow-hidden flex flex-col h-full"
      hover={!!onClick}
      onClick={onClick}
    >
      <div className="relative aspect-square bg-navy-100 overflow-hidden">
        {product.image_url ? (
          <img
            src={product.image_url}
            alt={product.product_name}
            className="w-full h-full object-cover transition-transform duration-300 hover:scale-105"
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center bg-gradient-to-br from-primary-100 to-primary-200">
            <Tag className="w-12 h-12 text-primary-400" />
          </div>
        )}
        <div className="absolute top-2 right-2">
          <Badge
            variant={product.status === 'active' ? 'success' : 'default'}
            size="sm"
            className="shadow-soft"
          >
            {product.status}
          </Badge>
        </div>
        {product.stock_quantity !== undefined && product.stock_quantity < 10 && product.stock_quantity > 0 && (
          <div className="absolute bottom-2 left-2">
            <Badge variant="warning" size="sm" className="shadow-soft">
              Only {product.stock_quantity} left
            </Badge>
          </div>
        )}
      </div>

      <div className="p-4 flex flex-col flex-1" style={{ minHeight: 0 }}>
        <h3 className="font-semibold text-navy-900 truncate mb-1">{product.product_name}</h3>

        <div className="flex items-baseline gap-2 mb-2">
          <span className="text-lg font-bold text-navy-900">
            {formatCurrency(displayPrice, product.currency)}
          </span>
          {originalPrice && (
            <span className="text-sm text-navy-400 line-through">
              {formatCurrency(originalPrice, product.currency)}
            </span>
          )}
        </div>

        {product.description && (
          <p className="text-sm text-navy-500 line-clamp-2 mb-3 flex-1">
            {product.description}
          </p>
        )}

        <div className="flex items-center justify-between text-xs text-navy-400 pt-2 border-t border-navy-100">
          {showBusiness && businessName && (
            <span className="flex items-center gap-1">
              <User className="w-3 h-3" />
              {businessName}
            </span>
          )}
          <span className="flex items-center gap-1">
            <Tag className="w-3 h-3" />
            {product.sku || `ID: ${product.product_id}`}
          </span>
        </div>
      </div>
    </Card>
  );
}