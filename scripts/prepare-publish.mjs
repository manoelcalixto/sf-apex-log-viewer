import { rm } from 'node:fs/promises';

// Force a fresh emit before packing because postpack removes build artifacts.
await Promise.all([
  rm('lib', { recursive: true, force: true }),
  rm('tsconfig.tsbuildinfo', { force: true }),
  rm('.wireit', { recursive: true, force: true })
]);
