// CLI: pnpm --filter @printable/indexer search "robotic arm cable channel" --top-k 5
//
// Prints title, score, and the on-disk thumbnail path for the top
// matches. Used to sanity-check the index from a terminal.

import path from 'node:path';

import { modelDir } from '../paths.js';
import { search } from './index.js';

interface ParsedArgs {
  text: string;
  topK: number;
}

function parseArgs(argv: string[]): ParsedArgs {
  let topK = 5;
  const textParts: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    if (arg === '--top-k' || arg === '-k') {
      const next = argv[++i];
      if (!next) throw new Error('--top-k expects a value');
      topK = Number(next);
      if (!Number.isFinite(topK) || topK < 1) {
        throw new Error(`--top-k must be a positive integer (got ${next})`);
      }
    } else if (arg.startsWith('--top-k=')) {
      topK = Number(arg.slice('--top-k='.length));
    } else {
      textParts.push(arg);
    }
  }
  if (textParts.length === 0) {
    throw new Error('usage: search "<query text>" [--top-k N]');
  }
  return { text: textParts.join(' '), topK };
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  console.log(`query: ${JSON.stringify(args.text)} (top-${args.topK})`);

  const t0 = Date.now();
  const results = await search({ text: args.text, topK: args.topK });
  const ms = Date.now() - t0;

  console.log(`\n${results.length} results in ${ms}ms\n`);
  for (let i = 0; i < results.length; i++) {
    const r = results[i]!;
    const thumb = r.thumbnails.front
      ? path.relative(process.cwd(), path.join(modelDir(r.id), r.thumbnails.front))
      : '(no thumbnail)';
    console.log(`#${i + 1}  score=${r.score.toFixed(4)}  ${r.title}`);
    console.log(`     id=${r.id}  license=${r.license}  author=${r.author}`);
    console.log(`     bbox=${r.boundingBox.x.toFixed(1)} x ${r.boundingBox.y.toFixed(1)} x ${r.boundingBox.z.toFixed(1)} mm  tri=${r.triCount}`);
    if (r.tags.length > 0) {
      console.log(`     tags=${r.tags.slice(0, 6).join(', ')}${r.tags.length > 6 ? '…' : ''}`);
    }
    console.log(`     thumb=${thumb}`);
    console.log();
  }
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
