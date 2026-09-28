import { DataTypes, Model, Optional } from 'sequelize';
import { sequelize } from '../../config/database';

export interface UserDatingPreferenceGenderAttributes {
  id: string;
  userId: string;
  genderId: string;
  createdAt: Date;
}

export type UserDatingPreferenceGenderCreationAttributes = Optional<
  UserDatingPreferenceGenderAttributes,
  'id' | 'createdAt'
>;

export class UserDatingPreferenceGender
  extends Model<UserDatingPreferenceGenderAttributes, UserDatingPreferenceGenderCreationAttributes>
  implements UserDatingPreferenceGenderAttributes
{
  declare id: string;
  declare userId: string;
  declare genderId: string;
  declare createdAt: Date;
}

UserDatingPreferenceGender.init(
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
    genderId: {
      type: DataTypes.UUID,
      allowNull: false
    },
    createdAt: {
      type: DataTypes.DATE,
      allowNull: false
    }
  },
  {
    sequelize,
    tableName: 'user_dating_preference_genders',
    modelName: 'UserDatingPreferenceGender',
    timestamps: true,
    underscored: true,
    createdAt: 'created_at',
    updatedAt: false
  }
);
