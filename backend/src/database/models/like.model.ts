import { DataTypes, Model, Optional } from 'sequelize';
import { sequelize } from '../../config/database';

export type LikeAction = 'LIKE' | 'PASS' | 'SUPER_LIKE';

export interface LikeAttributes {
  id: string;
  fromUserId: string;
  toUserId: string;
  action: LikeAction;
  isUndone: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export type LikeCreationAttributes = Optional<LikeAttributes, 'id' | 'isUndone' | 'createdAt' | 'updatedAt'>;

export class Like extends Model<LikeAttributes, LikeCreationAttributes> implements LikeAttributes {
  declare id: string;
  declare fromUserId: string;
  declare toUserId: string;
  declare action: LikeAction;
  declare isUndone: boolean;
  declare createdAt: Date;
  declare updatedAt: Date;
}

Like.init(
  {
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true,
      allowNull: false
    },
    fromUserId: {
      type: DataTypes.UUID,
      allowNull: false
    },
    toUserId: {
      type: DataTypes.UUID,
      allowNull: false
    },
    action: {
      type: DataTypes.STRING(20),
      allowNull: false
    },
    isUndone: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: false
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
    tableName: 'likes',
    modelName: 'Like',
    timestamps: true,
    underscored: true,
    createdAt: 'created_at',
    updatedAt: 'updated_at'
  }
);
