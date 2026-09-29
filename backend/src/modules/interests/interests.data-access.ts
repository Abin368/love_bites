import { Interest } from '../../database/models/interest.model';

export async function findActiveInterests(): Promise<Interest[]> {
  return Interest.findAll({
    attributes: ['id', 'code', 'name', 'category'],
    where: { isActive: true },
    order: [['displayOrder', 'ASC']]
  });
}
