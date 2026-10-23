const CLOCKS = new Set(['Date.now', 'performance.now', 'process.hrtime', 'process.hrtime.bigint']);
const TIMERS = new Set(['setTimeout', 'setInterval', 'setImmediate']);
function path(node) {
  if (node.type === 'Identifier') return node.name;
  if (node.type !== 'MemberExpression') return '';
  const property = node.computed
    ? node.property.type === 'Literal' ? node.property.value : ''
    : node.property.name;
  return `${path(node.object)}.${property}`;
}
export default {
  meta: { type: 'problem', docs: { description: 'Keep explicitly scoped unit tests independent of real clocks and timer waits.' } },
  create(context) {
    const report = (node) => context.report({ node,
      message: 'Use a fixed epoch, controlled test clock, or await the event that marks completion. Real timing belongs in explicitly scoped integration/performance tests.' });
    return {
      CallExpression(node) {
        const name = path(node.callee);
        if (CLOCKS.has(name) || TIMERS.has(name) || /^globalThis\.(?:setTimeout|setInterval|setImmediate)$/.test(name)) report(node);
      },
      NewExpression(node) {
        if (node.callee.type === 'Identifier' && node.callee.name === 'Date' && node.arguments.length === 0) report(node);
      },
      ImportDeclaration(node) {
        if (['node:timers/promises', 'timers/promises'].includes(node.source.value)) report(node);
      },
    };
  },
};
