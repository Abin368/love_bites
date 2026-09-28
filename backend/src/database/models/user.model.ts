import { DataTypes, Model, Optional } from 'sequelize';
import { sequelize } from '../../config/database';

export type UserRole = 'USER' | 'ADMIN';
export type UserStatus = 'UNVERIFIED' | 'ACTIVE' | 'SUSPENDED' | 'BANNED' | 'DELETED';

export interface UserAttributes {
  id: string;
  email: string | null;
  phone: string | null;
  passwordHash: string;
  role: UserRole;
  status: UserStatus;
  emailVerified: boolean;
  phoneVerified: boolean;
  lastActiveAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  deletedAt: Date | null;
}

export type UserCreationAttributes = Optional<
  UserAttributes,
  | 'id'
  | 'email'
  | 'phone'
  | 'role'
  | 'status'
  | 'emailVerified'
  | 'phoneVerified'
  | 'lastActiveAt'
  | 'createdAt'
  | 'updatedAt'
  | 'deletedAt'
>;

export class User extends Model<UserAttributes, UserCreationAttributes> implements UserAttributes {
  declare id: string;
  declare email: string | null;
  declare phone: string | null;
  declare passwordHash: string;
  declare role: UserRole;
  declare status: UserStatus;
  declare emailVerified: boolean;
  declare phoneVerified: boolean;
  declare lastActiveAt: Date | null;
  declare createdAt: Date;
  declare updatedAt: Date;
  declare deletedAt: Date | null;
}

User.init(
  {
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true,
      allowNull: false
    },
    email: {
      type: DataTypes.STRING(255),
      allowNull: true
    },
    phone: {
      type: DataTypes.STRING(32),
      allowNull: true
    },
    passwordHash: {
      type: DataTypes.STRING(255),
      allowNull: false
    },
    role: {
      type: DataTypes.STRING(20),
      allowNull: false,
      defaultValue: 'USER'
    },
    status: {
      type: DataTypes.STRING(20),
      allowNull: false,
      defaultValue: 'UNVERIFIED'
    },
    emailVerified: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: false
    },
    phoneVerified: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: false
    },
    lastActiveAt: {
      type: DataTypes.DATE,
      allowNull: true,
      defaultValue: DataTypes.NOW
    },
    createdAt: {
      type: DataTypes.DATE,
      allowNull: false
    },
    updatedAt: {
      type: DataTypes.DATE,
      allowNull: false
    },
    deletedAt: {
      type: DataTypes.DATE,
      allowNull: true
    }
  },
  {
    sequelize,
    tableName: 'users',
    modelName: 'User',
    timestamps: true,
    underscored: true,
    paranoid: true,
    createdAt: true,
    updatedAt: true,
    deletedAt: true,
    defaultScope: {
      attributes: {
        exclude: ['passwordHash']
      }
    }
  }
);
