import { DataTypes, Model, Optional } from 'sequelize';
import { sequelize } from '../../config/database';

export interface GenderAttributes {
  id: string;
  code: string;
  name: string;
  isActive: boolean;
  displayOrder: number;
  createdAt: Date;
  updatedAt: Date;
}

export type GenderCreationAttributes = Optional<
  GenderAttributes,
  'id' | 'isActive' | 'displayOrder' | 'createdAt' | 'updatedAt'
>;

export class Gender extends Model<GenderAttributes, GenderCreationAttributes> implements GenderAttributes {
  declare id: string;
  declare code: string;
  declare name: string;
  declare isActive: boolean;
  declare displayOrder: number;
  declare createdAt: Date;
  declare updatedAt: Date;
}

Gender.init(
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
    isActive: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: true
    },
    displayOrder: {
      type: DataTypes.SMALLINT,
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
    tableName: 'genders',
    modelName: 'Gender',
    timestamps: true,
    underscored: true,
    createdAt: true,
    updatedAt: true,
  }
);
