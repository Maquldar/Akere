'use client';

import { Toaster as Sonner } from 'sonner';

export { toast } from 'sonner';

export function Toaster() {
  return (
    <Sonner
      position="bottom-right"
      closeButton
      richColors
      toastOptions={{
        classNames: {
          toast: 'font-sans !rounded-lg !border-border !shadow-pop text-[13px]',
        },
      }}
    />
  );
}
