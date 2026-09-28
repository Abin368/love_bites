import { DataTypes, Model, Optional } from 'sequelize';
import { sequelize } from '../../config/database';

export type CreditTransactionReason =
  | 'MONTHLY_GRANT'
  | 'PURCHASE'
  | 'CONSUMPTION'
  | 'ADMIN_ADJUSTMENT'
  | 'REFUND';

export interface CreditTransactionAttributes {
  id: string;
  userId: string;
  creditType: string;
  delta: number;
  reason: CreditTransactionReason;
  referenceId: string | null;
  createdAt: Date;
}

export type CreditTransactionCreationAttributes = Optional<
  CreditTransactionAttributes,
  'id' | 'referenceId' | 'createdAt'
>;

export class CreditTransaction
  extends Model<CreditTransactionAttributes, CreditTransactionCreationAttributes>
  implements CreditTransactionAttributes
{
  declare id: string;
  declare userId: string;
  declare creditType: string;
  declare delta: number;
  declare reason: CreditTransactionReason;
  declare referenceId: string | null;
  declare createdAt: Date;
}

CreditTransaction.init(
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
    creditType: {
      type: DataTypes.STRING(50),
      allowNull: false
    },
    delta: {
      type: DataTypes.INTEGER,
      allowNull: false
    },
    reason: {
      type: DataTypes.STRING(50),
      allowNull: false
    },
    referenceId: {
      type: DataTypes.STRING(255),
      allowNull: true
    },
    createdAt: {
      type: DataTypes.DATE,
      allowNull: false
    }
  },
  {
    sequelize,
    tableName: 'credit_transactions',
    modelName: 'CreditTransaction',
    timestamps: true,
    underscored: true,
    createdAt: 'created_at',
    updatedAt: false
  }
);
