import type { NextConfig } from 'next';

const config: NextConfig = {
  reactStrictMode: true,
  // Transpile workspace packages. @printable/types ships TS source
  // directly; @printable/indexer ships compiled dist/ JS so it isn't
  // listed here.
  transpilePackages: ['@printable/types'],
  // The retrieval API uses onnxruntime-node and @lancedb/lancedb-darwin-arm64,
  // both native-binding packages. Mark them external so Next doesn't try
  // to bundle them — they're loaded via require() at runtime from
  // node_modules.
  serverExternalPackages: [
    'onnxruntime-node',
    '@lancedb/lancedb',
    '@lancedb/lancedb-darwin-arm64',
    '@lancedb/lancedb-linux-x64-gnu',
    '@lancedb/lancedb-linux-arm64-gnu',
    '@huggingface/transformers',
    'sharp',
  ],
};

export default config;
