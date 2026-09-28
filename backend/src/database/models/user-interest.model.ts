import { DataTypes, Model, Optional } from 'sequelize';
import { sequelize } from '../../config/database';

export interface UserInterestAttributes {
  id: string;
  userId: string;
  interestId: string;
  createdAt: Date;
}

export type UserInterestCreationAttributes = Optional<UserInterestAttributes, 'id' | 'createdAt'>;

export class UserInterest
  extends Model<UserInterestAttributes, UserInterestCreationAttributes>
  implements UserInterestAttributes
{
  declare id: string;
  declare userId: string;
  declare interestId: string;
  declare createdAt: Date;
}

UserInterest.init(
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
    interestId: {
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
    tableName: 'user_interests',
    modelName: 'UserInterest',
    timestamps: true,
    underscored: true,
    createdAt: 'created_at',
    updatedAt: false
  }
);
