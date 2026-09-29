import { Op, Transaction } from 'sequelize';
import '../../database/associations';
import { Interest } from '../../database/models/interest.model';
import { UserInterest } from '../../database/models/user-interest.model';

export async function findActiveInterests(): Promise<Interest[]> {
  return Interest.findAll({
    attributes: ['id', 'code', 'name', 'category'],
    where: { isActive: true },
    order: [['displayOrder', 'ASC']]
  });
}

export async function findActiveInterestsByIds(ids: string[]): Promise<Interest[]> {
  if (ids.length === 0) {
    return [];
  }

  return Interest.findAll({
    attributes: ['id'],
    where: {
      id: { [Op.in]: ids },
      isActive: true
    }
  });
}

export async function replaceUserInterests(
  userId: string,
  interestIds: string[],
  transaction: Transaction
): Promise<void> {
  await UserInterest.destroy({ where: { userId }, transaction });

  if (interestIds.length === 0) {
    return;
  }

  const createdAt = new Date();
  await UserInterest.bulkCreate(
    interestIds.map((interestId) => ({ userId, interestId, createdAt })),
    { transaction }
  );
}

export async function findUserInterests(userId: string, transaction?: Transaction): Promise<Interest[]> {
  const links = await UserInterest.findAll({
    where: { userId },
    attributes: ['id'],
    include: [
      {
        model: Interest,
        as: 'interest',
        attributes: ['id', 'code', 'name', 'category', 'displayOrder'],
        required: true
      }
    ],
    order: [
      [{ model: Interest, as: 'interest' }, 'displayOrder', 'ASC'],
      [{ model: Interest, as: 'interest' }, 'code', 'ASC']
    ],
    transaction
  });

  return links.map((link) => link.get('interest') as Interest);
}
