import type { MetadataRoute } from 'next';

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'Akere HR',
    short_name: 'Akere HR',
    description: 'Кадровый электронный документооборот и учёт рабочего времени',
    start_url: '/ru',
    scope: '/',
    display: 'standalone',
    orientation: 'portrait-primary',
    background_color: '#f5f5f4',
    theme_color: '#0c0a09',
    lang: 'ru',
    categories: ['business', 'productivity'],
    icons: [
      { src: '/icons/icon.svg', sizes: 'any', type: 'image/svg+xml' },
      { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' },
      { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png' },
      { src: '/icons/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
  };
}
