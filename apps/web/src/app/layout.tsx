import type { Metadata } from 'next';
import Script from 'next/script';
import { THEME_BOOTSTRAP_SCRIPT } from './theme-bootstrap';
import './globals.css';

import { Providers } from './providers';
import { ibmPlexSans, interTight, newsreader } from './root-fonts';

export const metadata: Metadata = {
  title: 'SofLIA - Engine',
  description: 'Plataforma educativa con IA',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="es" suppressHydrationWarning>
      <head>
        <Script id="theme-bootstrap" strategy="beforeInteractive">{THEME_BOOTSTRAP_SCRIPT}</Script>
      </head>
      <body className={`${newsreader.variable} ${interTight.variable} ${ibmPlexSans.variable}`}>
        <Providers>
          {children}
        </Providers>
      </body>
    </html>
  );
}
