import { DataTypes, Model, Optional } from 'sequelize';
import { sequelize } from '../../config/database';

export interface BlockAttributes {
  id: string;
  blockerId: string;
  blockedId: string;
  reason: string | null;
  createdAt: Date;
}

export type BlockCreationAttributes = Optional<BlockAttributes, 'id' | 'reason' | 'createdAt'>;

export class Block extends Model<BlockAttributes, BlockCreationAttributes> implements BlockAttributes {
  declare id: string;
  declare blockerId: string;
  declare blockedId: string;
  declare reason: string | null;
  declare createdAt: Date;
}

Block.init(
  {
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true,
      allowNull: false
    },
    blockerId: {
      type: DataTypes.UUID,
      allowNull: false
    },
    blockedId: {
      type: DataTypes.UUID,
      allowNull: false
    },
    reason: {
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
    tableName: 'blocks',
    modelName: 'Block',
    timestamps: true,
    underscored: true,
    createdAt: 'created_at',
    updatedAt: false
  }
);
