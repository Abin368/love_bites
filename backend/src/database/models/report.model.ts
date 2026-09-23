import { DataTypes, Model, Optional } from 'sequelize';
import { sequelize } from '../../config/database';

export type ReportReason =
  | 'FAKE_PROFILE'
  | 'HARASSMENT'
  | 'SPAM'
  | 'INAPPROPRIATE_CONTENT'
  | 'SCAM'
  | 'OTHER';

export type ReportStatus = 'PENDING' | 'REVIEWING' | 'RESOLVED' | 'DISMISSED';

export interface ReportAttributes {
  id: string;
  reporterId: string | null;
  reportedUserId: string;
  reason: ReportReason;
  description: string | null;
  status: ReportStatus;
  adminNotes: string | null;
  resolvedById: string | null;
  resolvedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export type ReportCreationAttributes = Optional<
  ReportAttributes,
  | 'id'
  | 'reporterId'
  | 'description'
  | 'status'
  | 'adminNotes'
  | 'resolvedById'
  | 'resolvedAt'
  | 'createdAt'
  | 'updatedAt'
>;

export class Report extends Model<ReportAttributes, ReportCreationAttributes> implements ReportAttributes {
  declare id: string;
  declare reporterId: string | null;
  declare reportedUserId: string;
  declare reason: ReportReason;
  declare description: string | null;
  declare status: ReportStatus;
  declare adminNotes: string | null;
  declare resolvedById: string | null;
  declare resolvedAt: Date | null;
  declare createdAt: Date;
  declare updatedAt: Date;
}

Report.init(
  {
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true,
      allowNull: false
    },
    reporterId: {
      type: DataTypes.UUID,
      allowNull: true
    },
    reportedUserId: {
      type: DataTypes.UUID,
      allowNull: false
    },
    reason: {
      type: DataTypes.STRING(50),
      allowNull: false
    },
    description: {
      type: DataTypes.TEXT,
      allowNull: true
    },
    status: {
      type: DataTypes.STRING(30),
      allowNull: false,
      defaultValue: 'PENDING'
    },
    adminNotes: {
      type: DataTypes.TEXT,
      allowNull: true
    },
    resolvedById: {
      type: DataTypes.UUID,
      allowNull: true,
      field: 'resolved_by'
    },
    resolvedAt: {
      type: DataTypes.DATE,
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
    tableName: 'reports',
    modelName: 'Report',
    timestamps: true,
    underscored: true,
    createdAt: 'created_at',
    updatedAt: 'updated_at'
  }
);
