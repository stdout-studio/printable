import { redirect } from 'next/navigation';
import { auth } from '@/platform/auth';
import { publicSignupsAllowed } from '@/platform/auth/policy';
import SignupClient from './SignupClient';

/**
 * Gates the public /signup route. In local mode signups are closed by
 * default — if no user has been created yet, /setup is the route to use;
 * if a user exists and STDOUT_ALLOW_SIGNUPS isn't set, /signup just sends
 * the visitor to /login.
 */
export default async function SignupPage() {
  if (!publicSignupsAllowed()) {
    const anyUser = await auth.hasAnyUser();
    redirect(anyUser ? '/login' : '/setup');
  }
  return <SignupClient />;
}
