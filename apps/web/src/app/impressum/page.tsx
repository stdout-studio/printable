import { LegalShell } from '@/platform/legal/LegalShell';
import { appConfig } from '@/platform/app-config';
import { IS_LOCAL } from '@/platform/mode';

export const metadata = { title: 'Impressum' };

/**
 * Impressum — required by §5 DDG (formerly §5 TMG) for any commercially-used
 * site reachable from Germany. On self-hosted instances the operator
 * info is whatever the operator configured in their AppConfig; on the
 * hosted stdout.studio version it carries Operating-UG's data.
 */
export default function ImpressumPage() {
  const { legal } = appConfig;
  return (
    <LegalShell title="Impressum">
      <p>
        Angaben gemäß § 5 DDG für den Betreiber dieser Instanz:
      </p>

      <h2>Operator</h2>
      <p>
        <strong>{legal.operator}</strong>
        <br />
        {legal.address.split('\n').map((line, i) => (
          <span key={i}>
            {line}
            <br />
          </span>
        ))}
      </p>

      <h2>Contact</h2>
      <p>
        Email:{' '}
        <a
          href={`mailto:${legal.contactEmail}`}
          className="text-[var(--color-accent)] hover:underline"
        >
          {legal.contactEmail}
        </a>
      </p>

      {legal.vatId && (
        <>
          <h2>USt-IdNr.</h2>
          <p>{legal.vatId}</p>
        </>
      )}

      {legal.registry && (
        <>
          <h2>Handelsregister</h2>
          <p>{legal.registry}</p>
        </>
      )}

      {IS_LOCAL && (
        <>
          <h2>This is a self-hosted instance</h2>
          <p>
            You are looking at a self-hosted deployment of {appConfig.name}, an
            open-source product. The operator above runs this specific
            instance and is responsible for its content. The underlying
            software is maintained by stdout.studio and licensed under MIT.
          </p>
        </>
      )}
    </LegalShell>
  );
}
