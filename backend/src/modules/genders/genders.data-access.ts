import { Gender } from '../../database/models/gender.model';

export async function findActiveGenders(): Promise<Gender[]> {
  return Gender.findAll({
    attributes: ['id', 'code', 'name'],
    where: { isActive: true },
    order: [['displayOrder', 'ASC']]
  });
}
