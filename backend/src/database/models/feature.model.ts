import { DataTypes, Model, Optional } from 'sequelize';
import { sequelize } from '../../config/database';

export interface FeatureAttributes {
  id: string;
  code: string;
  name: string;
  description: string | null;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export type FeatureCreationAttributes = Optional<
  FeatureAttributes,
  'id' | 'description' | 'isActive' | 'createdAt' | 'updatedAt'
>;

export class Feature extends Model<FeatureAttributes, FeatureCreationAttributes> implements FeatureAttributes {
  declare id: string;
  declare code: string;
  declare name: string;
  declare description: string | null;
  declare isActive: boolean;
  declare createdAt: Date;
  declare updatedAt: Date;
}

Feature.init(
  {
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true,
      allowNull: false
    },
    code: {
      type: DataTypes.STRING(50),
      allowNull: false
    },
    name: {
      type: DataTypes.STRING(100),
      allowNull: false
    },
    description: {
      type: DataTypes.TEXT,
      allowNull: true
    },
    isActive: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: true
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
    tableName: 'features',
    modelName: 'Feature',
    timestamps: true,
    underscored: true,
    createdAt: 'created_at',
    updatedAt: 'updated_at'
  }
);
