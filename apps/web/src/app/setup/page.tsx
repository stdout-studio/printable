import { redirect } from 'next/navigation';
import { auth } from '@/platform/auth';
import { appConfig } from '@/platform/app-config';
import { SetupWizard } from './SetupWizard';

/**
 * First-run setup wizard for self-hosted instances.
 *
 * Active only when no user exists in the local SQLite DB. The moment the
 * first admin lands, this route stops being reachable (redirects to /login).
 */
export default async function SetupPage() {
  const anyUser = await auth.hasAnyUser();
  if (anyUser) {
    redirect('/login');
  }

  // Snapshot env-var presence on the server so the wizard can show a
  // setup checklist without needing API round-trips.
  const envStatus = appConfig.requiredEnvVars.map((env) => ({
    key: env.key,
    label: env.label,
    description: env.description,
    required: env.required,
    helpUrl: env.helpUrl ?? null,
    present: Boolean(process.env[env.key]),
  }));

  return <SetupWizard envStatus={envStatus} />;
}
