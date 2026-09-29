import { createProfileSchema, updateProfileSchema } from '../../src/modules/profiles/profiles.validator';

const genderId = '9a12c4b5-8821-4122-901b-5e4d29381001';

const validCreate = {
  firstName: '  John  ',
  dateOfBirth: '1998-05-10',
  genderId,
  bio: '  Hello  ',
  occupation: 'Engineer',
  education: 'B.Tech'
};

function underage(result: ReturnType<typeof createProfileSchema.safeParse>): boolean {
  return (
    !result.success &&
    result.error.issues.some((issue) => 'params' in issue && issue.params?.errorCode === 'UNDERAGE_NOT_PERMITTED')
  );
}

describe('profile validation', () => {
  it('trims basic profile text and keeps optional fields', () => {
    const parsed = createProfileSchema.parse(validCreate);
    expect(parsed).toEqual({
      firstName: 'John',
      dateOfBirth: '1998-05-10',
      genderId,
      bio: 'Hello',
      occupation: 'Engineer',
      education: 'B.Tech'
    });
  });

  it('requires first name, date of birth, and gender id', () => {
    expect(createProfileSchema.safeParse({ dateOfBirth: '1998-05-10', genderId }).success).toBe(false);
    expect(createProfileSchema.safeParse({ firstName: 'John', genderId }).success).toBe(false);
    expect(createProfileSchema.safeParse({ firstName: 'John', dateOfBirth: '1998-05-10' }).success).toBe(false);
    expect(createProfileSchema.safeParse({ ...validCreate, firstName: '   ' }).success).toBe(false);
    expect(createProfileSchema.safeParse({ ...validCreate, genderId: 'man' }).success).toBe(false);
    expect(createProfileSchema.safeParse({ ...validCreate, dateOfBirth: '1998-02-31' }).success).toBe(false);
  });

  it('enforces documented length limits', () => {
    expect(createProfileSchema.safeParse({ ...validCreate, firstName: 'A'.repeat(100) }).success).toBe(true);
    expect(createProfileSchema.safeParse({ ...validCreate, firstName: 'A'.repeat(101) }).success).toBe(false);
    expect(createProfileSchema.safeParse({ ...validCreate, bio: 'B'.repeat(500) }).success).toBe(true);
    expect(createProfileSchema.safeParse({ ...validCreate, bio: 'B'.repeat(501) }).success).toBe(false);
    expect(createProfileSchema.safeParse({ ...validCreate, occupation: 'C'.repeat(100) }).success).toBe(true);
    expect(createProfileSchema.safeParse({ ...validCreate, occupation: 'C'.repeat(101) }).success).toBe(false);
    expect(createProfileSchema.safeParse({ ...validCreate, education: 'D'.repeat(101) }).success).toBe(false);
  });

  it('turns blank optional text into null and marks an underage date', () => {
    const parsed = createProfileSchema.parse({ ...validCreate, bio: '   ', occupation: '', education: null });
    expect(parsed.bio).toBeNull();
    expect(parsed.occupation).toBeNull();
    expect(parsed.education).toBeNull();

    expect(underage(createProfileSchema.safeParse({ ...validCreate, dateOfBirth: '2015-01-01' }))).toBe(true);
  });

  it('rejects ownership, completion, interest, and intention fields', () => {
    expect(createProfileSchema.safeParse({ ...validCreate, userId: genderId }).success).toBe(false);
    expect(createProfileSchema.safeParse({ ...validCreate, isProfileComplete: true }).success).toBe(false);
    expect(createProfileSchema.safeParse({ ...validCreate, city: 'Kochi' }).success).toBe(false);
    expect(createProfileSchema.safeParse({ ...validCreate, location: { latitude: 1, longitude: 2 } }).success).toBe(false);
    expect(createProfileSchema.safeParse({ ...validCreate, interests: [genderId] }).success).toBe(false);
    expect(createProfileSchema.safeParse({ ...validCreate, relationshipIntentions: [genderId] }).success).toBe(false);
    expect(updateProfileSchema.safeParse({ interests: [genderId] }).success).toBe(false);
    expect(updateProfileSchema.safeParse({ relationshipIntentions: [genderId], bio: 'Hi' }).success).toBe(false);
  });

  it('requires at least one field on update and still rejects an underage date', () => {
    expect(updateProfileSchema.safeParse({}).success).toBe(false);
    expect(updateProfileSchema.parse({ firstName: ' Ada ' }).firstName).toBe('Ada');
    expect(updateProfileSchema.parse({ bio: null }).bio).toBeNull();
    const underageUpdate = updateProfileSchema.safeParse({ dateOfBirth: '2015-01-01' });
    expect(underage(underageUpdate)).toBe(true);
    expect(updateProfileSchema.safeParse({ userId: genderId, firstName: 'Ada' }).success).toBe(false);
    expect(updateProfileSchema.safeParse({ isProfileComplete: false, bio: 'Hi' }).success).toBe(false);
  });
});
