import { writeFileSync } from 'node:fs';
import { buildResearchTasks } from '../tasks/build-research.js';
import { buildSupportTasks } from '../tasks/build-support.js';
import {
  taskFile,
  validateResearchTasks,
  validateSupportTasks,
} from '../tasks/load.js';

/**
 * Writes tasks/research.json and tasks/support.json from the task builders
 * (which read the expected answers from the synthetic worlds). The JSON
 * files are committed; a test checks they match the builders.
 */
const research = validateResearchTasks(buildResearchTasks());
const support = validateSupportTasks(buildSupportTasks());
for (const [agent, data] of [
  ['research', research],
  ['support', support],
] as const) {
  writeFileSync(taskFile(agent), `${JSON.stringify(data, null, 2)}\n`, 'utf8');
  console.log(`Wrote ${taskFile(agent)} (${data.tasks.length} tasks)`);
}
