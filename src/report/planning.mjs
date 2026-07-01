export {
  resolveEvidenceCheckPlan,
  resolveWorkstream,
} from '../repo/routing.mjs';

export function parseBaselineCiFastStatus(status) {
  if (status === 'success') return true;
  if (status === 'failed') return false;
  return null;
}

export function formatTriState(value) {
  if (value === true) return 'yes';
  if (value === false) return 'no';
  return 'unknown';
}
