import { DataTypes, Model, Optional } from 'sequelize';
import { sequelize } from '../../config/database';

export interface UserRelationshipIntentionAttributes {
  id: string;
  userId: string;
  relationshipIntentionId: string;
  createdAt: Date;
}

export type UserRelationshipIntentionCreationAttributes = Optional<
  UserRelationshipIntentionAttributes,
  'id' | 'createdAt'
>;

export class UserRelationshipIntention
  extends Model<UserRelationshipIntentionAttributes, UserRelationshipIntentionCreationAttributes>
  implements UserRelationshipIntentionAttributes
{
  declare id: string;
  declare userId: string;
  declare relationshipIntentionId: string;
  declare createdAt: Date;
}

UserRelationshipIntention.init(
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
    tableName: 'user_relationship_intentions',
    modelName: 'UserRelationshipIntention',
    timestamps: true,
    underscored: true,
    createdAt: 'created_at',
    updatedAt: false
  }
);
