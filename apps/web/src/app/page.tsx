import { LandingShell, Hero, Features, SelfHostGuide } from '@/platform/landing';
import type { FeatureItem } from '@/platform/landing';

/**
 * Printable's landing page. Composes platform's standardized shell with
 * Printable-specific content: tagline (in Hero, sourced from appConfig),
 * feature blocks, and the self-host setup guide (shown only when the
 * top toggle is set to "Self-host").
 */
const features: FeatureItem[] = [
  {
    title: 'Show it what fits',
    description:
      'Snap a photo, sketch the missing piece, or drop in an existing mesh. Printable accepts whichever input you have.',
  },
  {
    title: 'Chat the part into shape',
    description:
      'Describe what you need ("make a 4mm tab here, angled outward 15°") and watch the geometry update live in the viewer.',
  },
  {
    title: 'Print-ready STLs',
    description:
      'Export when you like it. The result is a manifold, oriented STL that goes straight to your slicer or print-shop checkout.',
  },
];

export default function Page() {
  return (
    <LandingShell>
      <Hero />
      <Features items={features} />
      <SelfHostGuide />
    </LandingShell>
  );
}
