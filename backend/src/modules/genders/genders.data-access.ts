import { Op } from 'sequelize';
import { Gender } from '../../database/models/gender.model';

export async function findActiveGenders(): Promise<Gender[]> {
  return Gender.findAll({
    attributes: ['id', 'code', 'name'],
    where: { isActive: true },
    order: [['displayOrder', 'ASC']]
  });
}

export async function findActiveGendersByIds(ids: string[]): Promise<Gender[]> {
  if (ids.length === 0) {
    return [];
  }

  return Gender.findAll({
    attributes: ['id'],
    where: {
      id: { [Op.in]: ids },
      isActive: true
    }
  });
}
