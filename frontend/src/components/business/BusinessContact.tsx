import { cn } from '../../lib/utils';
import { Card } from '../common/Card';
import { Badge } from '../common/Badge';
import { MapPin, Calendar, Clock, Phone, Mail, Globe, ExternalLink } from 'lucide-react';
import type { Business } from '../../types';

interface BusinessContactProps {
  business: Business;
}

export function BusinessContact({ business }: BusinessContactProps) {
  const contacts = [
    { label: 'Phone', value: business.phone, icon: Phone, href: business.phone ? `tel:${business.phone}` : undefined },
    { label: 'Email', value: business.email, icon: Mail, href: business.email ? `mailto:${business.email}` : undefined },
    { label: 'Website', value: business.website, icon: Globe, href: business.website, external: true },
    { label: 'Address', value: business.address, icon: MapPin, noHref: true },
    { label: 'City', value: business.city, icon: MapPin, noHref: true },
  ].filter(c => c.value);

  if (contacts.length === 0) return null;

  return (
    <Card>
      <h3 className="text-lg font-semibold text-navy-900 mb-4 flex items-center gap-2">
        <Phone className="w-5 h-5 text-primary-600" />
        Contact Information
      </h3>
      <div className="space-y-3">
        {contacts.map((contact, index) => (
          <div key={index} className="flex items-start gap-3">
            <div className="w-10 h-10 rounded-lg bg-primary-50 flex items-center justify-center flex-shrink-0">
              <contact.icon className="w-5 h-5 text-primary-600" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm text-navy-500">{contact.label}</p>
              {contact.href && !contact.noHref ? (
                <a
                  href={contact.href}
                  target={contact.external ? '_blank' : undefined}
                  rel={contact.external ? 'noopener noreferrer' : undefined}
                  className="text-navy-900 hover:text-primary-600 transition-colors flex items-center gap-1"
                >
                  {contact.value}
                  {contact.external && <ExternalLink className="w-3.5 h-3.5 ml-1" />}
                </a>
              ) : (
                <p className="text-navy-900">{contact.value}</p>
              )}
            </div>
          </div>
        ))}
      </div>
    </Card>
  );
}