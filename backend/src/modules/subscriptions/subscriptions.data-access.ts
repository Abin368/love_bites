import { Plan } from '../../database/models/plan.model';

export async function findActivePlans(): Promise<Plan[]> {
  return Plan.findAll({
    attributes: ['id', 'code', 'name', 'priceInCents', 'currency', 'billingInterval'],
    where: { isActive: true },
    order: [['displayOrder', 'ASC']]
  });
}
