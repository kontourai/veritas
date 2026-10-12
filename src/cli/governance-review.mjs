import {parseArgs} from 'node:util';
import {createGovernanceSurveyReview, serveGovernanceSurveyReview} from '../governance-review.mjs';

export async function runGovernanceReviewCli(args) {
  const {values} = parseArgs({args, options: {root: {type: 'string'}, plan: {type: 'string'}, 'host-root': {type: 'string'}, 'expires-at': {type: 'string'}, port: {type: 'string'}}});
  if (!values.plan || !values['host-root'] || !values['expires-at']) throw new Error('review requires --plan, --host-root and --expires-at');
  const port = Number(values.port ?? 0);
  if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error('Review port must be 0..65535');
  const review = await createGovernanceSurveyReview({rootDir: values.root ?? process.cwd(), planPath: values.plan, hostRoot: values['host-root'], expiresAt: values['expires-at']});
  const server = await serveGovernanceSurveyReview({hostRoot: values['host-root'], sessionPath: review.sessionFile, port});
  process.stdout.write(JSON.stringify({...review, url: server.url}) + '\n');
  const close = async () => { await server.close(); process.exitCode = 0; };
  process.once('SIGINT', close); process.once('SIGTERM', close);
}
