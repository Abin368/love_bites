import { DataTypes, Model, Optional } from 'sequelize';
import { sequelize } from '../../config/database';

export type PlanBillingInterval = 'NONE' | 'MONTH' | 'YEAR';

export interface PlanAttributes {
  id: string;
  code: string;
  name: string;
  billingInterval: PlanBillingInterval;
  priceInCents: number;
  currency: string;
  isActive: boolean;
  displayOrder: number;
  createdAt: Date;
  updatedAt: Date;
}

export type PlanCreationAttributes = Optional<
  PlanAttributes,
  'id' | 'billingInterval' | 'priceInCents' | 'currency' | 'isActive' | 'displayOrder' | 'createdAt' | 'updatedAt'
>;

export class Plan extends Model<PlanAttributes, PlanCreationAttributes> implements PlanAttributes {
  declare id: string;
  declare code: string;
  declare name: string;
  declare billingInterval: PlanBillingInterval;
  declare priceInCents: number;
  declare currency: string;
  declare isActive: boolean;
  declare displayOrder: number;
  declare createdAt: Date;
  declare updatedAt: Date;
}

Plan.init(
  {
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true,
      allowNull: false
    },
    code: {
      type: DataTypes.STRING(50),
      allowNull: false
    },
    name: {
      type: DataTypes.STRING(100),
      allowNull: false
    },
    billingInterval: {
      type: DataTypes.STRING(20),
      allowNull: false,
      defaultValue: 'NONE'
    },
    priceInCents: {
      type: DataTypes.INTEGER,
      allowNull: false,
      defaultValue: 0
    },
    currency: {
      type: DataTypes.STRING(3),
      allowNull: false,
      defaultValue: 'INR'
    },
    isActive: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: true
    },
    displayOrder: {
      type: DataTypes.SMALLINT,
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
    tableName: 'plans',
    modelName: 'Plan',
    timestamps: true,
    underscored: true,
    createdAt: 'created_at',
    updatedAt: 'updated_at'
  }
);
