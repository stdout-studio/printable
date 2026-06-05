/**
 * Public surface of the platform — the only entry the app
 * code should import from.
 *
 * Today this lives inside Printable's apps/web. When a second app ships
 * (and the abstractions have proven themselves), this whole directory
 * extracts into a published package.
 */

export { MODE, IS_LOCAL, IS_HOSTED } from './mode';
export type { Mode } from './mode';

export { appConfig } from './app-config';
export type {
  AppConfig,
  RequiredEnvVar,
  BrandTokens,
  LegalConfig,
} from './config';

export { auth } from './auth';
export type { User, Session, AuthProvider } from './auth';

export { ai, hasAIKey } from './ai';
export type { AIProvider } from './ai';

export { billing } from './billing';
export type { BillingProvider } from './billing';

export { analytics } from './analytics';
export type { AnalyticsProvider } from './analytics';

export { storage } from './storage';
export type { StorageProvider } from './storage';
