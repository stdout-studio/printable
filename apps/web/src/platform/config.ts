/**
 * Per-app configuration. Every stdout.studio app exports one of these
 * via `stdout.config.ts` at its repo root (or under apps/web/src/).
 *
 * The config is consumed by the landing page, legal pages, setup wizard,
 * auth UI, billing, and any other platform-provided surface. Per-app
 * branding + identity + required env vars all live here.
 */

export interface AppConfig {
  /** Stable slug, e.g. "printable". Used for DB schemas, subdomains, tags. */
  slug: string;

  /** Display name, e.g. "Printable". */
  name: string;

  /** One-line tagline shown in the landing hero. */
  tagline: string;

  /** Longer description for meta tags and the landing page secondary copy. */
  description: string;

  /** GitHub repo URL for the self-host banner. */
  githubUrl: string;

  /** Docker pull command shown in the self-host view (one-liner setup). */
  selfHostCommand: string;

  /** Required environment variables the user must provide. Used by the
   *  setup wizard to prompt + validate. */
  requiredEnvVars: RequiredEnvVar[];

  /** Optional: per-app brand color tokens. Falls back to defaults if omitted. */
  brand?: BrandTokens;

  /** Legal / operator info shown on Impressum / Privacy / Terms pages. */
  legal: LegalConfig;

  /** Optional: this app supports an unauthenticated "try it" mode. */
  guestModeEnabled?: boolean;
}

export interface RequiredEnvVar {
  key: string;
  label: string;
  description: string;
  /** Whether this key must be present for the app to function at all. */
  required: boolean;
  /** Where the user can get this key (e.g. URL to provider's signup). */
  helpUrl?: string;
  /** Optional: regex the value must match. */
  validate?: string;
}

export interface BrandTokens {
  /** Primary accent color, hex. */
  primary?: string;
  /** Optional logo SVG URL or inline SVG. */
  logo?: string;
}

export interface LegalConfig {
  /** Operator legal entity, e.g. "Michalke UG (haftungsbeschränkt)". */
  operator: string;
  /** Operator address (multi-line OK, used verbatim in Impressum). */
  address: string;
  /** Contact email for legal matters. */
  contactEmail: string;
  /** Optional: USt-IdNr (German VAT ID). */
  vatId?: string;
  /** Optional: Handelsregister entry (e.g. "HRB 12345, Amtsgericht München"). */
  registry?: string;
}
