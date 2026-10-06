'use client';

import ReactMarkdown, { type Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Link } from '@/i18n/navigation';

/**
 * Safe markdown for help articles: react-markdown never renders raw HTML (it is escaped/dropped by default),
 * and link/image URLs are filtered by its default urlTransform (no javascript: URLs).
 */
const components: Components = {
  h1: ({ children }) => <h2 className="mb-3 mt-6 text-xl font-semibold text-fg first:mt-0">{children}</h2>,
  h2: ({ children }) => <h2 className="mb-2 mt-6 text-lg font-semibold text-fg first:mt-0">{children}</h2>,
  h3: ({ children }) => <h3 className="mb-2 mt-5 text-base font-semibold text-fg">{children}</h3>,
  p: ({ children }) => <p className="my-3 leading-relaxed text-fg">{children}</p>,
  ul: ({ children }) => <ul className="my-3 list-disc space-y-1.5 pl-5">{children}</ul>,
  ol: ({ children }) => <ol className="my-3 list-decimal space-y-1.5 pl-5">{children}</ol>,
  li: ({ children }) => <li className="leading-relaxed">{children}</li>,
  strong: ({ children }) => <strong className="font-semibold text-fg">{children}</strong>,
  blockquote: ({ children }) => <blockquote className="my-4 border-l-2 border-primary/40 bg-primary-soft/50 px-4 py-2 text-fg-muted">{children}</blockquote>,
  code: ({ children }) => <code className="rounded bg-surface-hover px-1 py-0.5 font-mono text-[0.85em]">{children}</code>,
  pre: ({ children }) => <pre className="my-4 overflow-x-auto rounded-lg bg-surface-hover p-3 text-[13px]">{children}</pre>,
  hr: () => <hr className="my-6 border-border" />,
  table: ({ children }) => (
    <div className="my-4 overflow-x-auto">
      <table className="w-full border-collapse text-left text-[13px]">{children}</table>
    </div>
  ),
  th: ({ children }) => <th className="border-b border-border px-2 py-1.5 font-semibold">{children}</th>,
  td: ({ children }) => <td className="border-b border-border px-2 py-1.5">{children}</td>,
  a: ({ href, children }) => {
    if (href && href.startsWith('/') && !href.startsWith('//')) {
      return (
        <Link href={href} className="focus-ring rounded font-medium text-primary hover:underline">
          {children}
        </Link>
      );
    }
    return (
      <a href={href} target="_blank" rel="noopener noreferrer nofollow" className="focus-ring rounded font-medium text-primary hover:underline">
        {children}
      </a>
    );
  },
  img: () => null,
};

export function Markdown({ children }: { children: string }) {
  return (
    <div className="text-[15px]">
      <ReactMarkdown components={components} remarkPlugins={[remarkGfm]} skipHtml>
        {children}
      </ReactMarkdown>
    </div>
  );
}
