import { User } from './models/user.model';
import { Profile } from './models/profile.model';
import { ProfilePhoto } from './models/profile-photo.model';
import { DatingPreference } from './models/dating-preference.model';
import { AuthRefreshToken } from './models/auth-refresh-token.model';
import { Gender } from './models/gender.model';
import { Interest } from './models/interest.model';
import { RelationshipIntention } from './models/relationship-intention.model';
import { UserInterest } from './models/user-interest.model';
import { UserRelationshipIntention } from './models/user-relationship-intention.model';
import { UserDatingPreferenceGender } from './models/user-dating-preference-gender.model';
import { UserDatingPreferenceIntention } from './models/user-dating-preference-intention.model';
import { Like } from './models/like.model';
import { Match } from './models/match.model';
import { Conversation } from './models/conversation.model';
import { Message } from './models/message.model';
import { Block } from './models/block.model';
import { Report } from './models/report.model';
import { Notification } from './models/notification.model';
import { Plan } from './models/plan.model';
import { Feature } from './models/feature.model';
import { PlanFeature } from './models/plan-feature.model';
import { UsageLimit } from './models/usage-limit.model';
import { Subscription } from './models/subscription.model';
import { Payment } from './models/payment.model';
import { ProcessedWebhook } from './models/processed-webhook.model';
import { UsageRecord } from './models/usage-record.model';
import { UserCreditBalance } from './models/user-credit-balance.model';
import { CreditTransaction } from './models/credit-transaction.model';
import { BoostSession } from './models/boost-session.model';

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

User.hasMany(UserInterest, {
  foreignKey: 'userId',
  as: 'userInterests'
});
UserInterest.belongsTo(User, {
  foreignKey: 'userId',
  as: 'user'
});
UserInterest.belongsTo(Interest, {
  foreignKey: 'interestId',
  as: 'interest'
});
Interest.hasMany(UserInterest, {
  foreignKey: 'interestId',
  as: 'userInterests'
});

User.hasMany(UserRelationshipIntention, {
  foreignKey: 'userId',
  as: 'userRelationshipIntentions'
});
UserRelationshipIntention.belongsTo(User, {
  foreignKey: 'userId',
  as: 'user'
});
UserRelationshipIntention.belongsTo(RelationshipIntention, {
  foreignKey: 'relationshipIntentionId',
  as: 'relationshipIntention'
});
RelationshipIntention.hasMany(UserRelationshipIntention, {
  foreignKey: 'relationshipIntentionId',
  as: 'userRelationshipIntentions'
});

User.hasMany(UserDatingPreferenceGender, {
  foreignKey: 'userId',
  as: 'datingPreferenceGenders'
});
UserDatingPreferenceGender.belongsTo(User, {
  foreignKey: 'userId',
  as: 'user'
});
UserDatingPreferenceGender.belongsTo(Gender, {
  foreignKey: 'genderId',
  as: 'gender'
});
Gender.hasMany(UserDatingPreferenceGender, {
  foreignKey: 'genderId',
  as: 'datingPreferenceGenders'
});

User.hasMany(UserDatingPreferenceIntention, {
  foreignKey: 'userId',
  as: 'datingPreferenceIntentions'
});
UserDatingPreferenceIntention.belongsTo(User, {
  foreignKey: 'userId',
  as: 'user'
});
UserDatingPreferenceIntention.belongsTo(RelationshipIntention, {
  foreignKey: 'relationshipIntentionId',
  as: 'relationshipIntention'
});
RelationshipIntention.hasMany(UserDatingPreferenceIntention, {
  foreignKey: 'relationshipIntentionId',
  as: 'datingPreferenceIntentions'
});

User.hasMany(Like, {
  foreignKey: 'fromUserId',
  as: 'likesSent'
});
Like.belongsTo(User, {
  foreignKey: 'fromUserId',
  as: 'fromUser'
});
User.hasMany(Like, {
  foreignKey: 'toUserId',
  as: 'likesReceived'
});
Like.belongsTo(User, {
  foreignKey: 'toUserId',
  as: 'toUser'
});

User.hasMany(Match, {
  foreignKey: 'userOneId',
  as: 'matchesAsUserOne'
});
Match.belongsTo(User, {
  foreignKey: 'userOneId',
  as: 'userOne'
});
User.hasMany(Match, {
  foreignKey: 'userTwoId',
  as: 'matchesAsUserTwo'
});
Match.belongsTo(User, {
  foreignKey: 'userTwoId',
  as: 'userTwo'
});
User.hasMany(Match, {
  foreignKey: 'unmatchedByUserId',
  as: 'matchesUnmatched'
});
Match.belongsTo(User, {
  foreignKey: 'unmatchedByUserId',
  as: 'unmatchedBy'
});

Match.hasOne(Conversation, {
  foreignKey: 'matchId',
  as: 'conversation'
});
Conversation.belongsTo(Match, {
  foreignKey: 'matchId',
  as: 'match'
});

Conversation.hasMany(Message, {
  foreignKey: 'conversationId',
  as: 'messages'
});
Message.belongsTo(Conversation, {
  foreignKey: 'conversationId',
  as: 'conversation'
});
User.hasMany(Message, {
  foreignKey: 'senderId',
  as: 'sentMessages'
});
Message.belongsTo(User, {
  foreignKey: 'senderId',
  as: 'sender'
});

User.hasMany(Block, {
  foreignKey: 'blockerId',
  as: 'blocksInitiated'
});
Block.belongsTo(User, {
  foreignKey: 'blockerId',
  as: 'blocker'
});
User.hasMany(Block, {
  foreignKey: 'blockedId',
  as: 'blocksReceived'
});
Block.belongsTo(User, {
  foreignKey: 'blockedId',
  as: 'blocked'
});

User.hasMany(Report, {
  foreignKey: 'reporterId',
  as: 'reportsFiled'
});
Report.belongsTo(User, {
  foreignKey: 'reporterId',
  as: 'reporter'
});
User.hasMany(Report, {
  foreignKey: 'reportedUserId',
  as: 'reportsAgainst'
});
Report.belongsTo(User, {
  foreignKey: 'reportedUserId',
  as: 'reportedUser'
});
User.hasMany(Report, {
  foreignKey: 'resolvedById',
  as: 'reportsResolved'
});
Report.belongsTo(User, {
  foreignKey: 'resolvedById',
  as: 'resolvedBy'
});

User.hasMany(Notification, {
  foreignKey: 'userId',
  as: 'notifications'
});
Notification.belongsTo(User, {
  foreignKey: 'userId',
  as: 'user'
});

Plan.hasMany(PlanFeature, {
  foreignKey: 'planId',
  as: 'planFeatures'
});
PlanFeature.belongsTo(Plan, {
  foreignKey: 'planId',
  as: 'plan'
});
Feature.hasMany(PlanFeature, {
  foreignKey: 'featureId',
  as: 'planFeatures'
});
PlanFeature.belongsTo(Feature, {
  foreignKey: 'featureId',
  as: 'feature'
});

Plan.hasMany(UsageLimit, {
  foreignKey: 'planId',
  as: 'usageLimits'
});
UsageLimit.belongsTo(Plan, {
  foreignKey: 'planId',
  as: 'plan'
});

User.hasMany(Subscription, {
  foreignKey: 'userId',
  as: 'subscriptions'
});
Subscription.belongsTo(User, {
  foreignKey: 'userId',
  as: 'user'
});
Plan.hasMany(Subscription, {
  foreignKey: 'planId',
  as: 'subscriptions'
});
Subscription.belongsTo(Plan, {
  foreignKey: 'planId',
  as: 'plan'
});

User.hasMany(Payment, {
  foreignKey: 'userId',
  as: 'payments'
});
Payment.belongsTo(User, {
  foreignKey: 'userId',
  as: 'user'
});
Subscription.hasMany(Payment, {
  foreignKey: 'subscriptionId',
  as: 'payments'
});
Payment.belongsTo(Subscription, {
  foreignKey: 'subscriptionId',
  as: 'subscription'
});

User.hasMany(UsageRecord, {
  foreignKey: 'userId',
  as: 'usageRecords'
});
UsageRecord.belongsTo(User, {
  foreignKey: 'userId',
  as: 'user'
});

User.hasMany(UserCreditBalance, {
  foreignKey: 'userId',
  as: 'creditBalances'
});
UserCreditBalance.belongsTo(User, {
  foreignKey: 'userId',
  as: 'user'
});

User.hasMany(CreditTransaction, {
  foreignKey: 'userId',
  as: 'creditTransactions'
});
CreditTransaction.belongsTo(User, {
  foreignKey: 'userId',
  as: 'user'
});

User.hasMany(BoostSession, {
  foreignKey: 'userId',
  as: 'boostSessions'
});
BoostSession.belongsTo(User, {
  foreignKey: 'userId',
  as: 'user'
});

export {
  User,
  Profile,
  ProfilePhoto,
  DatingPreference,
  AuthRefreshToken,
  Gender,
  Interest,
  RelationshipIntention,
  UserInterest,
  UserRelationshipIntention,
  UserDatingPreferenceGender,
  UserDatingPreferenceIntention,
  Like,
  Match,
  Conversation,
  Message,
  Block,
  Report,
  Notification,
  Plan,
  Feature,
  PlanFeature,
  UsageLimit,
  Subscription,
  Payment,
  ProcessedWebhook,
  UsageRecord,
  UserCreditBalance,
  CreditTransaction,
  BoostSession
};
