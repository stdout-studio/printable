import type { Metadata } from 'next';
import { Inter, JetBrains_Mono } from 'next/font/google';
import './globals.css';

// Two families only — Inter (sans) for language, JetBrains Mono for the
// instrument voice (dimensions, units, coords, ids, op names). See design-brief.
const sans = Inter({ subsets: ['latin'], variable: '--font-sans', display: 'swap' });
const mono = JetBrains_Mono({ subsets: ['latin'], variable: '--font-mono', display: 'swap' });

export const metadata: Metadata = {
  title: 'Kerf — describe the cut, get the part',
  description:
    'Kerf is an AI multimodal CAD tool — point at it, draw on it, describe it, and get a clean, ready-to-print STL. Self-hostable.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`dark ${sans.variable} ${mono.variable}`}>
      <body>{children}</body>
    </html>
  );
}
