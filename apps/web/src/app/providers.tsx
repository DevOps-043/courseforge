'use client';

import { ThemeProvider } from 'next-themes';

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <ThemeProvider
      attribute="class"
      defaultTheme="system"
      enableSystem={true}
      // RootLayout initializes the theme through next/script. Keep the library's
      // inline bootstrap inert when React mounts the provider on the client.
      scriptProps={{ type: 'application/x-theme-bootstrap' }}
    >
      {children}
    </ThemeProvider>
  );
}
