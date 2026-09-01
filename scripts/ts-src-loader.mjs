// Lets plain `node scripts/*.mjs` import the core `src/` TypeScript tree.
//
// Node runs .ts files natively (type stripping), but it does not rewrite module
// specifiers: `src/` is written for tsc and imports siblings as `./x.js`, which
// resolves only after a build. Registering this hook maps those specifiers back
// to the .ts source, so a docs generator reads exactly the code the tests do
// without requiring `pnpm build` first.
import { register } from 'node:module'

register('./ts-src-resolver.mjs', import.meta.url)
