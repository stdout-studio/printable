import { LegalShell } from '@/platform/legal/LegalShell';
import { appConfig } from '@/platform/app-config';
import { IS_LOCAL, IS_STUDIO } from '@/platform/mode';

export const metadata = { title: 'Privacy' };

/**
 * Generic privacy notice. Studio-mode operators should review and customize
 * before public launch — the boilerplate covers the common case but
 * lawyer-quality copy depends on the actual data flows of each app.
 */
export default function PrivacyPage() {
  const { legal } = appConfig;
  return (
    <LegalShell title="Privacy">
      <h2>Who runs this instance</h2>
      <p>
        {legal.operator}, contactable at{' '}
        <a
          href={`mailto:${legal.contactEmail}`}
          className="text-[var(--color-accent)] hover:underline"
        >
          {legal.contactEmail}
        </a>
        .
      </p>

      <h2>What we store</h2>
      <ul>
        <li>Your account (email, name, hashed password).</li>
        <li>Your projects + uploaded files, so you can come back to them.</li>
        <li>Your chat transcripts with the agent, used to drive the agent's
          context within the same session.</li>
      </ul>

      <h2>What we send to third parties</h2>
      {IS_LOCAL && (
        <p>
          On this self-hosted instance, prompts and (where relevant) photos
          you upload are sent to Anthropic's Claude API to generate or edit
          the geometry. The operator's API key is used; no data passes
          through stdout.studio. No analytics or telemetry leaves this box
          unless the operator has configured it.
        </p>
      )}
      {IS_STUDIO && (
        <p>
          Prompts and uploaded media are sent to Anthropic's Claude API to
          generate or edit geometry. Aggregated usage analytics (no user
          content) are recorded via PostHog. Payment processing is handled
          by Stripe; we never see your card details.
        </p>
      )}

      <h2>Your rights (GDPR)</h2>
      <ul>
        <li>Access — request a copy of the data we hold about you.</li>
        <li>Correction — fix anything inaccurate.</li>
        <li>Deletion — wipe your account and associated data.</li>
        <li>Portability — get your projects out in a structured format.</li>
        <li>Complaint — file with your local data protection authority.</li>
      </ul>
      <p>
        Send any of the above to{' '}
        <a
          href={`mailto:${legal.contactEmail}`}
          className="text-[var(--color-accent)] hover:underline"
        >
          {legal.contactEmail}
        </a>
        .
      </p>

      <h2>Retention</h2>
      <p>
        Account data is kept until you delete the account. Chat transcripts
        and uploaded files older than 90 days are auto-pruned unless you've
        pinned the project. Auth sessions expire after 30 days of inactivity.
      </p>
    </LegalShell>
  );
}
