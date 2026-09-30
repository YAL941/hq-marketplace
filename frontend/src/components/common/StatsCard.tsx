import { cn, formatCurrency } from '../../lib/utils';
import { Card } from '../common/Card';
import { TrendingUp, TrendingDown } from 'lucide-react';

interface StatsCardProps {
  label: string;
  value: string | number;
  trend?: string;
  trendUp?: boolean;
  icon: React.ReactNode;
  color: string;
  className?: string;
}

export function StatsCard({ label, value, trend, trendUp = true, icon, color, className }: StatsCardProps) {
  return (
    <Card className={cn('p-5', className)}>
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm text-navy-500">{label}</p>
          <p className="text-2xl font-bold text-navy-900 mt-1">{value}</p>
        </div>
        <div className={cn('w-12 h-12 rounded-xl flex items-center justify-center', color)}>
          {icon}
        </div>
      </div>
      {trend && (
        <div className="mt-2 flex items-center gap-1">
          {trendUp ? <TrendingUp className="w-3 h-3 text-success-600" /> : <TrendingDown className="w-3 h-3 text-error-600" />}
          <span className={cn('text-xs font-medium', trendUp ? 'text-success-600' : 'text-error-600')}>
            {trend} vs last period
          </span>
        </div>
      )}
    </Card>
  );
}