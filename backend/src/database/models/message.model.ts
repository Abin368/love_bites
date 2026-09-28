import { DataTypes, Model, Optional } from 'sequelize';
import { sequelize } from '../../config/database';

export type MessageType = 'TEXT' | 'IMAGE' | 'GIF' | 'VIDEO' | 'VOICE';

export interface MessageAttributes {
  id: string;
  conversationId: string;
  senderId: string;
  messageType: MessageType;
  content: string | null;
  mediaStorageKey: string | null;
  mediaMimeType: string | null;
  mediaFileSize: number | null;
  readAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  deletedAt: Date | null;
}

export type MessageCreationAttributes = Optional<
  MessageAttributes,
  | 'id'
  | 'messageType'
  | 'content'
  | 'mediaStorageKey'
  | 'mediaMimeType'
  | 'mediaFileSize'
  | 'readAt'
  | 'createdAt'
  | 'updatedAt'
  | 'deletedAt'
>;

export class Message extends Model<MessageAttributes, MessageCreationAttributes> implements MessageAttributes {
  declare id: string;
  declare conversationId: string;
  declare senderId: string;
  declare messageType: MessageType;
  declare content: string | null;
  declare mediaStorageKey: string | null;
  declare mediaMimeType: string | null;
  declare mediaFileSize: number | null;
  declare readAt: Date | null;
  declare createdAt: Date;
  declare updatedAt: Date;
  declare deletedAt: Date | null;
}

Message.init(
  {
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true,
      allowNull: false
    },
    conversationId: {
      type: DataTypes.UUID,
      allowNull: false
    },
    senderId: {
      type: DataTypes.UUID,
      allowNull: false
    },
    messageType: {
      type: DataTypes.STRING(20),
      allowNull: false,
      defaultValue: 'TEXT'
    },
    content: {
      type: DataTypes.TEXT,
      allowNull: true
    },
    mediaStorageKey: {
      type: DataTypes.STRING(512),
      allowNull: true
    },
    mediaMimeType: {
      type: DataTypes.STRING(50),
      allowNull: true
    },
    mediaFileSize: {
      type: DataTypes.INTEGER,
      allowNull: true
    },
    readAt: {
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
    },
    deletedAt: {
      type: DataTypes.DATE,
      allowNull: true
    }
  },
  {
    sequelize,
    tableName: 'messages',
    modelName: 'Message',
    timestamps: true,
    underscored: true,
    paranoid: true,
    createdAt: 'created_at',
    updatedAt: 'updated_at',
    deletedAt: 'deleted_at'
  }
);
