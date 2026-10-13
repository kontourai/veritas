const invisibleCharacters = /[\x00-\x1f\x7f-\x9f\u2028\u2029]|\p{Cf}/gu;

export function displayText(value) {
  return String(value).replace(invisibleCharacters, (character) => {
    const escapes = { '\n': '\\n', '\r': '\\r', '\t': '\\t' };
    const codePoint = character.codePointAt(0);
    if (escapes[character]) return escapes[character];
    if (codePoint <= 0x7f) return `\\x${codePoint.toString(16).padStart(2, '0')}`;
    if (codePoint <= 0xffff) return `\\u${codePoint.toString(16).padStart(4, '0')}`;
    return `\\u{${codePoint.toString(16)}}`;
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

export function quotedText(value) {
  return JSON.stringify(value).replace(invisibleCharacters, (character) => character
    .split('')
    .map((unit) => `\\u${unit.charCodeAt(0).toString(16).padStart(4, '0')}`)
    .join(''));
}
