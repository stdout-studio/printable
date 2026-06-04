import { LegalShell } from '@/platform/legal/LegalShell';
import { appConfig } from '@/platform/app-config';

export const metadata = { title: 'Terms' };

/**
 * Plain-language terms. Self-host operators should review for their
 * jurisdiction before publicly hosting.
 */
export default function TermsPage() {
  return (
    <LegalShell title="Terms">
      <h2>What you can do</h2>
      <p>
        Use {appConfig.name} to design and export 3D-printable parts for any
        lawful purpose. The software is MIT-licensed, so you can also fork it,
        modify it, and run your own copy.
      </p>

      <h2>What you can't do</h2>
      <ul>
        <li>Use it for anything that violates applicable law.</li>
        <li>Attempt to break, reverse, or overload the service.</li>
        <li>Resell access to this specific instance without permission.</li>
      </ul>

      <h2>Your stuff stays your stuff</h2>
      <p>
        You own the designs you create with {appConfig.name}. The operator
        does not claim any rights to your prompts, uploaded files, or
        generated geometry. Bear in mind that AI-generated outputs can be
        similar to those produced for other users — don't rely on them being
        unique unless you've materially edited them.
      </p>

      <h2>No warranty</h2>
      <p>
        {appConfig.name} is provided as-is. AI-generated geometry can fail
        in surprising ways. Always inspect the result before sending it to
        a printer and exercise sensible judgment for any part where the
        consequences of failure matter.
      </p>

      <h2>Changes</h2>
      <p>
        The operator may update these terms. Significant changes will be
        announced through the same email address you signed up with.
      </p>
    </LegalShell>
  );
}
