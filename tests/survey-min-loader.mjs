// Resolve the public peer from the pinned minimum fixture in the compatibility suite.
const fixture = new URL('./survey-min/index.mjs', import.meta.url).href;

export function resolve(specifier, context, nextResolve) {
  if (specifier.startsWith('@kontourai/survey/')) {
    return nextResolve(specifier, {...context, parentURL: fixture});
  }
  return nextResolve(specifier, context);
}
