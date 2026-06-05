/**
 * AI provider — wraps Anthropic SDK. In local mode the API key comes from
 * the user's env (BYO key). In hosted mode it comes from the platform's
 * shared key with per-app metadata for cost tagging.
 *
 * Returns the Anthropic client + a metadata object every chat call should
 * include in its `metadata.user_id` (hosted) or just pass through (local).
 */

import Anthropic from '@anthropic-ai/sdk';
import { IS_HOSTED } from './mode';
import { appConfig } from './app-config';

export interface AIProvider {
  client: Anthropic;
  /** Metadata to include in every Anthropic API call for cost-tracking +
   *  audit. Optional caller-supplied user_id is appended in hosted mode. */
  metadata(userId?: string): { user_id?: string } | undefined;
}

function makeLocalProvider(): AIProvider {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    // We don't throw here at module load — that would break Next.js
    // build-time analysis. Instead the chat route surfaces a clear error
    // when a request actually arrives.
    return {
      client: new Anthropic({ apiKey: 'missing' }),
      metadata: () => undefined,
    };
  }
  return {
    client: new Anthropic({ apiKey }),
    metadata: () => undefined,
  };
}

function makeHostedProvider(): AIProvider {
  const apiKey = process.env.HOSTED_ANTHROPIC_KEY ?? process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return {
      client: new Anthropic({ apiKey: 'missing' }),
      metadata: () => undefined,
    };
  }
  return {
    client: new Anthropic({ apiKey }),
    metadata: (userId) =>
      userId
        ? { user_id: `${appConfig.slug}:${userId}` }
        : { user_id: appConfig.slug },
  };
}

export const ai: AIProvider = IS_HOSTED ? makeHostedProvider() : makeLocalProvider();

export function hasAIKey(): boolean {
  const key = IS_HOSTED
    ? process.env.HOSTED_ANTHROPIC_KEY ?? process.env.ANTHROPIC_API_KEY
    : process.env.ANTHROPIC_API_KEY;
  return Boolean(key && key !== 'missing');
}
