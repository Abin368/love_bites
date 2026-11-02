import { DataTypes, Model, Optional } from 'sequelize';
import { sequelize } from '../../config/database';

export const PLAN_PRICE_CHANGE_ACTION = 'PLAN_PRICE_CHANGED';

export interface PlanPriceChangeAttributes {
  id: string;
  adminUserId: string | null;
  planId: string;
  oldPriceInCents: number;
  newPriceInCents: number;
  oldCurrency: string;
  newCurrency: string;
  action: typeof PLAN_PRICE_CHANGE_ACTION;
  reason: string;
  createdAt: Date;
}

export type PlanPriceChangeCreationAttributes = Optional<PlanPriceChangeAttributes, 'id' | 'adminUserId' | 'action' | 'createdAt'>;

export class PlanPriceChange
  extends Model<PlanPriceChangeAttributes, PlanPriceChangeCreationAttributes>
  implements PlanPriceChangeAttributes
{
  declare id: string;
  declare adminUserId: string | null;
  declare planId: string;
  declare oldPriceInCents: number;
  declare newPriceInCents: number;
  declare oldCurrency: string;
  declare newCurrency: string;
  declare action: typeof PLAN_PRICE_CHANGE_ACTION;
  declare reason: string;
  declare createdAt: Date;
}

PlanPriceChange.init(
  {
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true,
      allowNull: false
    },
    adminUserId: {
      type: DataTypes.UUID,
      allowNull: true
    },
    planId: {
      type: DataTypes.UUID,
      allowNull: false
    },
    oldPriceInCents: {
      type: DataTypes.INTEGER,
      allowNull: false
    },
    newPriceInCents: {
      type: DataTypes.INTEGER,
      allowNull: false
    },
    oldCurrency: {
      type: DataTypes.STRING(3),
      allowNull: false
    },
    newCurrency: {
      type: DataTypes.STRING(3),
      allowNull: false
    },
    action: {
      type: DataTypes.STRING(50),
      allowNull: false,
      defaultValue: PLAN_PRICE_CHANGE_ACTION
    },
    reason: {
      type: DataTypes.TEXT,
      allowNull: false
    },
    createdAt: {
      type: DataTypes.DATE,
      allowNull: false
    }
  },
  {
    sequelize,
    tableName: 'plan_price_changes',
    modelName: 'PlanPriceChange',
    timestamps: true,
    underscored: true,
    createdAt: 'created_at',
    updatedAt: false
  }
);
