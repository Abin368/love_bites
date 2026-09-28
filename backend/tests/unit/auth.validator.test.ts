import { isAtLeast18, passwordSchema, registerSchema } from '../../src/modules/auth/auth.validator';

const adult = {
  email: 'Alex.Morgan@Example.com',
  password: 'SecurePassword123!',
  dateOfBirth: '2000-01-15',
  termsAccepted: true,
  privacyAccepted: true
};

describe('auth validation', () => {
  it('enforces the 18-year age boundary in UTC', () => {
    const now = new Date('2026-09-24T15:00:00.000Z');
    expect(isAtLeast18('2008-09-24', now)).toBe(true);
    expect(isAtLeast18('2008-09-25', now)).toBe(false);
    expect(isAtLeast18('2008-09-23', now)).toBe(true);
  });

  it('accepts a strong password and rejects weak ones', () => {
    expect(passwordSchema.safeParse('SecurePassword123!').success).toBe(true);
    expect(passwordSchema.safeParse('short1!').success).toBe(false);
    expect(passwordSchema.safeParse('nouppercase1!').success).toBe(false);
    expect(passwordSchema.safeParse('NoDigits!!').success).toBe(false);
    expect(passwordSchema.safeParse('NoSpecial1A').success).toBe(false);
    expect(passwordSchema.safeParse(`${'A'.repeat(127)}1!`).success).toBe(false);
  });

  it('requires email or phone, normalises email, and strips unknown fields', () => {
    const parsed = registerSchema.parse({ ...adult, role: 'ADMIN' });
    expect(parsed.email).toBe('alex.morgan@example.com');
    expect(parsed).not.toHaveProperty('role');

    expect(registerSchema.safeParse({ ...adult, email: undefined, phone: '+919876543210' }).success).toBe(true);
    expect(registerSchema.safeParse({ ...adult, email: undefined }).success).toBe(false);
  });

  it('requires both legal flags to be exactly true', () => {
    expect(registerSchema.safeParse({ ...adult, termsAccepted: false }).success).toBe(false);
    expect(registerSchema.safeParse({ ...adult, privacyAccepted: false }).success).toBe(false);
    expect(registerSchema.safeParse({ ...adult, termsAccepted: 'true' }).success).toBe(false);
  });

  it('marks underage dates for a 422 response', () => {
    const result = registerSchema.safeParse({ ...adult, dateOfBirth: '2015-01-01' });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.some((issue) => 'params' in issue && issue.params?.errorCode === 'UNDERAGE_NOT_PERMITTED')).toBe(true);
    }
  });
});
