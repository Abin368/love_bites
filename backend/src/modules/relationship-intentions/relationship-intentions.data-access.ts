import { RelationshipIntention } from '../../database/models/relationship-intention.model';

export async function findActiveRelationshipIntentions(): Promise<RelationshipIntention[]> {
  return RelationshipIntention.findAll({
    attributes: ['id', 'code', 'name'],
    where: { isActive: true },
    order: [['displayOrder', 'ASC']]
  });
}
