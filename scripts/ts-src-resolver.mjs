/** Resolve relative `./x.js` specifiers to `./x.ts` when only the source exists. */
export async function resolve(specifier, context, nextResolve) {
  if ((specifier.startsWith('./') || specifier.startsWith('../')) && specifier.endsWith('.js')) {
    try {
      return await nextResolve(`${specifier.slice(0, -3)}.ts`, context)
    } catch {
      // Fall through: the .js really does exist (or neither does).
    }
  }
  return nextResolve(specifier, context)
}
