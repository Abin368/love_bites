import { DataTypes, Model, Optional } from 'sequelize';
import { sequelize } from '../../config/database';

export interface BoostSessionAttributes {
  id: string;
  userId: string;
  multiplier: string;
  startedAt: Date;
  expiresAt: Date;
  isActive: boolean;
  createdAt: Date;
}

export type BoostSessionCreationAttributes = Optional<
  BoostSessionAttributes,
  'id' | 'multiplier' | 'startedAt' | 'isActive' | 'createdAt'
>;

export class BoostSession
  extends Model<BoostSessionAttributes, BoostSessionCreationAttributes>
  implements BoostSessionAttributes
{
  declare id: string;
  declare userId: string;
  declare multiplier: string;
  declare startedAt: Date;
  declare expiresAt: Date;
  declare isActive: boolean;
  declare createdAt: Date;
}

BoostSession.init(
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
    multiplier: {
      type: DataTypes.DECIMAL(4, 2),
      allowNull: false,
      defaultValue: '2.00'
    },
    startedAt: {
      type: DataTypes.DATE,
      allowNull: false,
      defaultValue: DataTypes.NOW
    },
    expiresAt: {
      type: DataTypes.DATE,
      allowNull: false
    },
    isActive: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: true
    },
    createdAt: {
      type: DataTypes.DATE,
      allowNull: false
    }
  },
  {
    sequelize,
    tableName: 'boost_sessions',
    modelName: 'BoostSession',
    timestamps: true,
    underscored: true,
    createdAt: 'created_at',
    updatedAt: false
  }
);
