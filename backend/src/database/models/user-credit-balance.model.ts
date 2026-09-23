import { DataTypes, Model, Optional } from 'sequelize';
import { sequelize } from '../../config/database';

export interface UserCreditBalanceAttributes {
  id: string;
  userId: string;
  creditType: string;
  balance: number;
  createdAt: Date;
  updatedAt: Date;
}

export type UserCreditBalanceCreationAttributes = Optional<
  UserCreditBalanceAttributes,
  'id' | 'balance' | 'createdAt' | 'updatedAt'
>;

export class UserCreditBalance
  extends Model<UserCreditBalanceAttributes, UserCreditBalanceCreationAttributes>
  implements UserCreditBalanceAttributes
{
  declare id: string;
  declare userId: string;
  declare creditType: string;
  declare balance: number;
  declare createdAt: Date;
  declare updatedAt: Date;
}

UserCreditBalance.init(
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
    balance: {
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
    tableName: 'user_credit_balances',
    modelName: 'UserCreditBalance',
    timestamps: true,
    underscored: true,
    createdAt: 'created_at',
    updatedAt: 'updated_at'
  }
);
