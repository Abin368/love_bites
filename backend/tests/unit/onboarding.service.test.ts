jest.mock('../../src/config/database', () => ({
  sequelize: {
    transaction: jest.fn()
  }
}));

jest.mock('../../src/modules/interests/interests.data-access', () => ({
  findActiveInterests: jest.fn(),
  findActiveInterestsByIds: jest.fn(),
  replaceUserInterests: jest.fn(),
  findUserInterests: jest.fn()
}));

jest.mock('../../src/modules/relationship-intentions/relationship-intentions.data-access', () => ({
  findActiveRelationshipIntentions: jest.fn(),
  findActiveRelationshipIntentionsByIds: jest.fn(),
  replaceUserRelationshipIntentions: jest.fn(),
  findUserRelationshipIntentions: jest.fn()
}));

import { sequelize } from '../../src/config/database';
import * as interestsDataAccess from '../../src/modules/interests/interests.data-access';
import { replaceOwnInterests, replaceOwnRelationshipIntentions } from '../../src/modules/onboarding/onboarding.service';
import * as relationshipIntentionsDataAccess from '../../src/modules/relationship-intentions/relationship-intentions.data-access';
import { ValidationError } from '../../src/utils/errors';

const interests = interestsDataAccess as jest.Mocked<typeof interestsDataAccess>;
const intentions = relationshipIntentionsDataAccess as jest.Mocked<typeof relationshipIntentionsDataAccess>;
const transaction = sequelize.transaction as jest.Mock;
const userId = 'user-1';
const interestIds = [
  '1a2b3c4d-0001-4000-8000-000000000001',
  '1a2b3c4d-0002-4000-8000-000000000002',
  '1a2b3c4d-0003-4000-8000-000000000003'
];
const intentionIds = ['2a3b4c5d-0001-4000-8000-000000000001', '2a3b4c5d-0002-4000-8000-000000000002'];

describe('onboarding selection service', () => {
  beforeEach(() => {
    transaction.mockImplementation(async (work: (trx: { id: string }) => Promise<unknown>) => work({ id: 'tx' }));
  });

  it('replaces interests inside a transaction and returns catalog fields only', async () => {
    interests.findActiveInterestsByIds.mockResolvedValue(interestIds.map((id) => ({ id })) as never);
    interests.findUserInterests.mockResolvedValue([
      { id: interestIds[2], code: 'C', name: 'Third', category: null, displayOrder: 1 },
      { id: interestIds[0], code: 'A', name: 'First', category: 'Food', displayOrder: 2 },
      { id: interestIds[1], code: 'B', name: 'Second', category: 'Sport', displayOrder: 3 }
    ] as never);

    const result = await replaceOwnInterests(userId, [interestIds[0].toUpperCase(), interestIds[1], interestIds[2]]);

    expect(transaction).toHaveBeenCalledTimes(1);
    expect(interests.replaceUserInterests).toHaveBeenCalledWith(userId, interestIds, { id: 'tx' });
    expect(result).toEqual([
      { id: interestIds[2], code: 'C', name: 'Third', category: null },
      { id: interestIds[0], code: 'A', name: 'First', category: 'Food' },
      { id: interestIds[1], code: 'B', name: 'Second', category: 'Sport' }
    ]);
    expect(result[0]).not.toHaveProperty('displayOrder');
  });

  it('does not change interests when an id is unknown or inactive', async () => {
    interests.findActiveInterestsByIds.mockResolvedValue([{ id: interestIds[0] }, { id: interestIds[1] }] as never);

    await expect(replaceOwnInterests(userId, interestIds)).rejects.toMatchObject({
      name: 'ValidationError',
      statusCode: 400,
      errorCode: 'INVALID_INTEREST'
    });
    expect(transaction).not.toHaveBeenCalled();
    expect(interests.replaceUserInterests).not.toHaveBeenCalled();
  });

  it('propagates an interest insert failure from the transaction', async () => {
    interests.findActiveInterestsByIds.mockResolvedValue(interestIds.map((id) => ({ id })) as never);
    interests.replaceUserInterests.mockRejectedValue(new Error('insert failed'));

    await expect(replaceOwnInterests(userId, interestIds)).rejects.toThrow('insert failed');
    expect(interests.findUserInterests).not.toHaveBeenCalled();
  });

  it('replaces relationship intentions inside a transaction and omits extra fields', async () => {
    intentions.findActiveRelationshipIntentionsByIds.mockResolvedValue(intentionIds.map((id) => ({ id })) as never);
    intentions.findUserRelationshipIntentions.mockResolvedValue([
      { id: intentionIds[1], code: 'FRIENDSHIP', name: 'Friendship', description: 'hidden', displayOrder: 1 },
      { id: intentionIds[0], code: 'LONG_TERM_RELATIONSHIP', name: 'Long-term relationship', displayOrder: 2 }
    ] as never);

    const result = await replaceOwnRelationshipIntentions(userId, intentionIds);

    expect(intentions.replaceUserRelationshipIntentions).toHaveBeenCalledWith(userId, intentionIds, { id: 'tx' });
    expect(result).toEqual([
      { id: intentionIds[1], code: 'FRIENDSHIP', name: 'Friendship' },
      { id: intentionIds[0], code: 'LONG_TERM_RELATIONSHIP', name: 'Long-term relationship' }
    ]);
    expect(result[0]).not.toHaveProperty('description');
  });

  it('does not change intentions when an id is unknown or inactive', async () => {
    intentions.findActiveRelationshipIntentionsByIds.mockResolvedValue([{ id: intentionIds[0] }] as never);

    const error = await replaceOwnRelationshipIntentions(userId, intentionIds).catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(ValidationError);
    expect(error).toMatchObject({ errorCode: 'INVALID_RELATIONSHIP_INTENTION' });
    expect(transaction).not.toHaveBeenCalled();
    expect(intentions.replaceUserRelationshipIntentions).not.toHaveBeenCalled();
  });

  it('propagates an intention insert failure from the transaction', async () => {
    intentions.findActiveRelationshipIntentionsByIds.mockResolvedValue(intentionIds.map((id) => ({ id })) as never);
    intentions.replaceUserRelationshipIntentions.mockRejectedValue(new Error('insert failed'));

    await expect(replaceOwnRelationshipIntentions(userId, intentionIds)).rejects.toThrow('insert failed');
    expect(intentions.findUserRelationshipIntentions).not.toHaveBeenCalled();
  });
});
