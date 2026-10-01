import { Card } from '../common/Card';
import { Badge } from '../common/Badge';
import { MapPin, Phone, Globe } from 'lucide-react';
import type { Location } from '../../types';

interface LocationCardProps {
  location: Location;
  onClick?: () => void;
  showBusiness?: boolean;
  businessName?: string;
}

export function LocationCard({ location, onClick, showBusiness, businessName }: LocationCardProps) {
  return (
    <Card
      padding="md"
      className="flex flex-col"
      hover={!!onClick}
      onClick={onClick}
    >
      <div className="flex items-start gap-3 mb-3">
        <div className="w-12 h-12 rounded-xl bg-primary-100 flex items-center justify-center flex-shrink-0">
          <MapPin className="w-6 h-6 text-primary-600" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <h3 className="font-semibold text-navy-900">{location.location_name}</h3>
            {location.is_primary && (
              <Badge variant="info" size="sm">Main Branch</Badge>
            )}
          </div>
          <Badge
            variant={location.is_active ? 'success' : 'default'}
            size="sm"
          >
            {location.is_active ? 'Active' : 'Inactive'}
          </Badge>
        </div>
      </div>

      <div className="space-y-2 text-sm text-navy-500 mb-3">
        {location.address && (
          <div className="flex items-center gap-2">
            <MapPin className="w-3.5 h-3.5 flex-shrink-0" />
            <span>{location.address}</span>
          </div>
        )}
        {location.city && (
          <div className="flex items-center gap-2">
            <MapPin className="w-3.5 h-3.5 flex-shrink-0" />
            <span>{location.city}{location.district && `, ${location.district}`}</span>
          </div>
        )}
        {location.phone && (
          <div className="flex items-center gap-2">
            <Phone className="w-3.5 h-3.5 flex-shrink-0" />
            <span>{location.phone}</span>
          </div>
        )}
      </div>

      {location.working_hours && Object.keys(location.working_hours).length > 0 && (
        <div className="mt-3 pt-3 border-t border-navy-100">
          <h4 className="text-xs font-medium text-navy-700 uppercase tracking-wide mb-2">Hours</h4>
          <div className="space-y-1 text-sm text-navy-600">
            {Object.entries(location.working_hours).map(([day, hours]) => (
              <div key={day} className="flex justify-between">
                <span className="capitalize text-navy-500">{day}</span>
                <span className="font-medium">{hours.join(', ') || 'Closed'}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="mt-auto pt-3 border-t border-navy-100 flex items-center justify-between">
        {showBusiness && businessName && (
          <span className="text-sm text-navy-500 flex items-center gap-1">
            <Globe className="w-3.5 h-3.5" />
            {businessName}
          </span>
        )}
        <span className="text-xs text-navy-400">
          {location.latitude && location.longitude && (
            <>
              <MapPin className="w-3 h-3 inline me-1" />
              {location.latitude.toFixed(4)}, {location.longitude.toFixed(4)}
            </>
          )}
        </span>
      </div>
    </Card>
  );
}