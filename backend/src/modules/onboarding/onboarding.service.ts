import { sequelize } from '../../config/database';
import { ValidationError } from '../../utils/errors';
import * as interestsDataAccess from '../interests/interests.data-access';
import type { InterestCatalogItem } from '../interests/interests.types';
import * as relationshipIntentionsDataAccess from '../relationship-intentions/relationship-intentions.data-access';
import type { RelationshipIntentionCatalogItem } from '../relationship-intentions/relationship-intentions.types';

function unavailableIds(requestedIds: string[], activeIds: string[]): string[] {
  const active = new Set(activeIds.map((id) => id.toLowerCase()));
  return requestedIds.filter((id) => !active.has(id.toLowerCase()));
}

function canonicalIds(requestedIds: string[], activeIds: string[]): string[] {
  const active = new Map(activeIds.map((id) => [id.toLowerCase(), id]));
  return requestedIds.map((id) => active.get(id.toLowerCase()) as string);
}

function rejectUnavailable(field: string, ids: string[], errorCode: string, message: string): void {
  if (ids.length === 0) {
    return;
  }

  throw new ValidationError(
    message,
    ids.map((id) => ({ field, message: `${id} is unknown or inactive.` })),
    errorCode
  );
}

export async function replaceOwnInterests(userId: string, interestIds: string[]): Promise<InterestCatalogItem[]> {
  const active = await interestsDataAccess.findActiveInterestsByIds(interestIds);
  const missing = unavailableIds(
    interestIds,
    active.map((row) => row.id)
  );
  rejectUnavailable(
    'interestIds',
    missing,
    'INVALID_INTEREST',
    'One or more interests are not available.'
  );

  const selected = await sequelize.transaction(async (transaction) => {
    await interestsDataAccess.replaceUserInterests(userId, canonicalIds(interestIds, active.map((row) => row.id)), transaction);
    return interestsDataAccess.findUserInterests(userId, transaction);
  });

  return selected.map((row) => ({
    id: row.id,
    code: row.code,
    name: row.name,
    category: row.category ?? null
  }));
}

export async function replaceOwnRelationshipIntentions(
  userId: string,
  relationshipIntentionIds: string[]
): Promise<RelationshipIntentionCatalogItem[]> {
  const active = await relationshipIntentionsDataAccess.findActiveRelationshipIntentionsByIds(relationshipIntentionIds);
  const missing = unavailableIds(
    relationshipIntentionIds,
    active.map((row) => row.id)
  );
  rejectUnavailable(
    'relationshipIntentionIds',
    missing,
    'INVALID_RELATIONSHIP_INTENTION',
    'One or more relationship intentions are not available.'
  );

  const selected = await sequelize.transaction(async (transaction) => {
    await relationshipIntentionsDataAccess.replaceUserRelationshipIntentions(
      userId,
      canonicalIds(relationshipIntentionIds, active.map((row) => row.id)),
      transaction
    );
    return relationshipIntentionsDataAccess.findUserRelationshipIntentions(userId, transaction);
  });

  return selected.map((row) => ({
    id: row.id,
    code: row.code,
    name: row.name
  }));
}
