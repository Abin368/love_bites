import { randomUUID } from 'crypto';
import {
  replaceDatingPreferencesSchema,
  replaceInterestsSchema,
  replaceRelationshipIntentionsSchema,
  saveLocationSchema
} from '../../src/modules/onboarding/onboarding.validator';

const ids = [
  '1a2b3c4d-0001-4000-8000-000000000001',
  '1a2b3c4d-0002-4000-8000-000000000002',
  '1a2b3c4d-0003-4000-8000-000000000003',
  '1a2b3c4d-0004-4000-8000-000000000004',
  '1a2b3c4d-0005-4000-8000-000000000005',
  '1a2b3c4d-0006-4000-8000-000000000006',
  '1a2b3c4d-0007-4000-8000-000000000007',
  '1a2b3c4d-0008-4000-8000-000000000008',
  '1a2b3c4d-0009-4000-8000-000000000009',
  '1a2b3c4d-000a-4000-8000-00000000000a',
  '1a2b3c4d-000b-4000-8000-00000000000b'
];

describe('onboarding interest validation', () => {
  it('accepts 3 to 10 unique interest ids', () => {
    expect(replaceInterestsSchema.parse({ interestIds: ids.slice(0, 3) }).interestIds).toEqual(ids.slice(0, 3));
    expect(replaceInterestsSchema.safeParse({ interestIds: ids.slice(0, 10) }).success).toBe(true);
  });

  it('rejects count, type, duplicate, and unexpected fields', () => {
    expect(replaceInterestsSchema.safeParse({ interestIds: ids.slice(0, 2) }).success).toBe(false);
    expect(replaceInterestsSchema.safeParse({ interestIds: ids.slice(0, 11) }).success).toBe(false);
    expect(replaceInterestsSchema.safeParse({ interestIds: 'not-an-array' }).success).toBe(false);
    expect(replaceInterestsSchema.safeParse({ interestIds: [...ids.slice(0, 2), 'not-a-uuid'] }).success).toBe(false);
    expect(replaceInterestsSchema.safeParse({ interestIds: [ids[0], ids[1], ids[0]] }).success).toBe(false);
    expect(replaceInterestsSchema.safeParse({ interestIds: [ids[0], ids[1], ids[0].toUpperCase()] }).success).toBe(false);
    expect(replaceInterestsSchema.safeParse({ interestIds: ids.slice(0, 3), userId: randomUUID() }).success).toBe(false);
    expect(replaceInterestsSchema.safeParse({}).success).toBe(false);
  });
});

describe('onboarding relationship intention validation', () => {
  it('accepts one or more unique intention ids', () => {
    expect(replaceRelationshipIntentionsSchema.parse({ relationshipIntentionIds: [ids[0]] }).relationshipIntentionIds).toEqual([
      ids[0]
    ]);
    expect(replaceRelationshipIntentionsSchema.safeParse({ relationshipIntentionIds: ids.slice(0, 4) }).success).toBe(true);
  });

  it('rejects an empty list, duplicates, invalid ids, and unexpected fields', () => {
    expect(replaceRelationshipIntentionsSchema.safeParse({ relationshipIntentionIds: [] }).success).toBe(false);
    expect(replaceRelationshipIntentionsSchema.safeParse({ relationshipIntentionIds: 'nope' }).success).toBe(false);
    expect(replaceRelationshipIntentionsSchema.safeParse({ relationshipIntentionIds: ['not-a-uuid'] }).success).toBe(false);
    expect(replaceRelationshipIntentionsSchema.safeParse({ relationshipIntentionIds: [ids[0], ids[0]] }).success).toBe(false);
    expect(
      replaceRelationshipIntentionsSchema.safeParse({ relationshipIntentionIds: [ids[0], ids[0].toUpperCase()] }).success
    ).toBe(false);
    expect(
      replaceRelationshipIntentionsSchema.safeParse({ relationshipIntentionIds: [ids[0]], userId: randomUUID() }).success
    ).toBe(false);
  });
});

const genderId = '9a12c4b5-8821-4122-901b-5e4d29381002';
const intentionId = '2a3b4c5d-0001-4000-8000-000000000001';

function datingPreferences(overrides: Record<string, unknown> = {}) {
  return {
    minAge: 22,
    maxAge: 32,
    maxDistanceKm: 40,
    interestedInGenderIds: [genderId],
    preferredIntentionIds: [intentionId],
    ...overrides
  };
}

describe('onboarding dating preference validation', () => {
  it('accepts a complete request and empty preference lists', () => {
    expect(replaceDatingPreferencesSchema.parse(datingPreferences())).toEqual(datingPreferences());
    expect(
      replaceDatingPreferencesSchema.parse(datingPreferences({ minAge: 18, maxAge: 100, maxDistanceKm: 1 })).maxDistanceKm
    ).toBe(1);
    expect(
      replaceDatingPreferencesSchema.parse(
        datingPreferences({ maxDistanceKm: 500, interestedInGenderIds: [], preferredIntentionIds: [] })
      )
    ).toMatchObject({ interestedInGenderIds: [], preferredIntentionIds: [] });
  });

  it('rejects a missing numeric field', () => {
    const { minAge: _minAge, ...withoutMinAge } = datingPreferences();
    expect(replaceDatingPreferencesSchema.safeParse(withoutMinAge).success).toBe(false);
  });

  it('rejects a minimum age below 18', () => {
    expect(replaceDatingPreferencesSchema.safeParse(datingPreferences({ minAge: 17 })).success).toBe(false);
  });

  it('rejects a maximum age above 100', () => {
    expect(replaceDatingPreferencesSchema.safeParse(datingPreferences({ maxAge: 101 })).success).toBe(false);
  });

  it('rejects a maximum age below the minimum age', () => {
    expect(replaceDatingPreferencesSchema.safeParse(datingPreferences({ minAge: 30, maxAge: 29 })).success).toBe(false);
  });

  it('rejects a distance below 1 or above 500', () => {
    expect(replaceDatingPreferencesSchema.safeParse(datingPreferences({ maxDistanceKm: 0 })).success).toBe(false);
    expect(replaceDatingPreferencesSchema.safeParse(datingPreferences({ maxDistanceKm: 501 })).success).toBe(false);
  });

  it('rejects a malformed gender or intention id', () => {
    expect(replaceDatingPreferencesSchema.safeParse(datingPreferences({ interestedInGenderIds: ['not-a-uuid'] })).success).toBe(
      false
    );
    expect(
      replaceDatingPreferencesSchema.safeParse(datingPreferences({ preferredIntentionIds: ['not-a-uuid'] })).success
    ).toBe(false);
  });

  it('rejects duplicate gender or intention ids', () => {
    expect(
      replaceDatingPreferencesSchema.safeParse(datingPreferences({ interestedInGenderIds: [genderId, genderId.toUpperCase()] }))
        .success
    ).toBe(false);
    expect(
      replaceDatingPreferencesSchema.safeParse(
        datingPreferences({ preferredIntentionIds: [intentionId, intentionId.toUpperCase()] })
      ).success
    ).toBe(false);
  });

  it('rejects an unexpected field', () => {
    expect(replaceDatingPreferencesSchema.safeParse(datingPreferences({ userId: randomUUID() })).success).toBe(false);
    expect(replaceDatingPreferencesSchema.safeParse(datingPreferences({ isProfileComplete: true })).success).toBe(false);
    expect(replaceDatingPreferencesSchema.safeParse(datingPreferences({ relationshipIntentions: [intentionId] })).success).toBe(
      false
    );
  });
});

function location(overrides: Record<string, unknown> = {}) {
  return {
    city: 'Bengaluru',
    latitude: 12.9716,
    longitude: 77.5946,
    ...overrides
  };
}

describe('onboarding location validation', () => {
  it('accepts a trimmed city and boundary coordinates', () => {
    expect(saveLocationSchema.parse(location({ city: '  Bengaluru  ' }))).toEqual(location());
    expect(saveLocationSchema.parse(location({ city: 'A' })).city).toBe('A');
    expect(saveLocationSchema.parse(location({ city: 'B'.repeat(100) })).city).toBe('B'.repeat(100));
    expect(saveLocationSchema.safeParse(location({ latitude: -90, longitude: -180 })).success).toBe(true);
    expect(saveLocationSchema.safeParse(location({ latitude: 90, longitude: 180 })).success).toBe(true);
  });

  it('rejects an empty, whitespace-only, or overlong city', () => {
    expect(saveLocationSchema.safeParse(location({ city: '' })).success).toBe(false);
    expect(saveLocationSchema.safeParse(location({ city: '   ' })).success).toBe(false);
    expect(saveLocationSchema.safeParse(location({ city: 'C'.repeat(101) })).success).toBe(false);
  });

  it('rejects coordinates outside the valid range', () => {
    expect(saveLocationSchema.safeParse(location({ latitude: -90.0001 })).success).toBe(false);
    expect(saveLocationSchema.safeParse(location({ latitude: 90.0001 })).success).toBe(false);
    expect(saveLocationSchema.safeParse(location({ longitude: -180.0001 })).success).toBe(false);
    expect(saveLocationSchema.safeParse(location({ longitude: 180.0001 })).success).toBe(false);
  });

  it('rejects non-finite and non-numeric coordinates', () => {
    expect(saveLocationSchema.safeParse(location({ latitude: '12.9716' })).success).toBe(false);
    expect(saveLocationSchema.safeParse(location({ longitude: '77.5946' })).success).toBe(false);
    expect(saveLocationSchema.safeParse(location({ latitude: Number.NaN })).success).toBe(false);
    expect(saveLocationSchema.safeParse(location({ longitude: Number.NaN })).success).toBe(false);
    expect(saveLocationSchema.safeParse(location({ latitude: Number.POSITIVE_INFINITY })).success).toBe(false);
    expect(saveLocationSchema.safeParse(location({ longitude: Number.NEGATIVE_INFINITY })).success).toBe(false);
  });

  it('rejects missing values, nulls, and unexpected fields', () => {
    expect(saveLocationSchema.safeParse({ latitude: 12.9716, longitude: 77.5946 }).success).toBe(false);
    expect(saveLocationSchema.safeParse({ city: 'Bengaluru', longitude: 77.5946 }).success).toBe(false);
    expect(saveLocationSchema.safeParse({ city: 'Bengaluru', latitude: 12.9716 }).success).toBe(false);
    expect(saveLocationSchema.safeParse(location({ city: null })).success).toBe(false);
    expect(saveLocationSchema.safeParse(location({ latitude: null })).success).toBe(false);
    expect(saveLocationSchema.safeParse(location({ longitude: null })).success).toBe(false);
    expect(saveLocationSchema.safeParse(location({ userId: randomUUID() })).success).toBe(false);
    expect(saveLocationSchema.safeParse(location({ isProfileComplete: true })).success).toBe(false);
    expect(saveLocationSchema.safeParse(location({ location: { latitude: 1, longitude: 2 } })).success).toBe(false);
    expect(saveLocationSchema.safeParse(location({ coordinates: [77.5946, 12.9716] })).success).toBe(false);
  });
});
