import { DataTypes, Model, Optional } from 'sequelize';
import { sequelize } from '../../config/database';

export type PaymentStatus = 'INITIATED' | 'AUTHORIZED' | 'CAPTURED' | 'FAILED' | 'REFUNDED';
export type PaymentType = 'SUBSCRIPTION_INITIAL' | 'SUBSCRIPTION_RECURRING' | 'CREDIT_PURCHASE';

export interface PaymentAttributes {
  id: string;
  userId: string | null;
  subscriptionId: string | null;
  provider: string;
  providerPaymentId: string | null;
  providerOrderId: string | null;
  amountInCents: number;
  currency: string;
  status: PaymentStatus;
  paymentType: PaymentType;
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
  | 'provider'
  | 'providerPaymentId'
  | 'providerOrderId'
  | 'currency'
  | 'status'
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
  declare provider: string;
  declare providerPaymentId: string | null;
  declare providerOrderId: string | null;
  declare amountInCents: number;
  declare currency: string;
  declare status: PaymentStatus;
  declare paymentType: PaymentType;
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
    status: {
      type: DataTypes.STRING(30),
      allowNull: false,
      defaultValue: 'INITIATED'
    },
    paymentType: {
      type: DataTypes.STRING(30),
      allowNull: false
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
