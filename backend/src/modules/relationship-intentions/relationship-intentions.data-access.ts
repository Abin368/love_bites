import { Op, Transaction } from 'sequelize';
import '../../database/associations';
import { RelationshipIntention } from '../../database/models/relationship-intention.model';
import { UserRelationshipIntention } from '../../database/models/user-relationship-intention.model';

export async function findActiveRelationshipIntentions(): Promise<RelationshipIntention[]> {
  return RelationshipIntention.findAll({
    attributes: ['id', 'code', 'name'],
    where: { isActive: true },
    order: [['displayOrder', 'ASC']]
  });
}

export async function findActiveRelationshipIntentionsByIds(ids: string[]): Promise<RelationshipIntention[]> {
  if (ids.length === 0) {
    return [];
  }

  return RelationshipIntention.findAll({
    attributes: ['id'],
    where: {
      id: { [Op.in]: ids },
      isActive: true
    }
  });
}

export async function replaceUserRelationshipIntentions(
  userId: string,
  relationshipIntentionIds: string[],
  transaction: Transaction
): Promise<void> {
  await UserRelationshipIntention.destroy({ where: { userId }, transaction });

  if (relationshipIntentionIds.length === 0) {
    return;
  }

  const createdAt = new Date();
  await UserRelationshipIntention.bulkCreate(
    relationshipIntentionIds.map((relationshipIntentionId) => ({ userId, relationshipIntentionId, createdAt })),
    { transaction }
  );
}

export async function findUserRelationshipIntentions(
  userId: string,
  transaction?: Transaction
): Promise<RelationshipIntention[]> {
  const links = await UserRelationshipIntention.findAll({
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

  return links.map((link) => link.get('relationshipIntention') as RelationshipIntention);
}
