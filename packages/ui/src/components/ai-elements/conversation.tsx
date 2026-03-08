import type { ComponentProps, ReactNode } from 'react';
import { ArrowDownIcon } from 'lucide-react';
import { useCallback } from 'react';
import { StickToBottom, useStickToBottomContext } from 'use-stick-to-bottom';

import { Button } from '@/components/ui/button';
import { useI18n } from '@/lib/i18n';
import { cn } from '@/lib/utils';

export type ConversationProps = ComponentProps<typeof StickToBottom>;

export function Conversation({ className, ...props }: ConversationProps) {
  return (
    <StickToBottom
      className={cn('relative flex-1 overflow-y-hidden rounded-xl border bg-muted/15', className)}
      initial="smooth"
      resize="smooth"
      role="log"
      {...props}
    />
  );
}

export type ConversationContentProps = ComponentProps<typeof StickToBottom.Content>;

export function ConversationContent({ className, ...props }: ConversationContentProps) {
  return <StickToBottom.Content className={cn('flex flex-col gap-4 p-4', className)} {...props} />;
}

interface ConversationEmptyStateProps extends ComponentProps<'div'> {
  title?: string;
  description?: string;
  icon?: ReactNode;
}

export function ConversationEmptyState({
  className,
  title,
  description,
  icon,
  children,
  ...props
}: ConversationEmptyStateProps) {
  const { t } = useI18n();

  return (
    <div
      className={cn(
        'flex size-full min-h-80 flex-col items-center justify-center gap-3 p-8 text-center',
        className,
      )}
      {...props}
    >
      {children ?? (
        <>
          {icon ? <div className="text-muted-foreground">{icon}</div> : null}
          <div className="space-y-1">
            <h3 className="text-sm font-medium">{title ?? t('transcript.pickSessionTitle')}</h3>
            <p className="text-muted-foreground text-sm">{description ?? t('transcript.pickSessionDescription')}</p>
          </div>
        </>
      )}
    </div>
  );
}

export type ConversationScrollButtonProps = ComponentProps<typeof Button>;

export function ConversationScrollButton({ className, ...props }: ConversationScrollButtonProps) {
  const { isAtBottom, scrollToBottom } = useStickToBottomContext();
  const { t } = useI18n();

  const handleScrollToBottom = useCallback(() => {
    scrollToBottom();
  }, [scrollToBottom]);

  if (isAtBottom) {
    return null;
  }

  return (
    <Button
      type="button"
      variant="outline"
      size="icon"
      className={cn('absolute bottom-4 left-1/2 -translate-x-1/2 rounded-full shadow-sm', className)}
      onClick={handleScrollToBottom}
      {...props}
    >
      <ArrowDownIcon className="size-4" />
      <span className="sr-only">{t('transcript.scrollToBottom')}</span>
    </Button>
  );
}
