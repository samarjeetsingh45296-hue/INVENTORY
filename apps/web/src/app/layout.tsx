import type { Metadata } from 'next';
import { Inter } from 'next/font/google';
import './globals.css';

// Self-hosted by Next at build time - no runtime CDN request, so the strict
// local setup keeps working offline.
const inter = Inter({
  subsets: ['latin'],
  display: 'swap',
  variable: '--font-inter',
});
import { Providers } from './providers';
import { THEME_INIT_SCRIPT } from '@/lib/theme';

export const metadata: Metadata = {
  title: process.env.NEXT_PUBLIC_APP_NAME ?? 'Inventory Suite',
  description:
    'Asset and inventory management. All records are stored permanently in the ' +
    'application database.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        {/* Blocking, so a dark-mode user never sees a white flash on load. */}
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }} />
      </head>
      <body className={`${inter.variable} min-h-screen font-sans antialiased`}>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
