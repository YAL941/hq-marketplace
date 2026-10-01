import { formatCurrency } from '../../lib/utils';
import { Card } from '../common/Card';
import { Badge } from '../common/Badge';
import { Clock, User, Calendar } from 'lucide-react';
import type { Service } from '../../types';

interface ServiceCardProps {
  service: Service;
  onClick?: () => void;
  showBusiness?: boolean;
  businessName?: string;
}

export function ServiceCard({ service, onClick, showBusiness, businessName }: ServiceCardProps) {
  return (
    <Card
      padding="md"
      className="flex flex-col"
      hover={!!onClick}
      onClick={onClick}
    >
      <div className="flex items-start gap-3 mb-3">
        <div className="w-12 h-12 rounded-xl bg-primary-100 flex items-center justify-center flex-shrink-0">
          <Calendar className="w-6 h-6 text-primary-600" />
        </div>
        <div className="flex-1 min-w-0">
          <h3 className="font-semibold text-navy-900">{service.service_name}</h3>
          <p className="text-sm text-primary-600 font-medium">
            {formatCurrency(service.price, service.currency)}
            {service.duration_minutes && ` · ${service.duration_minutes} min`}
          </p>
        </div>
      </div>

      {service.description && (
        <p className="text-sm text-navy-500 line-clamp-2 mb-3 flex-1">
          {service.description}
        </p>
      )}

      <div className="flex flex-wrap items-center gap-3 text-sm text-navy-500 mb-3">
        {service.duration_minutes && (
          <span className="flex items-center gap-1">
            <Clock className="w-3.5 h-3.5" />
            {service.duration_minutes} min
          </span>
        )}
        {service.capacity && (
          <span className="flex items-center gap-1">
            <User className="w-3.5 h-3.5" />
            Up to {service.capacity}
          </span>
        )}
        {service.is_bookable && (
          <Badge variant="success" size="sm">Bookable</Badge>
        )}
      </div>

      <div className="flex items-center justify-between pt-3 border-t border-navy-100">
        {showBusiness && businessName && (
          <span className="text-sm text-navy-500 flex items-center gap-1">
            <User className="w-3.5 h-3.5" />
            {businessName}
          </span>
        )}
        <span className="text-sm font-medium text-navy-700">
          {formatCurrency(service.price, service.currency)}
        </span>
      </div>
    </Card>
  );
}