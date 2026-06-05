/**
 * Billing provider.
 *
 * - Local mode: a no-op. Self-hosters don't pay stdout.studio anything; every
 *   user is effectively "subscribed" (no gating).
 * - Studio mode: ONE Stripe account behind the platform billing service. Rather
 *   than pull Stripe/Postgres into this public repo, the app asks the platform
 *   service about the current app's entitlement for a user. Contract:
 *     GET  <STUDIO_BILLING_URL>/api/entitlement?userId=&app=  -> { active }
 *     POST <STUDIO_BILLING_URL>/api/portal { userId, app }     -> { url }
 *   Entitlements are keyed by (userId, appConfig.slug) so one account serves
 *   every app.
 */

import { IS_STUDIO } from './mode';
import { appConfig } from './app-config';

export interface BillingProvider {
  /** Whether billing is active in the current mode. */
  enabled: boolean;
  /** Whether the given user has an active paid subscription for THIS app. */
  hasActiveSubscription(userId: string): Promise<boolean>;
  /** URL the user can visit to manage their subscription (Stripe portal). */
  customerPortalUrl(userId: string): Promise<string | null>;
}

const localBilling: BillingProvider = {
  enabled: false,
  async hasActiveSubscription() {
    return true; // no gating when self-hosted
  },
  async customerPortalUrl() {
    return null;
  },
};

const BILLING_URL = process.env.STUDIO_BILLING_URL ?? 'https://billing.stdout.studio';
const SERVICE_TOKEN = process.env.STUDIO_SERVICE_TOKEN ?? '';

function serviceHeaders(): Record<string, string> {
  return SERVICE_TOKEN ? { authorization: `Bearer ${SERVICE_TOKEN}` } : {};
}

export const studioBilling: BillingProvider = {
  enabled: true,
  async hasActiveSubscription(userId: string) {
    try {
      const url = `${BILLING_URL}/api/entitlement?userId=${encodeURIComponent(
        userId,
      )}&app=${encodeURIComponent(appConfig.slug)}`;
      const res = await fetch(url, { headers: serviceHeaders(), cache: 'no-store' });
      if (!res.ok) return false;
      const data = (await res.json()) as { active?: boolean };
      return data.active === true;
    } catch {
      // Fail closed: if the billing service is unreachable, don't grant access.
      return false;
    }
  },
  async customerPortalUrl(userId: string) {
    try {
      const res = await fetch(`${BILLING_URL}/api/portal`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...serviceHeaders() },
        body: JSON.stringify({ userId, app: appConfig.slug }),
        cache: 'no-store',
      });
      if (!res.ok) return null;
      const data = (await res.json()) as { url?: string };
      return data.url ?? null;
    } catch {
      return null;
    }
  },
};

export const billing: BillingProvider = IS_STUDIO ? studioBilling : localBilling;
