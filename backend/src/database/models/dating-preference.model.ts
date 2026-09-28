import { DataTypes, Model, Optional } from 'sequelize';
import { sequelize } from '../../config/database';

export interface DatingPreferenceAttributes {
  id: string;
  userId: string;
  minAge: number;
  maxAge: number;
  maxDistanceKm: number;
  createdAt: Date;
  updatedAt: Date;
}

export type DatingPreferenceCreationAttributes = Optional<
  DatingPreferenceAttributes,
  'id' | 'minAge' | 'maxAge' | 'maxDistanceKm' | 'createdAt' | 'updatedAt'
>;

export class DatingPreference
  extends Model<DatingPreferenceAttributes, DatingPreferenceCreationAttributes>
  implements DatingPreferenceAttributes
{
  declare id: string;
  declare userId: string;
  declare minAge: number;
  declare maxAge: number;
  declare maxDistanceKm: number;
  declare createdAt: Date;
  declare updatedAt: Date;
}

DatingPreference.init(
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
    minAge: {
      type: DataTypes.SMALLINT,
      allowNull: false,
      defaultValue: 18
    },
    maxAge: {
      type: DataTypes.SMALLINT,
      allowNull: false,
      defaultValue: 100
    },
    maxDistanceKm: {
      type: DataTypes.INTEGER,
      allowNull: false,
      defaultValue: 50
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
    tableName: 'dating_preferences',
    modelName: 'DatingPreference',
    timestamps: true,
    underscored: true,
    createdAt: 'created_at',
    updatedAt: 'updated_at'
  }
);
