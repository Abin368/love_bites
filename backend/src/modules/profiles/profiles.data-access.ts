import { Transaction } from 'sequelize';
import { sequelize } from '../../config/database';
import '../../database/associations';
import { Gender } from '../../database/models/gender.model';
import { Profile } from '../../database/models/profile.model';

export interface CreateProfileInput {
  userId: string;
  firstName: string;
  dateOfBirth: string;
  genderId: string;
  bio?: string | null;
  occupation?: string | null;
  education?: string | null;
}

export interface UpdateProfilePatch {
  firstName?: string;
  dateOfBirth?: string;
  genderId?: string;
  bio?: string | null;
  occupation?: string | null;
  education?: string | null;
}

export interface ProfileLocationUpdate {
  city: string;
  latitude: number;
  longitude: number;
}

export async function findGenderById(genderId: string, transaction?: Transaction): Promise<Gender | null> {
  return Gender.findByPk(genderId, {
    attributes: ['id', 'code', 'name', 'isActive'],
    transaction
  });
}

export async function findProfileByUserId(userId: string, transaction?: Transaction): Promise<Profile | null> {
  return Profile.findOne({
    where: { userId },
    include: [
      {
        model: Gender,
        as: 'gender',
        attributes: ['id', 'code', 'name']
      }
    ],
    transaction
  });
}

export async function createProfile(input: CreateProfileInput, transaction?: Transaction): Promise<Profile> {
  return Profile.create(
    {
      userId: input.userId,
      firstName: input.firstName,
      dateOfBirth: input.dateOfBirth,
      genderId: input.genderId,
      bio: input.bio ?? null,
      occupation: input.occupation ?? null,
      education: input.education ?? null,
      city: null,
      location: null
    },
    { transaction }
  );
}

export async function updateProfile(
  userId: string,
  patch: UpdateProfilePatch,
  transaction?: Transaction
): Promise<void> {
  const values: UpdateProfilePatch = {};

  if (patch.firstName !== undefined) {
    values.firstName = patch.firstName;
  }
  if (patch.dateOfBirth !== undefined) {
    values.dateOfBirth = patch.dateOfBirth;
  }
  if (patch.genderId !== undefined) {
    values.genderId = patch.genderId;
  }
  if (patch.bio !== undefined) {
    values.bio = patch.bio;
  }
  if (patch.occupation !== undefined) {
    values.occupation = patch.occupation;
  }
  if (patch.education !== undefined) {
    values.education = patch.education;
  }

  if (Object.keys(values).length === 0) {
    return;
  }

  await Profile.update(values, {
    where: { userId },
    transaction
  });
}

export async function markProfileComplete(userId: string): Promise<void> {
  await Profile.update({ isProfileComplete: true }, { where: { userId } });
}

export async function updateProfileLocation(
  userId: string,
  input: ProfileLocationUpdate,
  transaction?: Transaction
): Promise<void> {
  await sequelize.query(
    `UPDATE profiles
     SET city = :city,
         location = ST_SetSRID(ST_MakePoint(:longitude, :latitude), 4326)::geography,
         updated_at = CURRENT_TIMESTAMP
     WHERE user_id = :userId`,
    {
      replacements: {
        city: input.city,
        longitude: input.longitude,
        latitude: input.latitude,
        userId
      },
      transaction
    }
  );
}
