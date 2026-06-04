import { redirect } from 'next/navigation';
import { headers } from 'next/headers';
import { auth } from '@/platform/auth';

/**
 * Guards the actual product surface. Unauthenticated requests bounce to /login.
 * In local mode with no users yet, the setup wizard is offered instead.
 */
export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const h = await headers();
  const session = await auth.getSession(h);

  if (!session) {
    const anyUser = await auth.hasAnyUser();
    if (!anyUser) {
      redirect('/setup');
    }
    redirect('/login');
  }

  return <>{children}</>;
}
