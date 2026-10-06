import { Check } from 'lucide-react';
import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

const css = `
@keyframes akere-pop { 0% { transform: scale(.4); opacity: 0 } 60% { transform: scale(1.08); opacity: 1 } 100% { transform: scale(1) } }
@keyframes akere-ring { 0% { transform: scale(.6); opacity: .55 } 100% { transform: scale(1.6); opacity: 0 } }
@keyframes akere-spark { 0%,100% { transform: scale(.6) rotate(0); opacity: .2 } 50% { transform: scale(1) rotate(25deg); opacity: 1 } }
@media (prefers-reduced-motion: reduce) { .akere-anim { animation: none !important } }
`;

/** Animated "signed" seal (deck p22 success screen), with a title and optional text below. */
export function SuccessBurst({ title, children, className }: { title: ReactNode; children?: ReactNode; className?: string }) {
  return (
    <div className={cn('flex flex-col items-center gap-4 py-6 text-center', className)} role="status" aria-live="polite">
      <style>{css}</style>
      <div className="relative flex size-24 items-center justify-center">
        <span className="akere-anim absolute inset-0 rounded-full bg-green-solid/30" style={{ animation: 'akere-ring 1.2s ease-out 0.2s both' }} />
        <span
          className="akere-anim relative flex size-20 items-center justify-center rounded-[28%] bg-gradient-to-br from-[#3ccf7e] to-green-solid text-white shadow-[0_8px_24px_rgb(23_178_106/0.35)]"
          style={{ animation: 'akere-pop 520ms cubic-bezier(.2,.9,.3,1.3) both' }}
        >
          <Check className="size-10" strokeWidth={3} aria-hidden />
        </span>
        <span className="akere-anim absolute -left-1 top-1 text-xl text-[#fdb022]" style={{ animation: 'akere-spark 1.6s ease-in-out infinite' }} aria-hidden>
          ✦
        </span>
        <span className="akere-anim absolute -right-1 bottom-2 text-base text-[#fdb022]" style={{ animation: 'akere-spark 1.6s ease-in-out .5s infinite' }} aria-hidden>
          ✦
        </span>
      </div>
      <div>
        <p className="text-lg font-semibold text-fg">{title}</p>
        {children && <div className="mt-1 text-sm text-fg-muted">{children}</div>}
      </div>
    </div>
  );
}
