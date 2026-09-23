import { DataTypes, Model, Optional } from 'sequelize';
import { sequelize } from '../../config/database';

export type UsagePeriodType = 'DAILY' | 'MONTHLY' | 'LIFETIME';

export interface UsageLimitAttributes {
  id: string;
  planId: string;
  metricKey: string;
  limitValue: number;
  periodType: UsagePeriodType;
  createdAt: Date;
  updatedAt: Date;
}

export type UsageLimitCreationAttributes = Optional<
  UsageLimitAttributes,
  'id' | 'periodType' | 'createdAt' | 'updatedAt'
>;

export class UsageLimit
  extends Model<UsageLimitAttributes, UsageLimitCreationAttributes>
  implements UsageLimitAttributes
{
  declare id: string;
  declare planId: string;
  declare metricKey: string;
  declare limitValue: number;
  declare periodType: UsagePeriodType;
  declare createdAt: Date;
  declare updatedAt: Date;
}

UsageLimit.init(
  {
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true,
      allowNull: false
    },
    planId: {
      type: DataTypes.UUID,
      allowNull: false
    },
    metricKey: {
      type: DataTypes.STRING(50),
      allowNull: false
    },
    limitValue: {
      type: DataTypes.INTEGER,
      allowNull: false
    },
    periodType: {
      type: DataTypes.STRING(20),
      allowNull: false,
      defaultValue: 'DAILY'
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
    tableName: 'usage_limits',
    modelName: 'UsageLimit',
    timestamps: true,
    underscored: true,
    createdAt: 'created_at',
    updatedAt: 'updated_at'
  }
);
