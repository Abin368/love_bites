import { DataTypes, Model, Optional } from 'sequelize';
import { sequelize } from '../../config/database';

export type MatchStatus = 'ACTIVE' | 'UNMATCHED' | 'UNDONE';

export interface MatchAttributes {
  id: string;
  userOneId: string;
  userTwoId: string;
  status: MatchStatus;
  matchedAt: Date;
  unmatchedAt: Date | null;
  unmatchedByUserId: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export type MatchCreationAttributes = Optional<
  MatchAttributes,
  'id' | 'status' | 'matchedAt' | 'unmatchedAt' | 'unmatchedByUserId' | 'createdAt' | 'updatedAt'
>;

export class Match extends Model<MatchAttributes, MatchCreationAttributes> implements MatchAttributes {
  declare id: string;
  declare userOneId: string;
  declare userTwoId: string;
  declare status: MatchStatus;
  declare matchedAt: Date;
  declare unmatchedAt: Date | null;
  declare unmatchedByUserId: string | null;
  declare createdAt: Date;
  declare updatedAt: Date;
}

Match.init(
  {
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true,
      allowNull: false
    },
    userOneId: {
      type: DataTypes.UUID,
      allowNull: false
    },
    userTwoId: {
      type: DataTypes.UUID,
      allowNull: false
    },
    status: {
      type: DataTypes.STRING(20),
      allowNull: false,
      defaultValue: 'ACTIVE'
    },
    matchedAt: {
      type: DataTypes.DATE,
      allowNull: false,
      defaultValue: DataTypes.NOW
    },
    unmatchedAt: {
      type: DataTypes.DATE,
      allowNull: true
    },
    unmatchedByUserId: {
      type: DataTypes.UUID,
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
    tableName: 'matches',
    modelName: 'Match',
    timestamps: true,
    underscored: true,
    createdAt: 'created_at',
    updatedAt: 'updated_at'
  }
);
