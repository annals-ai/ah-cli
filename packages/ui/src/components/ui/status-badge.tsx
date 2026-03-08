import { Badge } from '@/components/ui/badge';
import { useI18n } from '@/lib/i18n';
import { cn } from '@/lib/utils';

const STATUS_STYLES: Record<string, string> = {
  active: 'border-emerald-200 bg-emerald-50 text-emerald-700',
  idle: 'border-sky-200 bg-sky-50 text-sky-700',
  queued: 'border-amber-200 bg-amber-50 text-amber-700',
  paused: 'border-zinc-200 bg-zinc-100 text-zinc-700',
  completed: 'border-emerald-200 bg-emerald-50 text-emerald-700',
  failed: 'border-rose-200 bg-rose-50 text-rose-700',
  archived: 'border-zinc-200 bg-zinc-100 text-zinc-600',
  public: 'border-emerald-200 bg-emerald-50 text-emerald-700',
  private: 'border-zinc-200 bg-zinc-100 text-zinc-700',
  unlisted: 'border-amber-200 bg-amber-50 text-amber-700',
  synced: 'border-emerald-200 bg-emerald-50 text-emerald-700',
  pending: 'border-amber-200 bg-amber-50 text-amber-700',
  error: 'border-rose-200 bg-rose-50 text-rose-700',
};

interface StatusBadgeProps {
  value: string;
  className?: string;
}

export function StatusBadge({ value, className }: StatusBadgeProps) {
  const { statusLabel } = useI18n();

  return (
    <Badge
      variant="outline"
      className={cn(
        'rounded-full px-2.5 py-0.5 font-medium capitalize shadow-none',
        STATUS_STYLES[value] ?? 'border-border bg-muted text-muted-foreground',
        className,
      )}
    >
      {statusLabel(value)}
    </Badge>
  );
}
