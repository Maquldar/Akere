import { cn } from '@/lib/utils';

/** Akere HR mark: black rounded square with a white "A". */
export function LogoMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" className={cn('size-7 shrink-0', className)} aria-hidden focusable="false">
      <rect width="32" height="32" rx="8" fill="#0c0a09" />
      <path fillRule="evenodd" d="M14.1 7.5h3.8l5.6 17h-3.6l-1.2-3.8h-5.4l-1.2 3.8H8.5l5.6-17Zm1.9 4.6-1.8 5.8h3.6L16 12.1Z" fill="#fff" />
    </svg>
  );
}

export function Logo({ className, collapsed }: { className?: string; collapsed?: boolean }) {
  return (
    <span className={cn('inline-flex items-center gap-2.5', className)}>
      <LogoMark />
      {!collapsed && <span className="text-[15px] font-semibold tracking-[-0.01em] text-fg">Akere HR</span>}
    </span>
  );
}
