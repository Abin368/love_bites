import * as gendersDataAccess from './genders.data-access';
import type { GenderCatalogItem } from './genders.types';

export async function listActiveGenders(): Promise<GenderCatalogItem[]> {
  const rows = await gendersDataAccess.findActiveGenders();
  return rows.map((row) => ({
    id: row.id,
    code: row.code,
    name: row.name
  }));
}
