import { DataTypes, Model, Optional } from 'sequelize';
import { sequelize } from '../../config/database';

export interface AuthRefreshTokenAttributes {
  id: string;
  userId: string;
  tokenHash: string;
  deviceInfo: string | null;
  ipAddress: string | null;
  expiresAt: Date;
  revokedAt: Date | null;
  replacedByHash: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export type AuthRefreshTokenCreationAttributes = Optional<
  AuthRefreshTokenAttributes,
  'id' | 'deviceInfo' | 'ipAddress' | 'revokedAt' | 'replacedByHash' | 'createdAt' | 'updatedAt'
>;

export class AuthRefreshToken
  extends Model<AuthRefreshTokenAttributes, AuthRefreshTokenCreationAttributes>
  implements AuthRefreshTokenAttributes
{
  declare id: string;
  declare userId: string;
  declare tokenHash: string;
  declare deviceInfo: string | null;
  declare ipAddress: string | null;
  declare expiresAt: Date;
  declare revokedAt: Date | null;
  declare replacedByHash: string | null;
  declare createdAt: Date;
  declare updatedAt: Date;
}

AuthRefreshToken.init(
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
    tokenHash: {
      type: DataTypes.STRING(255),
      allowNull: false
    },
    deviceInfo: {
      type: DataTypes.STRING(255),
      allowNull: true
    },
    ipAddress: {
      type: DataTypes.STRING(45),
      allowNull: true
    },
    expiresAt: {
      type: DataTypes.DATE,
      allowNull: false
    },
    revokedAt: {
      type: DataTypes.DATE,
      allowNull: true
    },
    replacedByHash: {
      type: DataTypes.STRING(255),
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
    tableName: 'auth_refresh_tokens',
    modelName: 'AuthRefreshToken',
    timestamps: true,
    underscored: true,
    createdAt: 'created_at',
    updatedAt: 'updated_at'
  }
);
