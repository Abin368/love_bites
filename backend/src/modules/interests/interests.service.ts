import * as interestsDataAccess from './interests.data-access';
import type { InterestCatalogItem } from './interests.types';

export async function listActiveInterests(): Promise<InterestCatalogItem[]> {
  const rows = await interestsDataAccess.findActiveInterests();
  return rows.map((row) => ({
    id: row.id,
    code: row.code,
    name: row.name,
    category: row.category ?? null
  }));
}
