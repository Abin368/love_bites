import { DataTypes, Model, Optional } from 'sequelize';
import { sequelize } from '../../config/database';

export interface ProfileAttributes {
  id: string;
  userId: string;
  firstName: string;
  dateOfBirth: string;
  genderId: string;
  bio: string | null;
  occupation: string | null;
  education: string | null;
  city: string;
  location: unknown;
  isProfileComplete: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export type ProfileCreationAttributes = Optional<
  ProfileAttributes,
  'id' | 'bio' | 'occupation' | 'education' | 'isProfileComplete' | 'createdAt' | 'updatedAt'
>;

export class Profile extends Model<ProfileAttributes, ProfileCreationAttributes> implements ProfileAttributes {
  declare id: string;
  declare userId: string;
  declare firstName: string;
  declare dateOfBirth: string;
  declare genderId: string;
  declare bio: string | null;
  declare occupation: string | null;
  declare education: string | null;
  declare city: string;
  declare location: unknown;
  declare isProfileComplete: boolean;
  declare createdAt: Date;
  declare updatedAt: Date;
}

Profile.init(
  {
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true,
      allowNull: false
    },
    userId: {
      type: DataTypes.UUID,
      allowNull: false
    },
    firstName: {
      type: DataTypes.STRING(100),
      allowNull: false
    },
    dateOfBirth: {
      type: DataTypes.DATEONLY,
      allowNull: false
    },
    genderId: {
      type: DataTypes.UUID,
      allowNull: false
    },
    bio: {
      type: DataTypes.TEXT,
      allowNull: true
    },
    occupation: {
      type: DataTypes.STRING(100),
      allowNull: true
    },
    education: {
      type: DataTypes.STRING(100),
      allowNull: true
    },
    city: {
      type: DataTypes.STRING(100),
      allowNull: false
    },
    location: {
      type: DataTypes.GEOGRAPHY('POINT', 4326),
      allowNull: false
    },
    isProfileComplete: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: false
    },
    createdAt: {
      type: DataTypes.DATE,
      allowNull: false
    },
    updatedAt: {
      type: DataTypes.DATE,
      allowNull: false
    }
  },
  {
    sequelize,
    tableName: 'profiles',
    modelName: 'Profile',
    timestamps: true,
    underscored: true,
    createdAt: 'created_at',
    updatedAt: 'updated_at'
  }
);
