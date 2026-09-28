import { DataTypes, Model, Optional } from 'sequelize';
import { sequelize } from '../../config/database';

export interface InterestAttributes {
  id: string;
  code: string;
  name: string;
  category: string | null;
  isActive: boolean;
  displayOrder: number;
  createdAt: Date;
  updatedAt: Date;
}

export type InterestCreationAttributes = Optional<
  InterestAttributes,
  'id' | 'category' | 'isActive' | 'displayOrder' | 'createdAt' | 'updatedAt'
>;

export class Interest extends Model<InterestAttributes, InterestCreationAttributes> implements InterestAttributes {
  declare id: string;
  declare code: string;
  declare name: string;
  declare category: string | null;
  declare isActive: boolean;
  declare displayOrder: number;
  declare createdAt: Date;
  declare updatedAt: Date;
}

Interest.init(
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
    category: {
      type: DataTypes.STRING(50),
      allowNull: true
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
    tableName: 'interests',
    modelName: 'Interest',
    timestamps: true,
    underscored: true,
    createdAt: 'created_at',
    updatedAt: 'updated_at'
  }
);
