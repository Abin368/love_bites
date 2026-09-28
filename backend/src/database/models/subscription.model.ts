import { DataTypes, Model, Optional } from 'sequelize';
import { sequelize } from '../../config/database';

export type SubscriptionStatus = 'ACTIVE' | 'PAST_DUE' | 'GRACE_PERIOD' | 'CANCELED' | 'EXPIRED';

export interface SubscriptionAttributes {
  id: string;
  userId: string;
  planId: string;
  provider: string;
  providerSubscriptionId: string | null;
  providerCustomerId: string | null;
  status: SubscriptionStatus;
  autoRenew: boolean;
  currentPeriodStart: Date;
  currentPeriodEnd: Date;
  gracePeriodEnd: Date | null;
  canceledAt: Date | null;
  endedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export type SubscriptionCreationAttributes = Optional<
  SubscriptionAttributes,
  | 'id'
  | 'provider'
  | 'providerSubscriptionId'
  | 'providerCustomerId'
  | 'status'
  | 'autoRenew'
  | 'gracePeriodEnd'
  | 'canceledAt'
  | 'endedAt'
  | 'createdAt'
  | 'updatedAt'
>;

export class Subscription
  extends Model<SubscriptionAttributes, SubscriptionCreationAttributes>
  implements SubscriptionAttributes
{
  declare id: string;
  declare userId: string;
  declare planId: string;
  declare provider: string;
  declare providerSubscriptionId: string | null;
  declare providerCustomerId: string | null;
  declare status: SubscriptionStatus;
  declare autoRenew: boolean;
  declare currentPeriodStart: Date;
  declare currentPeriodEnd: Date;
  declare gracePeriodEnd: Date | null;
  declare canceledAt: Date | null;
  declare endedAt: Date | null;
  declare createdAt: Date;
  declare updatedAt: Date;
}

Subscription.init(
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
    planId: {
      type: DataTypes.UUID,
      allowNull: false
    },
    provider: {
      type: DataTypes.STRING(50),
      allowNull: false,
      defaultValue: 'RAZORPAY'
    },
    providerSubscriptionId: {
      type: DataTypes.STRING(255),
      allowNull: true
    },
    providerCustomerId: {
      type: DataTypes.STRING(255),
      allowNull: true
    },
    status: {
      type: DataTypes.STRING(30),
      allowNull: false,
      defaultValue: 'ACTIVE'
    },
    autoRenew: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: true
    },
    currentPeriodStart: {
      type: DataTypes.DATE,
      allowNull: false
    },
    currentPeriodEnd: {
      type: DataTypes.DATE,
      allowNull: false
    },
    gracePeriodEnd: {
      type: DataTypes.DATE,
      allowNull: true
    },
    canceledAt: {
      type: DataTypes.DATE,
      allowNull: true
    },
    endedAt: {
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
    tableName: 'subscriptions',
    modelName: 'Subscription',
    timestamps: true,
    underscored: true,
    createdAt: 'created_at',
    updatedAt: 'updated_at'
  }
);
