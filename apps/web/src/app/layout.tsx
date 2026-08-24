import type { Metadata } from 'next';
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
      <body className={`${newsreader.variable} ${interTight.variable} ${ibmPlexSans.variable}`}>
        <Providers>
          {children}
        </Providers>
      </body>
    </html>
  );
}
