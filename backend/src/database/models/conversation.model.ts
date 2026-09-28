import { DataTypes, Model, Optional } from 'sequelize';
import { sequelize } from '../../config/database';

export type ConversationStatus = 'ACTIVE' | 'CLOSED';

export interface ConversationAttributes {
  id: string;
  matchId: string;
  status: ConversationStatus;
  lastMessageAt: Date | null;
  closedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export type ConversationCreationAttributes = Optional<
  ConversationAttributes,
  'id' | 'status' | 'lastMessageAt' | 'closedAt' | 'createdAt' | 'updatedAt'
>;

export class Conversation
  extends Model<ConversationAttributes, ConversationCreationAttributes>
  implements ConversationAttributes
{
  declare id: string;
  declare matchId: string;
  declare status: ConversationStatus;
  declare lastMessageAt: Date | null;
  declare closedAt: Date | null;
  declare createdAt: Date;
  declare updatedAt: Date;
}

Conversation.init(
  {
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true,
      allowNull: false
    },
    matchId: {
      type: DataTypes.UUID,
      allowNull: false
    },
    status: {
      type: DataTypes.STRING(20),
      allowNull: false,
      defaultValue: 'ACTIVE'
    },
    lastMessageAt: {
      type: DataTypes.DATE,
      allowNull: true
    },
    closedAt: {
      type: DataTypes.DATE,
      allowNull: true
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
    tableName: 'conversations',
    modelName: 'Conversation',
    timestamps: true,
    underscored: true,
    createdAt: 'created_at',
    updatedAt: 'updated_at'
  }
);
