export function displayText(value) {
  return String(value).replace(/[\x00-\x1f\x7f]/g, (character) => {
    const escapes = { '\n': '\\n', '\r': '\\r', '\t': '\\t' };
    return escapes[character] ?? `\\x${character.charCodeAt(0).toString(16).padStart(2, '0')}`;
  });
}

export function markdownText(value) {
  return displayText(value).replace(/[\\`*_{}\[\]<>#!|~]/g, '\\$&');
}

export function markdownCode(value) {
  const text = displayText(value);
  const runs = text.match(/`+/g) ?? [];
  const delimiter = '`'.repeat(Math.max(0, ...runs.map((run) => run.length)) + 1);
  const padding = text.startsWith('`') || text.endsWith('`') || /^ +$/.test(text) ? ' ' : '';
  return `${delimiter}${padding}${text}${padding}${delimiter}`;
}
