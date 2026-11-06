import * as policy0 from "../../../domains/production/composition-editor/composition-html-editing-historical-publication-http.contract";
import * as policy1 from "../../../domains/production/composition-editor/composition-html-editing-initialization-http.contract";
import * as policy2 from "../../../domains/production/composition-editor/composition-html-editing-initialization-operation-http-policy";
import * as policy3 from "../../../domains/production/composition-editor/composition-html-editing-inspector-http-policy";
import * as policy4 from "../../../domains/production/composition-editor/composition-html-editing-legacy-adoption-http-policy";
import * as policy5 from "../../../domains/production/composition-editor/composition-html-editing-legacy-inventory.contract";
import * as policy6 from "../../../domains/production/composition-editor/composition-html-editing-mutation.contract";
import * as policy7 from "../../../domains/production/composition-editor/composition-html-editing-operation-http-policy";
import * as policy8 from "../../../domains/production/composition-editor/composition-html-editing-reconstruction-opening.contract";
import * as policy9 from "../../../domains/production/composition-editor/composition-html-editing-snapshot-history-http.contract";
import * as policy10 from "../../../domains/production/composition-editor/composition-html-editing-snapshot-recovery-policy";
import * as policy11 from "../../../domains/production/composition-editor/composition-html-snapshot-publication-http.contract";
export const HTML_ROUTE_POLICIES: Record<string, unknown> = {
  "@/domains/production/composition-editor/composition-html-editing-historical-publication-http.contract": policy0,
  "@/domains/production/composition-editor/composition-html-editing-initialization-http.contract": policy1,
  "@/domains/production/composition-editor/composition-html-editing-initialization-operation-http-policy": policy2,
  "@/domains/production/composition-editor/composition-html-editing-inspector-http-policy": policy3,
  "@/domains/production/composition-editor/composition-html-editing-legacy-adoption-http-policy": policy4,
  "@/domains/production/composition-editor/composition-html-editing-legacy-inventory.contract": policy5,
  "@/domains/production/composition-editor/composition-html-editing-mutation.contract": policy6,
  "@/domains/production/composition-editor/composition-html-editing-operation-http-policy": policy7,
  "@/domains/production/composition-editor/composition-html-editing-reconstruction-opening.contract": policy8,
  "@/domains/production/composition-editor/composition-html-editing-snapshot-history-http.contract": policy9,
  "@/domains/production/composition-editor/composition-html-editing-snapshot-recovery-policy": policy10,
  "@/domains/production/composition-editor/composition-html-snapshot-publication-http.contract": policy11,
};
