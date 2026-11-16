import * as survey from '@kontourai/survey/review-workbench';
import {startReviewConsoleServer as startConsole} from '@kontourai/survey/review-console';

export {survey, startConsole};
export const workbenchUrl = import.meta.resolve('@kontourai/survey/review-workbench');
