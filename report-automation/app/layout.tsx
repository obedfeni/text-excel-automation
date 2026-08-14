import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'EV Maintenance Automator',
  description: 'Turn a WhatsApp shift report into an editable daily maintenance log.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
