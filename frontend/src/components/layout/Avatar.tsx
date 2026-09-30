import { cn } from '../../lib/utils';

interface AvatarProps {
  name: string;
  size?: 'sm' | 'md' | 'lg' | 'xl';
  src?: string;
  className?: string;
}

const sizes = {
  sm: 'w-7 h-7 text-xs',
  md: 'w-9 h-9 text-sm',
  lg: 'w-12 h-12 text-base',
  xl: 'w-16 h-16 text-lg',
};

export function Avatar({ name, size = 'md', src, className }: AvatarProps) {
  const initials = name
    .split(' ')
    .map(n => n[0])
    .join('')
    .toUpperCase()
    .slice(0, 2);

  if (src) {
    return (
      <img
        src={src}
        alt={name}
        className={cn(sizes[size], 'rounded-full object-cover', className)}
      />
    );
  }

  return (
    <div className={cn(sizes[size], 'rounded-full bg-primary-100 text-primary-700 flex items-center justify-center font-semibold', className)}>
      {initials}
    </div>
  );
}