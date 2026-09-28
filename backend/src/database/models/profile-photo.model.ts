import { DataTypes, Model, Optional } from 'sequelize';
import { sequelize } from '../../config/database';

export interface ProfilePhotoAttributes {
  id: string;
  userId: string;
  storageKey: string;
  originalFilename: string | null;
  mimeType: string;
  fileSizeBytes: number;
  displayOrder: number;
  isPrimary: boolean;
  createdAt: Date;
  updatedAt: Date;
  deletedAt: Date | null;
}

export type ProfilePhotoCreationAttributes = Optional<
  ProfilePhotoAttributes,
  'id' | 'originalFilename' | 'displayOrder' | 'isPrimary' | 'createdAt' | 'updatedAt' | 'deletedAt'
>;

export class ProfilePhoto
  extends Model<ProfilePhotoAttributes, ProfilePhotoCreationAttributes>
  implements ProfilePhotoAttributes
{
  declare id: string;
  declare userId: string;
  declare storageKey: string;
  declare originalFilename: string | null;
  declare mimeType: string;
  declare fileSizeBytes: number;
  declare displayOrder: number;
  declare isPrimary: boolean;
  declare createdAt: Date;
  declare updatedAt: Date;
  declare deletedAt: Date | null;
}

ProfilePhoto.init(
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
    storageKey: {
      type: DataTypes.STRING(512),
      allowNull: false
    },
    originalFilename: {
      type: DataTypes.STRING(255),
      allowNull: true
    },
    mimeType: {
      type: DataTypes.STRING(50),
      allowNull: false
    },
    fileSizeBytes: {
      type: DataTypes.INTEGER,
      allowNull: false
    },
    displayOrder: {
      type: DataTypes.SMALLINT,
      allowNull: false,
      defaultValue: 1
    },
    isPrimary: {
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
    },
    deletedAt: {
      type: DataTypes.DATE,
      allowNull: true
    }
  },
  {
    sequelize,
    tableName: 'profile_photos',
    modelName: 'ProfilePhoto',
    timestamps: true,
    underscored: true,
    paranoid: true,
    createdAt: 'created_at',
    updatedAt: 'updated_at',
    deletedAt: 'deleted_at'
  }
);
