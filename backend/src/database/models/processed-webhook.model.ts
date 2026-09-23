import { DataTypes, Model, Optional } from 'sequelize';
import { sequelize } from '../../config/database';

export interface ProcessedWebhookAttributes {
  eventId: string;
  provider: string;
  eventType: string;
  payload: Record<string, unknown>;
  processedAt: Date;
}

export type ProcessedWebhookCreationAttributes = Optional<ProcessedWebhookAttributes, 'provider' | 'processedAt'>;

export class ProcessedWebhook
  extends Model<ProcessedWebhookAttributes, ProcessedWebhookCreationAttributes>
  implements ProcessedWebhookAttributes
{
  declare eventId: string;
  declare provider: string;
  declare eventType: string;
  declare payload: Record<string, unknown>;
  declare processedAt: Date;
}

ProcessedWebhook.init(
  {
    eventId: {
      type: DataTypes.STRING(255),
      primaryKey: true,
      allowNull: false
    },
    provider: {
      type: DataTypes.STRING(50),
      allowNull: false,
      defaultValue: 'RAZORPAY'
    },
    eventType: {
      type: DataTypes.STRING(100),
      allowNull: false
    },
    payload: {
      type: DataTypes.JSONB,
      allowNull: false
    },
    processedAt: {
      type: DataTypes.DATE,
      allowNull: false,
      defaultValue: DataTypes.NOW
    }
  },
  {
    sequelize,
    tableName: 'processed_webhooks',
    modelName: 'ProcessedWebhook',
    timestamps: false,
    underscored: true
  }
);
