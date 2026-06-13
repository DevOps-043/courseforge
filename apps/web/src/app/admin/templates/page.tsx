import { getTemplatesAction, getPublicTemplatesAction } from "@/domains/production/actions/templates.actions";
import TemplatesContainer from "./TemplatesContainer";

export const dynamic = "force-dynamic";

export default async function TemplatesPage() {
  // Fetch initial templates for both lists on the server
  const { templates: initialTemplates = [] } = await getTemplatesAction();
  const { templates: initialPublicTemplates = [] } = await getPublicTemplatesAction();

  return (
    <TemplatesContainer 
      initialTemplates={initialTemplates} 
      initialPublicTemplates={initialPublicTemplates}
    />
  );
}
