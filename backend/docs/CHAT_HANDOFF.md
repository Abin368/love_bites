# Backend Chat Handoff

> **Document Path:** `backend/docs/CHAT_HANDOFF.md`  
> **Status:** Active Backend Handoff Document  
> **Last Updated:** 2026-09-29  
> **Target Audience:** AI Coding Sessions & Backend Engineers  

---

## 1. Current Project Status

* **Overall Backend Implementation Status:** **Phase 0 complete. Phase 1 database foundation complete. Phase 2 authentication complete. Backend CI is implemented and verified. Phase 3 public catalogs, profile foundation, basic profile HTTP, onboarding interest and relationship-intention selection, profile photos, and onboarding dating preferences are implemented.** Phase 3 is not complete. Phase 1 Step 1 and Step 2 migrations remain applied to `love_bites_dev`. The nullable city/location migration `20260929120003` is applied on both `love_bites_dev` and `love_bites_test`. Seeders exist and were not applied to `love_bites_dev`. CD/deployment is not implemented.
* **Current Development Phase:** **Onboarding dating preferences are done. Next work is the rest of Phase 3 (location, then onboarding completion), not discovery, likes, chat, or deployment.** The Phase 3 step numbers in the plan still conflict. This preferences slice is not a renumbered step.
* **What is Working:**
  * Base project setup (`package.json`, `tsconfig.json`, `.env.example`, `.sequelizerc`, `jest.config.ts`).
  * Express application (`src/app.ts`) with security headers (Helmet), CORS, JSON parser, cookie parser, HPP, and request ID tracking.
  * Zod environment parser & validator (`src/config/env.ts`). Production boot requires a non-placeholder `JWT_ACCESS_SECRET` of at least 32 characters. Local development defaults are unchanged.
  * Sequelize connection pool (`src/config/database.ts`).
  * Redis connection client (`src/config/redis.ts`).
  * AppError hierarchy and centralized error handler (`src/middleware/error.middleware.ts`), including `422 UNDERAGE_NOT_PERMITTED`.
  * Structured logger with sensitive parameter redaction (`src/utils/logger.ts`), including `passwordHash`, `accessToken`, and `newPassword`.
  * Health check endpoints (`GET /health` and `GET /api/v1/health`).
  * Phase 2 authentication module at `/api/v1/auth` (register, verify email, verify phone, resend, login, refresh, logout, forgot password, reset password).
  * Phase 3 Step 1 public catalogs: `GET /api/v1/genders`, `GET /api/v1/interests`, `GET /api/v1/relationship-intentions`. No authentication. Shared limiter `ratelimit:public:<ip>` at 100 requests / 60 seconds. Active rows only, ordered by `display_order`.
  * Phase 3 Step 2 profile foundation: `profiles.city` and `profiles.location` are nullable. `src/modules/profiles/profiles.data-access.ts` finds, creates, and updates a partial profile.
  * Phase 3 Step 3 basic profile HTTP: `GET`, `POST`, and `PATCH /api/v1/profile`. Authenticated `USER` only. `is_profile_complete` stays false for a basic profile.
  * Onboarding selection: `PUT /api/v1/onboarding/interests` and `PUT /api/v1/onboarding/relationship-intentions`. Authenticated `USER` only. Each call replaces that user's junction rows in one transaction. `profiles.is_profile_complete` is not changed. `PUT /api/v1/me/interests` and `PUT /api/v1/me/relationship-intentions` are not mounted.
  * Profile photos: `POST /api/v1/profile-photos/upload-url`, `POST /api/v1/profile-photos/confirm`, `GET /api/v1/profile-photos`, `PATCH /api/v1/profile-photos/:photoId`, and `DELETE /api/v1/profile-photos/:photoId`. Authenticated `USER` only. Private S3 presigned PUT (300 seconds) and GET (3600 seconds). Redis holds the upload reservation. The database row is created on confirm. Soft delete does not remove the S3 object. `profiles.is_profile_complete` is not changed.
  * Onboarding dating preferences: `PUT /api/v1/onboarding/dating-preferences`. Authenticated `USER` only. Replaces `dating_preferences` and the gender and intention preference junctions in one transaction. Does not write `user_relationship_intentions`. `profiles.is_profile_complete` is not changed. `GET /api/v1/dating-preferences` and `PUT /api/v1/dating-preferences` are not mounted.
  * Sequelize seeders for genders and relationship intentions. Idempotent on `code`. Production interests are not seeded.
  * Automated unit and integration test suite. The original 12 Phase 0 tests still pass. Catalog coverage is in the PostgreSQL suite.
  * Clean TypeScript compilation (`npm run build`).
  * Phase 1 Step 1 and Step 2 models, associations, and reversible migrations. `backend/.env` was not changed.
  * Backend CI: `.github/workflows/backend-ci.yml`. It runs on pushes to `develop` and on pull requests targeting `develop`. `develop` is the integration branch. `main` is the eventual higher-level branch in the current workflow (`feature branch` → `develop` → `main`). CI does not run for `main`.
* **What is Not Yet Implemented:**
  * Production interest seed data. The approved interest list is not defined. Plans, features, and usage limits are also unseeded.
  * The rest of Phase 3: the other onboarding HTTP routes, location endpoints, onboarding completion, and public profiles. Profile photos and onboarding dating preferences are implemented. Registration still validates `dateOfBirth` for age 18+ and does **not** store it or create a `profiles` row. `POST /api/v1/profile` stores date of birth on the profile. A basic profile keeps null `city` and `location`, and `is_profile_complete` stays false. Saving interests, intentions, photos, or dating preferences does not set that flag.
  * The remaining domain modules (Location, Discovery, Likes, Passes, Matches, Chat, Realtime Socket.IO, Safety, Notifications, Subscriptions, Entitlements, Payments, Admin). `PUT /api/v1/me/interests` and `PUT /api/v1/me/relationship-intentions` are not implemented. `GET /api/v1/dating-preferences` and `PUT /api/v1/dating-preferences` are not implemented. The basic profile HTTP API is implemented. The onboarding interest, intention, and dating-preference routes are implemented.
  * Real email or SMS delivery. Phase 2 uses mock providers only.
  * Payment providers, webhook handlers, and notification generation.
  * CD/deployment. No deployment target has been selected. Docker and deployment infrastructure remain future work.
  * Redis hardening. CI did not change the Redis client, authentication, or rate limiting.

---

## 2. Source of Truth

The following documents represent the authoritative source of truth for all backend implementation decisions. Consult them in order of precedence before proposing or writing code:

| Document Path | Document Title | Purpose & Authority |
| :--- | :--- | :--- |
| `backend/docs/docs_01-product-requirements.md` *(ref: `docs/01-product-requirements.md`)* | **Product Requirements Document (PRD)** | Authoritative source for functional scope, user lifecycle, MVP boundaries, feature rules, and business limits (e.g., 10 daily swipes, 20 messages for Free tier). |
| `backend/docs/backend_docs_01-backend-architecture.md` *(ref: `backend/docs/01-backend-architecture.md`)* | **Backend Architecture Specification** | Authoritative source for technical patterns, 3-layer modular monolith structure, module layouts, layer responsibilities, and request processing pipelines. |
| `backend/docs/02-database-design.md` | **Database Design Specification** | Authoritative source for PostgreSQL/PostGIS schema, Sequelize model attributes, constraints, GiST spatial indexing, unique partial indexes, and table relationships. |
| `backend/docs/03-api-specification.md` | **API Specification & Contract** | Authoritative source for REST API v1 endpoint paths, HTTP verbs, Zod validation schemas, status codes, standard JSON payloads, and Socket.IO realtime contracts. |
| `backend/docs/04-security.md` | **Backend Security Specification** | Authoritative source for Argon2id parameters, dual-token JWT lifecycle, rate limits, coordinate obfuscation, server-side Free-tier liker identity masking, and S3 hardening. |
| `backend/docs/05-development-plan.md` | **Backend Development Plan** | Authoritative execution roadmap detailing the 14 implementation phases, dependency graph, sequential 34-step task list, Definition of Done, and test strategies. |

---

## 3. Current Backend Architecture

### Codebase Reality
As verified by inspecting the repository filesystem:
* Phase 0 application scaffolding exists in `src/` (`app.ts`, `server.ts`, `config/`, `middleware/`, `routes/`, `utils/`).
* Phase 1 Step 1 models exist in `src/database/models/` and associations in `src/database/associations.ts`.
* Phase 1 Step 1 migrations exist in `src/database/migrations/`.
* Auth lives in `src/modules/auth/`. User lookups live in `src/modules/users/users.data-access.ts`. Public catalog reads live in `src/modules/genders/`, `src/modules/interests/`, and `src/modules/relationship-intentions/`. Onboarding interest and intention replacement lives in `src/modules/onboarding/`. Other domain modules are **not** implemented.

### Established Architectural Standard (Mandatory for Implementation)
When code is implemented, it **must** strictly conform to the 3-Layer Modular Architecture specified in `backend_docs_01-backend-architecture.md`:

```text
HTTP Request
     │
     ▼
[Security & Validation Middleware] (Helmet, CORS, Rate Limit, Auth, Zod Schema)
     │
     ▼
[Route Layer] (`*.routes.ts`) ──► URL routing & middleware pipeline binding only
     │
     ▼
[Controller Layer] (`*.controller.ts`) ──► DTO parsing, service delegation, JSON serialization
     │
     ▼
[Service Layer] (`*.service.ts`) ──► Business rules, entitlements, limits, DB transactions
     │
     ▼
[Data Access Layer] (`*.data-access.ts`) ──► Sequelize queries, PostGIS spatial functions
     │
     ▼
[Sequelize Models] (`database/models/*.ts`) ──► Schema mapping & table associations
     │
     ▼
[PostgreSQL 16+ & PostGIS 3.4+ Database]
```

### Architectural Guardrails:
* **No Repository Pattern:** Generic repositories or DAOs are strictly forbidden. Use domain-specific Data Access modules (e.g., `likes.data-access.ts`).
* **Controllers do not query databases or contain business rules.**
* **Services do not touch Express `req`/`res` objects or HTTP status codes.**
* **All cross-entity mutations must use managed Sequelize database transactions.**

---

## 4. Implemented Features

| Feature Name | Status | Relevant Module / Files | Important Behavior & Business Rules |
| :--- | :--- | :--- | :--- |
| **Project Setup & Base Tooling** | **Implemented** | `package.json`, `tsconfig.json`, `src/app.ts`, `src/server.ts` | Node.js 20+ LTS, TypeScript 5+, Express app, Zod env validation, Winston logger. |
| **Authentication** | **Implemented (Phase 2)** | `src/modules/auth/`, `src/middleware/auth.middleware.ts`, `src/middleware/role.middleware.ts` | Email and/or phone registration, Argon2id, 15-minute HS256 access JWT, 7-day opaque refresh cookie, SHA-256 hash in `auth_refresh_tokens`, single-use rotation, reuse revokes all active sessions. `dateOfBirth` is validated and not stored. No profile row is created. |
| **Users** | **Schema Implemented (Phase 1 Step 1)** | `src/database/models/user.model.ts` | Root identity table, UUID PK, identifier/role/status CHECKs, partial unique email/phone indexes, paranoid `deleted_at`. No user APIs yet. |
| **Profiles** | **Basic profile API implemented (Phase 3 Step 3)** | `profile.model.ts`, `src/modules/profiles/`, migration `20260929120003` | 1:1 with users. `GET`, `POST`, and `PATCH /api/v1/profile` require `authenticate` and role `USER`. Ownership is `req.user.id`. Writable fields are `firstName`, `dateOfBirth`, `genderId`, `bio`, `occupation`, and `education`. `city` and `location` stay nullable. `location` remains `geography(Point, 4326)`. `chk_profiles_age_18_plus` is unchanged. Callers cannot set `isProfileComplete`. A basic profile stays incomplete until city, location, photos, interests, intentions, and dating preferences exist. |
| **Photos** | **Private upload pipeline implemented** | `src/modules/profile-photos/`, `src/integrations/storage/`, `profile-photo.model.ts` | `user_id` → `users.id`. Server key `photos/{userId}/{photoId}.webp`. Display order 1–5. At most one active primary. Soft delete. Presigned private PUT and GET. No S3 delete. Does not set `is_profile_complete`. |
| **Genders** | **Catalog API implemented (Phase 3 Step 1)** | `src/modules/genders/`, `gender.model.ts` | Public `GET /api/v1/genders` returns active rows (`id`, `code`, `name`) ordered by `display_order`. Seeder inserts `MAN`, `WOMAN`, `NON_BINARY`, `PREFER_NOT_TO_SAY`. |
| **Interests** | **Catalog read and onboarding selection implemented; not seeded** | `src/modules/interests/`, `src/modules/onboarding/`, `interest.model.ts`, `user-interest.model.ts` | Public `GET /api/v1/interests` returns active rows (`id`, `code`, `name`, `category`). Empty `data: []` is success. No production interest seed. `PUT /api/v1/onboarding/interests` replaces the caller's `user_interests` with 3 to 10 active ids. `PUT /api/v1/me/interests` is not mounted. |
| **Relationship Intentions** | **Catalog read and onboarding selection implemented** | `src/modules/relationship-intentions/`, `src/modules/onboarding/`, `relationship-intention.model.ts`, junction models | Public `GET /api/v1/relationship-intentions` returns active rows (`id`, `code`, `name`) ordered by `display_order`. Seeder inserts `LONG_TERM_RELATIONSHIP`, `SOMETHING_CASUAL`, `FRIENDSHIP`, `NOT_SURE_YET`. `PUT /api/v1/onboarding/relationship-intentions` replaces the caller's `user_relationship_intentions` with at least one active id. `PUT /api/v1/me/relationship-intentions` is not mounted. |
| **Dating Preferences** | **Onboarding replace implemented** | `src/modules/onboarding/`, `dating-preference.model.ts`, junction models | `PUT /api/v1/onboarding/dating-preferences` replaces the caller's age range, distance, `user_dating_preference_genders`, and `user_dating_preference_intentions`. Empty id lists are allowed. Does not write `user_relationship_intentions` or `is_profile_complete`. `GET` and `PUT /api/v1/dating-preferences` are not mounted. |
| **Location & PostGIS** | **Schema Implemented (Phase 1 Step 1)** | `profiles.location` migration + `Profile` model | `geography(Point, 4326)` and GiST index `idx_profiles_location_gist`. Nullable since Phase 3 Step 2. No location API. Discovery queries not implemented. |
| **Discovery Engine** | **Not Implemented** | `src/modules/discovery/` | Single-card candidate delivery, unlimited card browsing, PostGIS `ST_DWithin` spatial query, mutual preference filtering, Boost multipliers, exclusion of self/blocks/passes/matches. |
| **Likes** | **Schema Implemented (Phase 1 Step 2)** | `like.model.ts` | `likes.action` stores `LIKE`, `PASS`, and `SUPER_LIKE`. Partial unique `uq_likes_active_pair` where `is_undone = FALSE`. No like API or quota enforcement. |
| **Passes** | **Schema only, via `likes`** | `like.model.ts` | No separate passes table. Pass behavior is a `likes` row. No pass API. |
| **Matches** | **Schema Implemented (Phase 1 Step 2)** | `match.model.ts` | `chk_matches_canonical_order` enforces `user_one_id < user_two_id`. Partial unique active pair allows later re-match after `UNMATCHED` or `UNDONE`. No match API. |
| **Chat & Realtime Messaging** | **Schema Implemented (Phase 1 Step 2)** | `conversation.model.ts`, `message.model.ts` | `conversations` and `messages` only. `messages` is paranoid. No Socket.IO, chat API, or read-receipt service. |
| **Notifications** | **Schema Implemented (Phase 1 Step 2)** | `notification.model.ts` | In-app row store with JSONB `data` default `'{}'`. No generation, push, email, or socket dispatch. |
| **Safety & Moderation** | **Schema Implemented (Phase 1 Step 2)** | `block.model.ts`, `report.model.ts` | `blocks` and `reports` with documented CHECKs and `SET NULL` reporter/resolver FKs. No moderation workflow. |
| **Subscriptions & Entitlements** | **Schema Implemented (Phase 1 Step 2)** | plan, feature, subscription, usage, credit, boost models | Tables exist and are unseeded. Partial unique active subscription per user. No entitlement service. `limit_value = -1` remains allowed. |
| **Payments** | **Schema Implemented (Phase 1 Step 2)** | `payment.model.ts`, `processed-webhook.model.ts` | Ledger tables only. `processed_webhooks.event_id` is `VARCHAR(255)` PK. No Razorpay, Stripe, PayPal, or webhook handler. |
| **Admin** | **Not Implemented** | `src/modules/admin/` | Role guard (`role = 'ADMIN'`), user management (suspend, ban, unsuspend), moderation triage, taxonomy CRUD, dashboard KPIs, structured audit logs. |

---

## 5. Database / Migrations Status

### Current Database State
* **Database:** `love_bites_dev`. `backend/.env` is present and was not changed. Step 1 credential failure is closed.
* **Step 1 models (unchanged):** `Gender`, `User`, `AuthRefreshToken`, `Profile`, `ProfilePhoto`, `DatingPreference`.
* **Step 2 models:** `Interest`, `RelationshipIntention`, `UserInterest`, `UserRelationshipIntention`, `UserDatingPreferenceGender`, `UserDatingPreferenceIntention`, `Like`, `Match`, `Conversation`, `Message`, `Block`, `Report`, `Notification`, `Plan`, `Feature`, `PlanFeature`, `UsageLimit`, `Subscription`, `Payment`, `ProcessedWebhook`, `UsageRecord`, `UserCreditBalance`, `CreditTransaction`, `BoostSession`.
* **Associations:** Step 1 aliases unchanged. Step 2 aliases added in `src/database/associations.ts` and exported from that file. `server.ts` was not modified.
* **Migrations:** `20260920120001`–`20260920120031` are all `up` on `love_bites_dev` (status checked 2026-09-23). Step 1 files were not edited or rerun. Step 2 files `08`–`31` migrated successfully.
* **Seeders:** `src/database/seeders/20260929120001-seed-genders.js` and `20260929120002-seed-relationship-intentions.js`. Idempotent `ON CONFLICT (code) DO UPDATE`. They were verified on `love_bites_test` only. `love_bites_dev` was not seeded. Interests are intentionally not seeded.
* **SQL verification (2026-09-23):** 30 public tables present (6 Step 1 + 24 Step 2). Extensions `postgis` 3.6.2, `uuid-ossp` 1.1, `pgcrypto` 1.4. `profiles.location` is `geography(Point,4326)`. `idx_profiles_location_gist` is a GiST index. Named CHECKs, unique constraints, partial indexes, and `ON DELETE` actions matched `02-database-design.md`. `chk_matches_canonical_order` is `user_one_id < user_two_id`. `processed_webhooks.event_id` is `varchar(255)` PK. `notifications.data` default is `'{}'::jsonb`. `boost_sessions.multiplier` is `numeric(4,2)`.
* **Constraint name note:** `user_relationship_intentions` unique constraint is the documented name `uq_user_intentions_pair`.

### Planned Database Schema (from `02-database-design.md`)

```
Database Engine: PostgreSQL 16+ with PostGIS 3.4+ Extension
Primary Key Strategy: UUIDv4 (gen_random_uuid())
```

#### Planned Migration Sequence:
1. `01_enable_extensions.sql` / Sequelize: `postgis`, `uuid-ossp`
2. `02_create_reference_tables.sql`: `genders`, `interests`, `relationship_intentions`
3. `03_create_monetization_taxonomies.sql`: `plans`, `features`
4. `04_create_core_identity.sql`: `users`, `auth_refresh_tokens`
5. `05_create_profiles_and_photos.sql`: `profiles`, `profile_photos`
6. `06_create_preference_junctions.sql`: `dating_preferences`, `user_interests`, `user_relationship_intentions`, `user_dating_preference_genders`, `user_dating_preference_intentions`
7. `07_create_interactions_chat_safety.sql`: `likes`, `matches`, `conversations`, `messages`, `blocks`, `reports`, `notifications`
8. `08_create_monetization_usage_payments.sql`: `plan_features`, `usage_limits`, `subscriptions`, `payments`, `processed_webhooks`, `usage_records`, `user_credit_balances`, `credit_transactions`, `boost_sessions`
9. `09_seed_reference_data.sql`: Seed default Genders, Intentions, Plans, Features, and Usage Limits.

#### Key Constraints & Indexes to Implement:
* **Spatial Index:** GiST index `idx_profiles_location_gist` on `profiles.location`.
* **Canonical Match Unique Index:** Partial unique index `uq_matches_single_active_pair` on `(user_one_id, user_two_id)` where `status = 'ACTIVE'`.
* **Single Primary Photo Index:** Partial unique index `uq_profile_photos_primary_per_user` on `(user_id)` where `is_primary = TRUE AND deleted_at IS NULL`.
* **Active User Identifier Indexes:** Partial unique indexes on `email` and `phone` where `deleted_at IS NULL`.
* **Active Subscription Index:** Partial unique index `uq_subscriptions_single_active_per_user` on `(user_id)` where `status IN ('ACTIVE', 'PAST_DUE', 'GRACE_PERIOD')`.
* **Check Constraints:** `chk_profiles_age_18_plus`, `chk_matches_canonical_order` (`user_one_id < user_two_id`), `chk_likes_no_self_like`, `chk_blocks_no_self_block`.

---

## 6. API Status

### Status Summary
* **Implemented Endpoints:** 9 authentication routes, public `GET /api/v1/genders`, `GET /api/v1/interests`, and `GET /api/v1/relationship-intentions`, authenticated `GET`, `POST`, and `PATCH /api/v1/profile`, `PUT /api/v1/onboarding/interests`, `PUT /api/v1/onboarding/relationship-intentions`, `PUT /api/v1/onboarding/dating-preferences`, and the five `/api/v1/profile-photos` routes.
* **Partially Implemented Endpoints:** interest and relationship-intention catalogs remain public reads. User selection is only the two onboarding PUT routes. `PUT /api/v1/me/interests` and `PUT /api/v1/me/relationship-intentions` are not mounted. The basic profile API does not cover location or completion. Photo routes cover upload, confirm, list, reorder/primary, and soft delete.
* **Planned Endpoints:** the rest of onboarding, the fuller `/profiles/me` and public profile views, `GET /api/v1/dating-preferences`, `PUT /api/v1/dating-preferences`, location, discovery, likes, matches, chat, and the remaining routes in `03-api-specification.md`. Phase 3 is not complete. Profile photos and onboarding dating preferences are mounted.

### Planned API Catalog Overview (Base Path: `/api/v1`)

| Domain | Method & Path | Auth Requirement | Expected Behavior |
| :--- | :--- | :--- | :--- |
| **Auth** | `POST /auth/register` | Public | **Implemented.** Email and/or phone, password, DOB age check, legal acceptance. Creates `users` only. |
| **Auth** | `POST /auth/verify-email` | Public | **Implemented.** 6-digit code, Redis TTL 300s, max 3 attempts. |
| **Auth** | `POST /auth/verify-phone` | Public | **Implemented.** 6-digit SMS OTP via the mock SMS sender. |
| **Auth** | `POST /auth/resend-verification` | Public | **Implemented.** 1 request / 60 seconds / identifier. No enumeration masking. |
| **Auth** | `POST /auth/login` | Public | **Implemented.** Argon2id, dummy verify for unknown users, JWT + HttpOnly refresh cookie. |
| **Auth** | `POST /auth/refresh` | Cookie (`refreshToken`) | **Implemented.** Opaque token rotation and reuse detection. |
| **Auth** | `POST /auth/logout` | Authenticated | **Implemented.** Revokes the presented refresh row when present and clears the cookie. Usable while unverified. |
| **Auth** | `POST /auth/forgot-password` | Public | **Implemented.** Always returns a generic success message. |
| **Auth** | `POST /auth/reset-password` | Public | **Implemented.** SHA-256 reset token, Argon2id update, revokes active refresh sessions. |
| **Onboarding**| `GET /onboarding/status` | Authenticated | Return onboarding stage progression and `nextStep`. |
| **Onboarding**| `PATCH /onboarding/profile` | Authenticated | Not mounted. Basic profile updates use `PATCH /profile`. |
| **Onboarding**| `PUT /onboarding/interests` | Authenticated `USER` | **Implemented.** Replace 3 to 10 active interests. Does not set `is_profile_complete`. |
| **Onboarding**| `PUT /onboarding/relationship-intentions`| Authenticated `USER` | **Implemented.** Replace at least 1 active intention. Does not set `is_profile_complete`. |
| **Onboarding**| `PUT /onboarding/dating-preferences`| Authenticated `USER` | **Implemented.** Replace age range, distance, target genders, and target intentions. Does not set `is_profile_complete`. |
| **Onboarding**| `PUT /onboarding/location` | Authenticated | Save city & coordinates (stores PostGIS point). |
| **Onboarding**| `POST /onboarding/complete` | Authenticated | Validate all criteria, set `is_profile_complete = true`. |
| **Profiles** | `GET /profile` | Authenticated `USER` | **Implemented.** Return the caller's basic profile. `404 PROFILE_NOT_FOUND` when no row exists. |
| **Profiles** | `POST /profile` | Authenticated `USER` | **Implemented.** Create the caller's basic profile. `409 PROFILE_ALREADY_EXISTS` on a duplicate. |
| **Profiles** | `PATCH /profile` | Authenticated `USER` | **Implemented.** Update the caller's basic profile fields. Empty body is `400 VALIDATION_ERROR`. |
| **Profiles** | `GET /profiles/me` | Authenticated | Planned. Return the fuller private profile and preferences. Not mounted. |
| **Profiles** | `PATCH /profiles/me` | Authenticated | Not mounted. Basic field updates use `PATCH /profile`. |
| **Profiles** | `GET /profiles/:userId` | Authenticated | Public candidate profile with rounded `distanceKm`. |
| **Photos** | `POST /profile-photos/upload-url` | Authenticated `USER` | **Implemented.** Validate MIME/size, reserve the slot in Redis for 300 seconds, return a private presigned PUT URL. No database insert. |
| **Photos** | `POST /profile-photos/confirm` | Authenticated `USER` | **Implemented.** Insert the photo from the server reservation. Client storage key must match. |
| **Photos** | `GET /profile-photos` | Authenticated `USER` | **Implemented.** Active photos for the caller, with 3600-second signed GET URLs. |
| **Photos** | `PATCH /profile-photos/:photoId` | Authenticated `USER` | **Implemented.** Update display order or primary status. Other users receive `404 RESOURCE_NOT_FOUND`. |
| **Photos** | `DELETE /profile-photos/:photoId` | Authenticated `USER` | **Implemented.** Soft-delete. Completed profiles must keep one active photo. No S3 delete. |
| **Config** | `GET /genders`, `/interests`, `/relationship-intentions` | Public | **Implemented.** Active rows only, `display_order` ascending, 100 requests / 60 seconds / IP. Interests may be an empty array. |
| **Preferences**| `GET /dating-preferences`, `PUT /dating-preferences` | Authenticated | Not mounted. Onboarding save uses `PUT /onboarding/dating-preferences`. |
| **Discovery** | `GET /discovery` | Authenticated | Get next candidate card (PostGIS spatial filter, Boost weighted). |
| **Likes** | `POST /discovery/:userId/like` | Authenticated | Free quota check (10/day), record like, trigger mutual match. |
| **Passes** | `POST /discovery/:userId/pass` | Authenticated | Free quota check (10/day), record permanent pass. |
| **Undo** | `POST /discovery/undo` | Premium (`UNDO_ACTION`)| Rollback immediately preceding action within 5 minutes. |
| **Who Liked Me**| `GET /likes/who-liked-me` | Authenticated | Free: `{ count: N, admirers: [] }`; Premium: full admirer list. |
| **Matches** | `GET /matches` | Authenticated | Cursor-paginated active matches list. |
| **Matches** | `DELETE /matches/:matchId` | Authenticated | Unmatch; close conversation; allow rematch. |
| **Chat** | `GET /conversations` | Authenticated | Inbox list with last message snippet. |
| **Chat** | `GET /conversations/:conversationId/messages` | Authenticated | Cursor-paginated message history. |
| **Chat** | `POST /conversations/:conversationId/messages` | Authenticated | 6-step auth check, daily quota check (20/day Free), send message. |
| **Chat** | `POST /conversations/:conversationId/media-upload-url`| Premium (`CHAT_MEDIA`)| Generate S3 presigned URL for chat media. |
| **Chat** | `PATCH /conversations/:conversationId/read` | Authenticated | Mark conversation messages as read. |
| **Safety** | `POST /blocks/:userId`, `GET /blocks`, `DELETE /blocks/:userId` | Authenticated | Manage bidirectional user blocking. |
| **Safety** | `POST /reports` | Authenticated | Submit misconduct report with category & description. |
| **Notifications**| `GET /notifications`, `PATCH /notifications/:id/read` | Authenticated | Manage notification feed. |
| **Subscriptions**| `GET /subscriptions/plans` | Public | List available subscription tiers and pricing. |
| **Subscriptions**| `GET /subscriptions/me` | Authenticated | Current subscription status and renewal info. |
| **Subscriptions**| `POST /subscriptions/cancel` | Authenticated | Disable auto-renew; keep access until period end. |
| **Entitlements**| `GET /me/entitlements`, `GET /me/usage` | Authenticated | Return active feature entitlements and daily usage quotas. |
| **Payments** | `POST /payments/checkout` | Authenticated | Create Razorpay order from PostgreSQL plan price. |
| **Payments** | `POST /payments/verify` | Authenticated | Verify client payment signature. |
| **Webhooks** | `POST /webhooks/razorpay` | Public (HMAC Verified) | Webhook source of truth; updates subscription state idempotently. |
| **Admin** | `/admin/*` (Users, Reports, Config, Dashboard) | Admin (`role=ADMIN`) | Admin management, moderation, taxonomy config, KPIs. |

---

## 7. Authentication and Authorization Status

| Component | Status | Planned Specification | Notes |
| :--- | :--- | :--- | :--- |
| **Registration** | **Implemented** | Email and/or phone, age >= 18 checked and not stored, legal acceptance required. | `POST /api/v1/auth/register`. Duplicates return `409 DUPLICATE_IDENTIFIER`. |
| **Verification** | **Implemented** | 6-digit code, SHA-256 in Redis, TTL 300 seconds, 3 failures delete the key. | Status becomes `ACTIVE` when at least one registered identifier is verified. |
| **Password Hashing** | **Implemented** | Argon2id (`timeCost: 3`, `memoryCost: 65536`, `parallelism: 4`). | Unknown-user login runs a dummy Argon2 verify. |
| **JWT Access Tokens** | **Implemented** | 15-minute HS256 JWT. Claims: `sub`, `role`, `isVerified`, `isProfileComplete`, `iat`, `exp`. | Uses `JWT_ACCESS_SECRET`. No email, phone, or password claims. |
| **Refresh Tokens** | **Implemented** | 7-day opaque token from `crypto.randomBytes(32)`. | Cookie is HttpOnly, SameSite=Strict, path `/api/v1/auth/refresh`. Secure is true only in production. SHA-256 is stored. `JWT_REFRESH_SECRET` is unused. |
| **Token Rotation & Replay Defense** | **Implemented** | A valid refresh revokes the row, sets `replaced_by_hash`, and inserts the next row in one transaction. | Presenting a revoked token revokes every active refresh row for that user and returns `401 INVALID_TOKEN`. |
| **Auth Middleware** | **Implemented** | `auth.middleware.ts` verifies the bearer JWT, reloads the user, and sets `req.user`. | Unverified users authenticate. `requireVerified` can return `EMAIL_NOT_VERIFIED` or `PHONE_NOT_VERIFIED`. Logout stays available. |
| **Role Authorization** | **Implemented** | `requireRole(...roles)` in `role.middleware.ts`. | No admin routes were added. Premium is not a role. |
| **Account Status Handling** | **Implemented for auth** | Suspended login is `403 ACCOUNT_SUSPENDED`. Banned login is `403 ACCOUNT_BANNED`. Missing or deleted login is `401 INVALID_CREDENTIALS`. | Admin suspension APIs and socket disconnects remain later work. |

---

## 8. Business Rules Already Implemented

> **Current Status:** Age 18+ is enforced at registration. Password hashing, verification, login status checks, and refresh rotation are enforced. `PUT /api/v1/onboarding/interests` enforces 3 to 10 active interests. `PUT /api/v1/onboarding/relationship-intentions` enforces at least one active intention. Neither route sets `is_profile_complete`. The rest of onboarding, discovery, quotas, and payments are not enforced yet.

### Mandatory Rules Defined in Specifications (To Be Implemented):
1. **Age Threshold:** Users must be at least 18 years old at registration (`dateOfBirth <= CURRENT_DATE - INTERVAL '18 years'`).
2. **Onboarding Completeness:** Incomplete profiles (`is_profile_complete = FALSE`) or unverified users are excluded from the discovery pool and cannot swipe or chat.
3. **Photo Invariants:** 1 to 5 photos per user; exactly 1 active photo must be marked `is_primary = TRUE`.
4. **Interests & Intentions Bounds:** The onboarding selection routes enforce 3 to 10 interests and at least 1 relationship intention. Profile completion still does not run from those routes.
5. **Combined Daily Swipe Quota:** Free users have a shared daily quota of **10 actions** covering both Likes and Passes combined.
6. **Pass Permanence:** A Pass action permanently excludes the candidate from future discovery in Phase 1.
7. **Canonical Match Storage:** In `matches`, `user_one_id < user_two_id` is strictly enforced to prevent duplicate pair rows.
8. **Chat Access Invariant:** Chat is unlocked only after a mutual match is established. Free users are limited to 20 text messages/day and cannot send media.
9. **Coordinate Privacy:** Exact latitude and longitude coordinates are never serialized in API responses; responses return only the city name and rounded kilometer distance.
10. **Server-Side Liker Masking:** Free users calling `GET /likes/who-liked-me` receive only aggregate count (`{ count: N, admirers: [] }`) with zero admirer metadata or photo URLs in the response.
11. **Payment Webhook Authority:** Subscriptions are activated/renewed exclusively via verified Razorpay webhook events, never client success callbacks.
12. **Renewal Grace Period:** Failed subscription renewals enter a 24-hour grace period with full Premium access before downgrade to Free.

---

## 9. Security Status

| Security Area | Implementation Status | Planned Implementation Standard |
| :--- | :--- | :--- |
| **Input Validation** | **Implemented for auth** | Zod schemas strip unknown fields. Underage registration returns `422 UNDERAGE_NOT_PERMITTED`. |
| **Authentication Security** | **Implemented (Phase 2)** | Argon2id, 15-minute access JWT, opaque refresh token, SHA-256 storage, rotation, and reuse detection. |
| **Rate Limiting** | **Implemented for auth and public catalogs** | Redis sliding window: register, login, and forgot-password are 5 requests / 60 seconds / IP. OTP resend is 1 request / 60 seconds / identifier. Catalog GETs share `ratelimit:public:<ip>` at 100 requests / 60 seconds. |
| **CORS** | **Implemented (Phase 0)** | Whitelisted frontend origins with `credentials: true`. |
| **Authorization / IDOR** | **Not Implemented** | Strict resource ownership validation (`resource.user_id === req.user.id`) + UUIDv4 non-enumerable IDs. Role middleware exists; resource ownership begins in Phase 3. |
| **HTTP Security Headers** | **Implemented (Phase 0)** | Helmet middleware in `createApp()`. CSP/HSTS hardening still planned for Phase 12. |
| **Payload Size Bounds** | **Implemented (Phase 0)** | `express.json({ limit: '100kb' })`. |
| **File Upload & S3 Security** | **Implemented for profile photos** | Direct client-to-S3 presigned URLs, private objects, MIME whitelist, 10MB max size, server-generated keys. No public ACL. No S3 delete yet. |
| **Payment & Webhook Security** | **Not Implemented** | HMAC-SHA256 signature verification + idempotency ledger table `processed_webhooks`. |
| **Error Handling & Sanitization**| **Implemented (Phase 0)** | Centralized `error.middleware.ts`; internal traces stripped in production. |
| **Logging & Redaction** | **Implemented** | Winston JSON logger redacts passwords, password hashes, access tokens, refresh tokens, new passwords, OTPs, and coordinates. |
| **Environment Configuration** | **Implemented (Phase 0)** | Zod schema validation of all required environment variables on boot. |

---

## 10. Testing Status

* **Existing Tests:** `npm test` is 92/92. `npm run test:integration:pg` is 68/68, including catalog, profile, onboarding selection, and profile photo HTTP tests. The original 12 Phase 0 tests are unchanged and still pass.
* **Test Framework:** **Jest + ts-jest** (Unit), **Supertest** (Integration). Playwright E2E is still planned.
* **Covered Functionality:** AppError hierarchy, logger redaction, health endpoints, auth validation, Argon2id, JWT claims and expiry, refresh rotation/reuse decisions, auth and role middleware, the auth HTTP lifecycle, the public gender, interest, and relationship-intention catalogs, the basic profile API, and onboarding interest and relationship-intention replacement.
* **Phase 2 verification (2026-09-24):** `npm run build` succeeded. `npm test` **50/50 passing**. Auth integration tests use in-memory user, refresh-token, and Redis doubles. They do not connect to `love_bites_dev`. No migrations were created or run.
* **Phase 3 Step 1 verification (2026-09-29):** `npm run build` succeeded. `npm test` **50/50 passing**. `npm run test:integration:pg` **21/21 passing**. Catalog tests use `love_bites_test` and the in-memory Redis double. Seeders were applied twice on `love_bites_test` only, then undone. `love_bites_dev` was not seeded. No migration was created.
* **Phase 3 Step 2 verification (2026-09-29):** `npm run build` succeeded. `npm test` **50/50 passing**. `npm run test:integration:pg` **24/24 passing**. The new migration ran on `love_bites_test` only. `love_bites_dev` was not migrated. `.env` was not changed.
* **Interest and intention selection verification (2026-09-29):** `npm run build` succeeded. `npm test` **77/77 passing**. `npm run test:integration:pg` **54/54 passing**. Tests created temporary catalog rows in `love_bites_test` only. No migration was created. No production interest seed was added. `love_bites_dev` was not changed. `.env` was not changed.
* **PostgreSQL integration tests:** `npm run test:integration:pg` uses the existing `scripts/test-database.js` safety infrastructure. That script creates `love_bites_test`, runs Sequelize migrations with `--env test`, and the database guard refuses `love_bites_dev`. CI does not call `npm run db:migrate`.
* **Missing Tests:**
  * The rest of the onboarding pipeline, PostGIS spatial queries, Likes/Passes quota, concurrency-safe matching, undo rollback, chat authorisation, Razorpay webhook idempotency, and admin route security.
* **Current Test Commands:** `npm test`, `npm run test:unit`, `npm run test:integration`, `npm run test:integration:pg`.
* **Migration Commands:** `npm run db:migrate`, `npm run db:migrate:status`, `npm run db:migrate:undo` (or `npx sequelize-cli ...`). `.sequelizerc` loads `src/config/sequelize.cli.js`. Local development migration commands are separate from CI. CI does not run `npm run db:migrate`.
* **Seed Commands:** `npm run db:seed` and `npm run db:seed:undo` call Sequelize CLI. Use `--env test` with the test-database environment. Do not point them at `love_bites_dev` unless that environment is intentionally being seeded.

### Backend CI

* **Status:** Implemented and verified. The workflow was pushed and the GitHub Actions check returned green.
* **Workflow:** `.github/workflows/backend-ci.yml`
* **Triggers:** pushes to `develop`; pull requests targeting `develop`. `develop` is the integration branch. `main` is the eventual higher-level branch and is not a CI trigger.
* **Environment:** GitHub Actions, `ubuntu-latest`, Node.js 20, `npm ci`, and a temporary PostgreSQL/PostGIS service image `postgis/postgis:16-3.4`.
* **Checks, in order:** `npm ci`, `npm run build`, `npm test`, `npm run test:integration:pg`. Commands run from `backend/`.
* **PostgreSQL:** GitHub Actions provides the temporary PostGIS service. The existing test-database preparation then creates `love_bites_test` and migrates it with `--env test`. The suite does not use `love_bites_dev`.
* **Redis:** Redis is not started as a CI service. Current automated tests use the existing in-memory Redis test double where appropriate. The Redis implementation was not changed. Redis hardening remains deferred.
* **Not in this workflow:** CD/deployment, Docker files, a selected deployment target, linting, formatting checks, coverage gates, security scanners, and a Redis service.

---

## 11. Known Issues / Technical Debt

| Problem | Impact | Current Workaround | Recommended Next Action |
| :--- | :--- | :--- | :--- |
| **1. Local PostgreSQL credentials** | Closed. `backend/.env` authenticates and `love_bites_dev` has Step 1 and Step 2 applied. | None. | Do not change connection configuration. |
| **2. Documentation Filename Discrepancies** | Two files in `backend/docs/` use prefixed names (`docs_01-product-requirements.md` and `backend_docs_01-backend-architecture.md`) while cross-references mention unprefixed names. | Both documents are located in `backend/docs/`. | Keep existing filenames; treat `backend/docs/` as the documentation container. |
| **3. Sequelize GEOMETRY vs geography** | `02-database-design.md` §26 shows `DataTypes.GEOMETRY`, while SQL SoT is `geography(Point, 4326)`. | Step 1 migration uses raw SQL `geography(Point, 4326)`. Model uses `DataTypes.GEOGRAPHY('POINT', 4326)`. | Keep geography; do not switch the column to geometry. |
| **4. Onboarding vs NOT NULL location/city** | Closed in Phase 3 Step 2. `profiles.city` and `profiles.location` are nullable so a basic profile can be stored first. | Completion still requires both. A partial profile does not set `is_profile_complete`. | Do not treat a null city or location as a completed profile. |
| **5. Mock email and SMS delivery** | Phase 2 does not send real email or SMS. The mock outbox keeps messages only outside production. | Interfaces are `EmailSender` and `SmsSender`. | Choose a provider in a later phase. Do not add Twilio, MSG91, SNS, or SMTP during auth. |
| **6. `pgcrypto` added in extensions migration** | Documented PK default is `gen_random_uuid()`, which requires `pgcrypto` on PostgreSQL 16/18. User-requested extensions were `postgis` and `uuid-ossp`. | Extensions migration enables all three with `IF NOT EXISTS`. | Leave as-is unless a later environment forbids `pgcrypto`. |

---

## 12. Work Currently In Progress

* **Status:** **Onboarding dating preferences are implemented.** Do not start location endpoints, onboarding completion, discovery, payments, or deployment in the same change.
* **Context:** `PUT /api/v1/onboarding/dating-preferences` replaces the caller's preference row and both junction tables in one transaction. `is_profile_complete` is unchanged. No migration was added. `GET` and `PUT /api/v1/dating-preferences` are not mounted.

---

## 13. Pending Implementation

The implementation should follow the phased sequence established in `05-development-plan.md`:

1. **Phase 0 — Project Setup & Base Infrastructure:** Initialize Node.js, TypeScript, Express, Zod env validation, Sequelize connection pool, Redis client, centralized error middleware, Winston/Pino logger, and Jest test harness.
2. **Phase 1 — Database Foundation & Base Migrations:** Setup migrations 01–09 (PostGIS extensions, reference catalogs, core schemas, indexes, constraints, seed data).
3. **Phase 2 — Authentication & Accounts:** **Complete.** Registration, verification, login, opaque refresh rotation, password reset, auth/role middleware, and auth rate limits.
4. **Phase 3 — Profile & Onboarding:** **In progress.** Catalogs, profile foundation, basic profile HTTP, interest and intention selection, profile photos, and onboarding dating preferences are done. Next is location, then onboarding completion. Registration still does not persist `dateOfBirth`.
5. **Phase 4 — Location & Discovery:** Single-card PostGIS `ST_DWithin` spatial query, mutual preference filtering, Boost multipliers, coordinate privacy.
6. **Phase 5 — Likes, Passes & Matches:** Swiping service, Free daily quota (10 swipes), reciprocal like check, canonical pair match creation transaction, Premium Undo rollback, unmatching.
7. **Phase 6 — Chat & Realtime Messaging:** Socket.IO server + Redis adapter, 6-step message authorization, PostgreSQL message persistence, cursor-paginated history, Free/Premium media limits.
8. **Phase 7 — Safety & Moderation:** Bidirectional blocking, misconduct reports submission, admin moderation triage queue.
9. **Phase 8 — Subscriptions & Centralized Entitlements:** Entitlement engine (`hasEntitlement`, `checkAndIncrementUsage`), plans, usage limits, usage records, credit balances, boost sessions.
10. **Phase 9 — Payments & Razorpay Integration:** `IPaymentProvider` abstraction, Razorpay provider, checkout order creation, client signature verification, HMAC webhook handler with idempotency ledger, 24-hr grace period.
11. **Phase 10 — Notifications:** In-app notification queue (`NEW_MATCH`, `NEW_MESSAGE`, `NEW_LIKE`), Socket.IO dispatch, server-side liker identity redaction for Free tier on `GET /likes/who-liked-me`.
12. **Phase 11 — Admin APIs:** Admin user management, suspension/ban enforcement, dynamic taxonomy configuration, system KPI dashboard, audit logs.
13. **Phase 12 — Security Hardening & Penetration Verification:** Validate all checklists from `04-security.md`.
14. **Phase 13 — Multi-Tier Automated Testing:** Complete unit, Supertest integration, and E2E test suites.
15. **Phase 14 — Production Readiness:** Health check, graceful shutdown, logging integrations, S3 bucket hardening, deployment configurations. **Not started as deployment.** Backend CI is already verified and is not a substitute for this phase. No deployment target has been selected. Docker and deployment infrastructure remain future work.

---

## 14. Important Decisions — DO NOT CHANGE

The following architectural and business decisions are established and must **not** be modified:

* **Runtime & Framework:** Node.js (v20+ LTS) + TypeScript (v5+) + Express.js.
* **Database & ORM:** PostgreSQL (v16+) with PostGIS (v3.4+) extension + Sequelize ORM.
* **Architectural Style:** 3-layer architecture (`Route` $\rightarrow$ `Controller` $\rightarrow$ `Service` $\rightarrow$ `Data Access` $\rightarrow$ `Sequelize Model`).
* **No Repository Pattern:** Generic repositories or DAOs are strictly forbidden. Use dedicated feature Data Access modules.
* **Authentication:** Argon2id password hashing + 15-minute HS256 access JWT + 7-day opaque refresh token in an `HttpOnly`, `SameSite=Strict` cookie. The raw refresh token is never stored; only its SHA-256 hash is stored. `JWT_REFRESH_SECRET` remains in the environment and is unused.
* **Storage:** AWS S3 private bucket with direct client uploads via short-lived presigned URLs.
* **Location Privacy:** PostGIS spherical geometry (`geography(Point, 4326)`); exact coordinates are **never** returned in API responses; distances $< 1\text{ km}$ return `"Less than 1 km away"`.
* **Payment Gateway:** Razorpay integrated behind `IPaymentProvider` interface; subscription activation driven **strictly by webhook events** verified via HMAC-SHA256 signatures; duplicate events deduplicated via `processed_webhooks`.
* **Centralized Entitlements:** Feature access and daily usage quotas managed centrally via `entitlements.service.ts`. No hardcoded boolean `user.isPremium` checks scattered across controllers.
* **Product Quotas (Free Tier):**
  * Combined **10 Swipes (Likes + Passes) per day**.
  * Maximum **20 sent text messages per day**.
  * Chat media attachments (images, video, voice, GIFs) prohibited for Free tier.
* **Server-Side Liker Identity Protection:** Free users calling `GET /likes/who-liked-me` receive only aggregate counts (`{ count: N, admirers: [] }`). Client-side CSS blurring is prohibited.
* **Canonical Match Identification:** Matches store `user_one_id = LEAST(A, B)` and `user_two_id = GREATEST(A, B)` with partial unique index on `status = 'ACTIVE'`.
* **Database Transactions:** Multi-entity state mutations (matching, unmatching, payments, undo) must execute inside managed Sequelize transactions (`sequelize.transaction`).
* **Redis Boundaries:** Redis is used exclusively for ephemeral caches, sliding-window rate limiters, OTPs, and Socket.IO cluster adapters. It is **never** used as a primary persistent store. CI does not start Redis. Redis hardening remains deferred.
* **Git branches:** Feature branch, then pull request into `develop`, then `main`. `develop` is the current integration branch for backend CI. `main` is the eventual higher-level branch.

---

## 15. Rules for the Next AI Coding Session

1. **Read this file (`backend/docs/CHAT_HANDOFF.md`) before starting work.**
2. **Read the relevant project specification documents before changing behavior.**
3. **Inspect the existing implementation before creating new files.**
4. **Do not rewrite working code unnecessarily.**
5. **Do not change established architecture without a clear technical reason.**
6. **Do not change established business rules without explicit approval.**
7. **Do not mark a feature as completed unless it is actually implemented and tested.**
8. **Keep changes scoped to the requested feature.**
9. **Preserve backward compatibility where applicable.**
10. **Run relevant tests after changes.**
11. **Update this `CHAT_HANDOFF.md` after completing a meaningful feature.**
12. **Clearly record what changed, what remains, and any new known issues.**

---

## 16. Recommended Next Task

### Task: **Phase 3 — Location**
Onboarding dating preferences are implemented. Phase 3 is not complete. Location, onboarding completion, and public profiles are not implemented.

Next work is location. Do not start discovery, likes, chat, or payments. Do not invent a production interest catalog. Do not implement `GET /api/v1/dating-preferences` or `PUT /api/v1/dating-preferences` as part of that work.

---

## 17. Handoff Update Log

| Date | Feature / Change | Status | Notes |
| :--- | :--- | :--- | :--- |
| **2026-09-18** | Initial Backend Audit & Handoff Creation | **Completed** | Full repository audit completed. Confirmed greenfield status. Created authoritative handoff document. |
| **2026-09-18** | Phase 0 — Backend Project Setup & Infrastructure | **Completed** | Initialized TypeScript, Express, Zod env, Sequelize pool, Redis client, AppError hierarchy, Winston logger with redaction, middleware pipeline, health check endpoints, and Jest test suite (12/12 passing). |
| **2026-09-20** | Phase 1 Step 1 — Users / Profile / Location schema | **Applied and verified** | Migrations `20260920120001`–`20260920120007` and models for extensions, `genders`, `users`, `auth_refresh_tokens`, `profiles` (`geography(Point, 4326)` + GiST), `profile_photos`, `dating_preferences`. Earlier handoff text that said migrate failed and `.env` was absent is obsolete. |
| **2026-09-23** | Phase 1 Step 2 — Remaining database foundation | **Complete** | Migrations `20260920120008`–`20260920120031` applied to `love_bites_dev`. 24 tables, models, and associations added. No seeders, APIs, services, or payment providers. Build passed. Tests 12/12. SQL verification passed, including Step 1 PostGIS preservation. |
| **2026-09-24** | Phase 2 — Authentication | **Complete** | Nine `/api/v1/auth` routes. Opaque refresh tokens, SHA-256 storage, rotation, and reuse detection. Redis OTPs, reset tokens, and auth rate limits. Mock email/SMS only. No migrations or `.env` changes. Build passed. Tests 50/50. |
| **2026-09-28** | Backend CI | **Verified** | `.github/workflows/backend-ci.yml` runs on pushes to `develop` and pull requests targeting `develop`. GitHub Actions, `ubuntu-latest`, Node.js 20, `npm ci`, `npm run build`, `npm test`, `npm run test:integration:pg`, temporary `postgis/postgis:16-3.4` service, existing `love_bites_test` guard. No Redis service. Redis hardening deferred. CD/deployment not implemented. The GitHub Actions check returned green. |
| **2026-09-29** | Phase 3 Step 1 — Catalogs and seed data | **Implemented** | Public gender, interest, and relationship-intention GETs. Gender and relationship-intention seeders only. Interests not seeded. No migration. `love_bites_dev` was not seeded. Phase 3 is not complete. |
| **2026-09-29** | Phase 3 Step 2 — Profile foundation | **Implemented** | Migration `20260929120003` makes `profiles.city` and `profiles.location` nullable. Geography type and GiST index unchanged. Profile data access only. No profile HTTP. Partial profiles stay incomplete. `love_bites_dev` was not migrated. Phase 3 is not complete. Step 3 is next. |
| **2026-09-30** | Phase 3 — Profile photos | **Implemented** | Five `/api/v1/profile-photos` routes. Private S3 presigned PUT (300s) and GET (3600s). Redis upload reservation. Row inserted on confirm. Soft delete without S3 deletion. No migration. `is_profile_complete` is not written. |
| **2026-10-01** | Phase 3 — Onboarding dating preferences | **Implemented** | `PUT /api/v1/onboarding/dating-preferences`. Replaces age range, distance, target genders, and target intentions in one transaction. Empty id lists are allowed. Does not write `user_relationship_intentions` or `is_profile_complete`. No migration. `GET` and `PUT /api/v1/dating-preferences` are not mounted. |
