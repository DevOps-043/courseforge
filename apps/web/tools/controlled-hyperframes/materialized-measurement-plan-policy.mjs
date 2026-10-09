import {createRequire} from "node:module";
import {dirname, join} from "node:path";
import {fileURLToPath} from "node:url";
const appRequire = createRequire(join(dirname(fileURLToPath(import.meta.url)), "../../package.json"));
export const {MATERIALIZED_MEASUREMENT_PLAN_POLICY} = appRequire(
  "./dist/composition-worker/domains/production/composition-editor/qa/composition-materialized-measurement-plan-policy.js");
