import { Transaction } from 'sequelize';
import '../../database/associations';
import { DatingPreference } from '../../database/models/dating-preference.model';
import { Gender } from '../../database/models/gender.model';
import { RelationshipIntention } from '../../database/models/relationship-intention.model';
import { UserDatingPreferenceGender } from '../../database/models/user-dating-preference-gender.model';
import { UserDatingPreferenceIntention } from '../../database/models/user-dating-preference-intention.model';
import type { GenderCatalogItem } from '../genders/genders.types';
import type { RelationshipIntentionCatalogItem } from '../relationship-intentions/relationship-intentions.types';

export interface DatingPreferenceRecord {
  minAge: number;
  maxAge: number;
  maxDistanceKm: number;
}

export interface DatingPreferenceWrite {
  minAge: number;
  maxAge: number;
  maxDistanceKm: number;
}

export async function findDatingPreference(
  userId: string,
  transaction?: Transaction
): Promise<DatingPreferenceRecord | null> {
  const row = await DatingPreference.findOne({
    where: { userId },
    attributes: ['minAge', 'maxAge', 'maxDistanceKm'],
    transaction
  });
  if (!row) {
    return null;
  }
  return {
    minAge: row.minAge,
    maxAge: row.maxAge,
    maxDistanceKm: row.maxDistanceKm
  };
}

export async function createDatingPreference(
  userId: string,
  input: DatingPreferenceWrite,
  transaction: Transaction
): Promise<void> {
  const now = new Date();
  await DatingPreference.create(
    {
      userId,
      minAge: input.minAge,
      maxAge: input.maxAge,
      maxDistanceKm: input.maxDistanceKm,
      createdAt: now,
      updatedAt: now
    },
    { transaction }
  );
}

export async function updateDatingPreference(
  userId: string,
  input: DatingPreferenceWrite,
  transaction: Transaction
): Promise<void> {
  await DatingPreference.update(
    {
      minAge: input.minAge,
      maxAge: input.maxAge,
      maxDistanceKm: input.maxDistanceKm,
      updatedAt: new Date()
    },
    { where: { userId }, transaction }
  );
}

export async function replaceDatingPreferenceGenders(
  userId: string,
  genderIds: string[],
  transaction: Transaction
): Promise<void> {
  await UserDatingPreferenceGender.destroy({ where: { userId }, transaction });
  if (genderIds.length === 0) {
    return;
  }

  const createdAt = new Date();
  await UserDatingPreferenceGender.bulkCreate(
    genderIds.map((genderId) => ({ userId, genderId, createdAt })),
    { transaction }
  );
}

export async function replaceDatingPreferenceIntentions(
  userId: string,
  relationshipIntentionIds: string[],
  transaction: Transaction
): Promise<void> {
  await UserDatingPreferenceIntention.destroy({ where: { userId }, transaction });
  if (relationshipIntentionIds.length === 0) {
    return;
  }

  const createdAt = new Date();
  await UserDatingPreferenceIntention.bulkCreate(
    relationshipIntentionIds.map((relationshipIntentionId) => ({ userId, relationshipIntentionId, createdAt })),
    { transaction }
  );
}

export async function findDatingPreferenceGenders(
  userId: string,
  transaction: Transaction
): Promise<GenderCatalogItem[]> {
  const links = await UserDatingPreferenceGender.findAll({
    where: { userId },
    attributes: ['id'],
    include: [
      {
        model: Gender,
        as: 'gender',
        attributes: ['id', 'code', 'name', 'displayOrder'],
        required: true
      }
    ],
    order: [
      [{ model: Gender, as: 'gender' }, 'displayOrder', 'ASC'],
      [{ model: Gender, as: 'gender' }, 'code', 'ASC']
    ],
    transaction
  });

  return links.map((link) => {
    const gender = link.get('gender') as Gender;
    return { id: gender.id, code: gender.code, name: gender.name };
  });
}

export async function findDatingPreferenceIntentions(
  userId: string,
  transaction: Transaction
): Promise<RelationshipIntentionCatalogItem[]> {
  const links = await UserDatingPreferenceIntention.findAll({
    where: { userId },
    attributes: ['id'],
    include: [
      {
        model: RelationshipIntention,
        as: 'relationshipIntention',
        attributes: ['id', 'code', 'name', 'displayOrder'],
        required: true
      }
    ],
    order: [
      [{ model: RelationshipIntention, as: 'relationshipIntention' }, 'displayOrder', 'ASC'],
      [{ model: RelationshipIntention, as: 'relationshipIntention' }, 'code', 'ASC']
    ],
    transaction
  });

  return links.map((link) => {
    const intention = link.get('relationshipIntention') as RelationshipIntention;
    return { id: intention.id, code: intention.code, name: intention.name };
  });
}
