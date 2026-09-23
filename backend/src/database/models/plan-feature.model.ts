import { DataTypes, Model, Optional } from 'sequelize';
import { sequelize } from '../../config/database';

export interface PlanFeatureAttributes {
  id: string;
  planId: string;
  featureId: string;
  createdAt: Date;
}

export type PlanFeatureCreationAttributes = Optional<PlanFeatureAttributes, 'id' | 'createdAt'>;

export class PlanFeature
  extends Model<PlanFeatureAttributes, PlanFeatureCreationAttributes>
  implements PlanFeatureAttributes
{
  declare id: string;
  declare planId: string;
  declare featureId: string;
  declare createdAt: Date;
}

PlanFeature.init(
  {
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true,
      allowNull: false
    },
    planId: {
      type: DataTypes.UUID,
      allowNull: false
    },
    featureId: {
      type: DataTypes.UUID,
      allowNull: false
    },
    createdAt: {
      type: DataTypes.DATE,
      allowNull: false
    }
  },
  {
    sequelize,
    tableName: 'plan_features',
    modelName: 'PlanFeature',
    timestamps: true,
    underscored: true,
    createdAt: 'created_at',
    updatedAt: false
  }
);
