import suppressionReason from './rules/require-suppression-reason.mjs';
import lowValueComments from './rules/no-low-value-comments.mjs';
import namespaceNodeImports from './rules/namespace-node-imports.mjs';
import deterministicUnitTests from './rules/deterministic-unit-tests.mjs';
export default {
  meta: { name: 'repo-hygiene' },
  rules: {
    'require-suppression-reason': suppressionReason,
    'no-low-value-comments': lowValueComments,
    'namespace-node-imports': namespaceNodeImports,
    'deterministic-unit-tests': deterministicUnitTests,
  },
};
