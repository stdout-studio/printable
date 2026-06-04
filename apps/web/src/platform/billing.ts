/**
 * Billing provider. In local mode this is a no-op (self-hosters don't pay
 * stdout.studio anything; they may run their own Stripe if they want, but
 * the platform doesn't get involved).
 *
 * In studio mode this wraps Stripe — checkout sessions, customer portal,
 * webhook handling, subscription state queries.
 *
 * Studio implementation is stubbed; activated when we deploy.
 */

import { IS_STUDIO } from './mode';

export interface BillingProvider {
  /** Whether billing is active in the current mode. */
  enabled: boolean;
  /** Whether the given user has an active paid subscription. */
  hasActiveSubscription(userId: string): Promise<boolean>;
  /** URL the user can visit to manage their subscription (Stripe portal). */
  customerPortalUrl(userId: string): Promise<string | null>;
}

const localBilling: BillingProvider = {
  enabled: false,
  async hasActiveSubscription() {
    // In local mode every user is effectively "subscribed" — no gating.
    return true;
  },
  async customerPortalUrl() {
    return null;
  },
};

const studioBilling: BillingProvider = {
  enabled: true,
  async hasActiveSubscription(_userId: string) {
    // TODO: query Stripe subscription state from shared billing schema.
    return false;
  },
  async customerPortalUrl(_userId: string) {
    // TODO: create Stripe customer portal session.
    return null;
  },
};

export const billing: BillingProvider = IS_STUDIO ? studioBilling : localBilling;
