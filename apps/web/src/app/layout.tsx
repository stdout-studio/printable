import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Printable — Parts for things you already own',
  description:
    'AI-designed 3D-printable parts that fit the things you already own. Scan, point, print.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
