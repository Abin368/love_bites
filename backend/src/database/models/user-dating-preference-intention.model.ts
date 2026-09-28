import { DataTypes, Model, Optional } from 'sequelize';
import { sequelize } from '../../config/database';

export interface UserDatingPreferenceIntentionAttributes {
  id: string;
  userId: string;
  relationshipIntentionId: string;
  createdAt: Date;
}

export type UserDatingPreferenceIntentionCreationAttributes = Optional<
  UserDatingPreferenceIntentionAttributes,
  'id' | 'createdAt'
>;

export class UserDatingPreferenceIntention
  extends Model<UserDatingPreferenceIntentionAttributes, UserDatingPreferenceIntentionCreationAttributes>
  implements UserDatingPreferenceIntentionAttributes
{
  declare id: string;
  declare userId: string;
  declare relationshipIntentionId: string;
  declare createdAt: Date;
}

UserDatingPreferenceIntention.init(
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
    relationshipIntentionId: {
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
    tableName: 'user_dating_preference_intentions',
    modelName: 'UserDatingPreferenceIntention',
    timestamps: true,
    underscored: true,
    createdAt: 'created_at',
    updatedAt: false
  }
);
