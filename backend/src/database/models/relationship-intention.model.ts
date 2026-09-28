import { DataTypes, Model, Optional } from 'sequelize';
import { sequelize } from '../../config/database';

export interface RelationshipIntentionAttributes {
  id: string;
  code: string;
  name: string;
  description: string | null;
  isActive: boolean;
  displayOrder: number;
  createdAt: Date;
  updatedAt: Date;
}

export type RelationshipIntentionCreationAttributes = Optional<
  RelationshipIntentionAttributes,
  'id' | 'description' | 'isActive' | 'displayOrder' | 'createdAt' | 'updatedAt'
>;

export class RelationshipIntention
  extends Model<RelationshipIntentionAttributes, RelationshipIntentionCreationAttributes>
  implements RelationshipIntentionAttributes
{
  declare id: string;
  declare code: string;
  declare name: string;
  declare description: string | null;
  declare isActive: boolean;
  declare displayOrder: number;
  declare createdAt: Date;
  declare updatedAt: Date;
}

RelationshipIntention.init(
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
      type: DataTypes.STRING(255),
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
    tableName: 'relationship_intentions',
    modelName: 'RelationshipIntention',
    timestamps: true,
    underscored: true,
    createdAt: 'created_at',
    updatedAt: 'updated_at'
  }
);
