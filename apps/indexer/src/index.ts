// Public surface of @printable/indexer.
//
// Anything the Next.js app imports goes through this module so its
// import paths stay stable as the CLI internals move around.

export {
  search,
  encodeQuery,
  resolveModelFile,
} from './search/index.js';

export {
  buildCaptionText,
  encodeImage,
  encodeText,
  fuseEmbeddings,
} from './siglip.js';

export {
  modelDir,
  dataDir,
  rawDir,
  lanceDbDir,
  indexerRoot,
} from './paths.js';

export * from './types.js';
