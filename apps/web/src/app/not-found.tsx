import '@/styles/globals.css';

// Requests outside any locale (rare: the middleware adds one). Plain fallback page.
export default function GlobalNotFound() {
  return (
    <html lang="ru">
      <body className="flex min-h-dvh items-center justify-center bg-canvas p-6 font-sans">
        <div className="text-center">
          <p className="text-5xl font-semibold text-fg">404</p>
          <p className="mt-2 text-sm text-fg-muted">Страница не найдена · Page not found</p>
          <a href="/ru" className="mt-4 inline-block text-sm font-medium text-primary hover:underline">
            Akere HR
          </a>
        </div>
      </body>
    </html>
  );
}
