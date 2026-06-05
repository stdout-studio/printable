import { redirect } from 'next/navigation';
import { headers } from 'next/headers';
import { auth } from '@/platform/auth';
import { billing } from '@/platform/billing';
import { IS_LOCAL } from '@/platform/mode';
import Link from 'next/link';

export const metadata = { title: 'Billing' };

/**
 * Billing page — only meaningful in hosted mode. In local mode self-hosters
 * don't pay anyone, so this page just explains that.
 */
export default async function BillingPage() {
  const h = await headers();
  const session = await auth.getSession(h);
  if (!session) redirect('/login');

  if (IS_LOCAL) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[var(--color-bg)] text-[var(--color-fg)] px-6">
        <div className="max-w-md text-center">
          <h1 className="text-2xl font-semibold mb-3">Self-hosted</h1>
          <p className="text-[var(--color-fg-dim)] leading-relaxed mb-6">
            You're running your own instance — there's nothing to bill. Your
            costs are whatever you pay to your AI provider directly (e.g.
            Anthropic API usage) plus your own hosting.
          </p>
          <Link
            href="/app"
            className="inline-block rounded-full bg-[var(--color-fg)] text-[var(--color-bg)] px-5 py-2.5 text-sm font-medium"
          >
            Back to app
          </Link>
        </div>
      </div>
    );
  }

  const portalUrl = await billing.customerPortalUrl(session.user.id);

  return (
    <div className="min-h-screen flex items-center justify-center bg-[var(--color-bg)] text-[var(--color-fg)] px-6">
      <div className="max-w-md text-center">
        <h1 className="text-2xl font-semibold mb-3">Billing</h1>
        <p className="text-[var(--color-fg-dim)] leading-relaxed mb-6">
          Manage your subscription and payment method below.
        </p>
        {portalUrl ? (
          <a
            href={portalUrl}
            className="inline-block rounded-full bg-[var(--color-fg)] text-[var(--color-bg)] px-5 py-2.5 text-sm font-medium"
          >
            Open billing portal
          </a>
        ) : (
          <p className="text-sm text-[var(--color-fg-dim)]">
            Billing portal isn't configured yet.
          </p>
        )}
      </div>
    </div>
  );
}
