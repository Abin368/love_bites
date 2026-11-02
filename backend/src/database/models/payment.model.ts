import { DataTypes, Model, Optional } from 'sequelize';
import { sequelize } from '../../config/database';

export type PaymentStatus = 'INITIATED' | 'AUTHORIZED' | 'CAPTURED' | 'FAILED' | 'REFUNDED';
export type PaymentType = 'SUBSCRIPTION_INITIAL' | 'SUBSCRIPTION_RECURRING' | 'CREDIT_PURCHASE';
export type PaymentBillingInterval = 'MONTH' | 'YEAR';

export interface PaymentAttributes {
  id: string;
  userId: string | null;
  subscriptionId: string | null;
  planId: string | null;
  provider: string;
  providerPaymentId: string | null;
  providerOrderId: string | null;
  amountInCents: number;
  currency: string;
  billingInterval: PaymentBillingInterval | null;
  status: PaymentStatus;
  paymentType: PaymentType;
  idempotencyKey: string | null;
  rawPayload: Record<string, unknown> | null;
  failureReason: string | null;
  paidAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export type PaymentCreationAttributes = Optional<
  PaymentAttributes,
  | 'id'
  | 'userId'
  | 'subscriptionId'
  | 'planId'
  | 'provider'
  | 'providerPaymentId'
  | 'providerOrderId'
  | 'currency'
  | 'billingInterval'
  | 'status'
  | 'idempotencyKey'
  | 'rawPayload'
  | 'failureReason'
  | 'paidAt'
  | 'createdAt'
  | 'updatedAt'
>;

export class Payment extends Model<PaymentAttributes, PaymentCreationAttributes> implements PaymentAttributes {
  declare id: string;
  declare userId: string | null;
  declare subscriptionId: string | null;
  declare planId: string | null;
  declare provider: string;
  declare providerPaymentId: string | null;
  declare providerOrderId: string | null;
  declare amountInCents: number;
  declare currency: string;
  declare billingInterval: PaymentBillingInterval | null;
  declare status: PaymentStatus;
  declare paymentType: PaymentType;
  declare idempotencyKey: string | null;
  declare rawPayload: Record<string, unknown> | null;
  declare failureReason: string | null;
  declare paidAt: Date | null;
  declare createdAt: Date;
  declare updatedAt: Date;
}

Payment.init(
  {
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true,
      allowNull: false
    },
    userId: {
      type: DataTypes.UUID,
      allowNull: true
    },
    subscriptionId: {
      type: DataTypes.UUID,
      allowNull: true
    },
    planId: {
      type: DataTypes.UUID,
      allowNull: true
    },
    provider: {
      type: DataTypes.STRING(50),
      allowNull: false,
      defaultValue: 'RAZORPAY'
    },
    providerPaymentId: {
      type: DataTypes.STRING(255),
      allowNull: true
    },
    providerOrderId: {
      type: DataTypes.STRING(255),
      allowNull: true
    },
    amountInCents: {
      type: DataTypes.INTEGER,
      allowNull: false
    },
    currency: {
      type: DataTypes.STRING(3),
      allowNull: false,
      defaultValue: 'INR'
    },
    billingInterval: {
      type: DataTypes.STRING(20),
      allowNull: true
    },
    status: {
      type: DataTypes.STRING(30),
      allowNull: false,
      defaultValue: 'INITIATED'
    },
    paymentType: {
      type: DataTypes.STRING(30),
      allowNull: false
    },
    idempotencyKey: {
      type: DataTypes.STRING(255),
      allowNull: true
    },
    rawPayload: {
      type: DataTypes.JSONB,
      allowNull: true
    },
    failureReason: {
      type: DataTypes.TEXT,
      allowNull: true
    },
    paidAt: {
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
    tableName: 'payments',
    modelName: 'Payment',
    timestamps: true,
    underscored: true,
    createdAt: 'created_at',
    updatedAt: 'updated_at'
  }
);
