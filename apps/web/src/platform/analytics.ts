/**
 * Analytics provider. Local mode: noop (we don't phone home from self-hosted
 * instances unless the operator opts in). Studio mode: PostHog (stubbed).
 */

import { IS_STUDIO } from './mode';

export interface AnalyticsProvider {
  capture(event: string, props?: Record<string, unknown>, userId?: string): void;
}

const noopAnalytics: AnalyticsProvider = {
  capture() {
    // intentional no-op
  },
};

const studioAnalytics: AnalyticsProvider = {
  capture(_event, _props, _userId) {
    // TODO: PostHog client when we wire it up.
  },
};

export const analytics: AnalyticsProvider = IS_STUDIO ? studioAnalytics : noopAnalytics;
