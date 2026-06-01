export function uniqueStrings(items = []) {
  return [...new Set(items.filter((item) => typeof item === 'string' && item.length > 0))];
}
