import { DataTypes, Model, Optional } from 'sequelize';
import { sequelize } from '../../config/database';

export interface UsageRecordAttributes {
  id: string;
  userId: string;
  metricKey: string;
  periodStart: Date;
  periodEnd: Date;
  usageCount: number;
  createdAt: Date;
  updatedAt: Date;
}

export type UsageRecordCreationAttributes = Optional<UsageRecordAttributes, 'id' | 'usageCount' | 'createdAt' | 'updatedAt'>;

export class UsageRecord
  extends Model<UsageRecordAttributes, UsageRecordCreationAttributes>
  implements UsageRecordAttributes
{
  declare id: string;
  declare userId: string;
  declare metricKey: string;
  declare periodStart: Date;
  declare periodEnd: Date;
  declare usageCount: number;
  declare createdAt: Date;
  declare updatedAt: Date;
}

UsageRecord.init(
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
    metricKey: {
      type: DataTypes.STRING(50),
      allowNull: false
    },
    periodStart: {
      type: DataTypes.DATE,
      allowNull: false
    },
    periodEnd: {
      type: DataTypes.DATE,
      allowNull: false
    },
    usageCount: {
      type: DataTypes.INTEGER,
      allowNull: false,
      defaultValue: 0
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
    tableName: 'usage_records',
    modelName: 'UsageRecord',
    timestamps: true,
    underscored: true,
    createdAt: 'created_at',
    updatedAt: 'updated_at'
  }
);
