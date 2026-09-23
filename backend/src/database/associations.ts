import { User } from './models/user.model';
import { Profile } from './models/profile.model';
import { ProfilePhoto } from './models/profile-photo.model';
import { DatingPreference } from './models/dating-preference.model';
import { AuthRefreshToken } from './models/auth-refresh-token.model';
import { Gender } from './models/gender.model';

User.hasOne(Profile, {
  foreignKey: 'userId',
  as: 'profile'
});
Profile.belongsTo(User, {
  foreignKey: 'userId',
  as: 'user'
});

User.hasOne(DatingPreference, {
  foreignKey: 'userId',
  as: 'datingPreference'
});
DatingPreference.belongsTo(User, {
  foreignKey: 'userId',
  as: 'user'
});

User.hasMany(ProfilePhoto, {
  foreignKey: 'userId',
  as: 'profilePhotos'
});
ProfilePhoto.belongsTo(User, {
  foreignKey: 'userId',
  as: 'user'
});

User.hasMany(AuthRefreshToken, {
  foreignKey: 'userId',
  as: 'authRefreshTokens'
});
AuthRefreshToken.belongsTo(User, {
  foreignKey: 'userId',
  as: 'user'
});

Gender.hasMany(Profile, {
  foreignKey: 'genderId',
  as: 'profiles'
});
Profile.belongsTo(Gender, {
  foreignKey: 'genderId',
  as: 'gender'
});

export { User, Profile, ProfilePhoto, DatingPreference, AuthRefreshToken, Gender };
