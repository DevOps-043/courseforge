import type { Metadata } from 'next';
import { Inter } from 'next/font/google';
import './globals.css';

import { Providers } from './providers';
import { LiaChat } from '@/components/lia/LiaChat';

const inter = Inter({ subsets: ['latin'] });

export const metadata: Metadata = {
  title: 'CourseGen',
  description: 'Plataforma educativa con IA',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="es" suppressHydrationWarning>
      <body className={`${inter.className} bg-gray-50 dark:bg-[#050B14] text-slate-900 dark:text-white transition-colors duration-300`}>
        <Providers>
          {children}
          <LiaChat />
        </Providers>
      </body>
    </html>
  );
}
