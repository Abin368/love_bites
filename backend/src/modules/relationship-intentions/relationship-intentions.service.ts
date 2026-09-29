import * as relationshipIntentionsDataAccess from './relationship-intentions.data-access';
import type { RelationshipIntentionCatalogItem } from './relationship-intentions.types';

export async function listActiveRelationshipIntentions(): Promise<RelationshipIntentionCatalogItem[]> {
  const rows = await relationshipIntentionsDataAccess.findActiveRelationshipIntentions();
  return rows.map((row) => ({
    id: row.id,
    code: row.code,
    name: row.name
  }));
}
