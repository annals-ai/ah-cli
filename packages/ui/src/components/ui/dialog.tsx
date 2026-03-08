import * as React from 'react';
import { createPortal } from 'react-dom';
import { XIcon } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { useI18n } from '@/lib/i18n';
import { cn } from '@/lib/utils';

interface DialogContextValue {
  open: boolean;
  onOpenChange(open: boolean): void;
}

const DialogContext = React.createContext<DialogContextValue | null>(null);

function useDialogContext(): DialogContextValue {
  const value = React.useContext(DialogContext);
  if (!value) {
    throw new Error('Dialog components must be used within a Dialog.');
  }
  return value;
}

function Dialog({
  open,
  onOpenChange,
  children,
}: {
  open: boolean;
  onOpenChange(open: boolean): void;
  children: React.ReactNode;
}) {
  return <DialogContext.Provider value={{ open, onOpenChange }}>{children}</DialogContext.Provider>;
}

function DialogTrigger({
  children,
}: {
  children: React.ReactNode;
}) {
  return <>{children}</>;
}

function DialogPortal({ children }: { children: React.ReactNode }) {
  if (typeof document === 'undefined') {
    return null;
  }

  return createPortal(children, document.body);
}

function DialogContent({
  className,
  children,
  showCloseButton = true,
}: React.ComponentProps<'div'> & {
  showCloseButton?: boolean;
}) {
  const { open, onOpenChange } = useDialogContext();
  const { t } = useI18n();

  React.useEffect(() => {
    if (!open) return;

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        onOpenChange(false);
      }
    }

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [open, onOpenChange]);

  if (!open) {
    return null;
  }

  return (
    <DialogPortal>
      <div className="fixed inset-0 z-50 bg-black/50" onClick={() => onOpenChange(false)} />
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
        <div
          role="dialog"
          aria-modal="true"
          className={cn(
            'bg-background relative grid w-full max-w-[calc(100%-2rem)] gap-4 rounded-lg border p-6 shadow-lg outline-none sm:max-w-lg',
            className,
          )}
          onClick={(event) => event.stopPropagation()}
        >
          {children}
          {showCloseButton ? (
            <button
              type="button"
              className="ring-offset-background focus:ring-ring absolute top-4 right-4 rounded-sm opacity-70 transition-opacity hover:opacity-100 focus:ring-2 focus:ring-offset-2 focus:outline-hidden"
              onClick={() => onOpenChange(false)}
            >
              <XIcon className="size-4" />
              <span className="sr-only">{t('common.closeDialog')}</span>
            </button>
          ) : null}
        </div>
      </div>
    </DialogPortal>
  );
}

function DialogHeader({ className, ...props }: React.ComponentProps<'div'>) {
  return <div data-slot="dialog-header" className={cn('flex flex-col gap-2 text-center sm:text-left', className)} {...props} />;
}

function DialogFooter({
  className,
  showCloseButton = false,
  children,
  ...props
}: React.ComponentProps<'div'> & {
  showCloseButton?: boolean;
}) {
  const { onOpenChange } = useDialogContext();
  const { t } = useI18n();

  return (
    <div
      data-slot="dialog-footer"
      className={cn('flex flex-col-reverse gap-2 sm:flex-row sm:justify-end', className)}
      {...props}
    >
      {children}
      {showCloseButton ? (
        <Button variant="outline" onClick={() => onOpenChange(false)}>
          {t('common.close')}
        </Button>
      ) : null}
    </div>
  );
}

function DialogTitle({ className, ...props }: React.ComponentProps<'h2'>) {
  return <h2 data-slot="dialog-title" className={cn('text-lg leading-none font-semibold', className)} {...props} />;
}

function DialogDescription({ className, ...props }: React.ComponentProps<'p'>) {
  return <p data-slot="dialog-description" className={cn('text-muted-foreground text-sm', className)} {...props} />;
}

export { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogPortal, DialogTitle, DialogTrigger };
