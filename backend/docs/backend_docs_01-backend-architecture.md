# Love Bite - Backend Architecture Specification
**Document Version:** 1.0.0  
**Status:** Approved Specification  
**Target Path:** `backend/docs/01-backend-architecture.md`  

---

## 1. Overview

**Love Bite** is a high-performance, real-time location-based dating platform designed to deliver smooth discovery, secure messaging, precise matching, and scalable subscription/entitlement management.

This document defines the comprehensive **Backend Architecture Specification** for Phase 1. It outlines the technical design, request processing pipelines, data flow, software pattern guardrails, security standards, and module structures required to construct a robust, scalable, and maintainable platform.

---

## 2. Architecture Goals

1. **Strict Separation of Concerns:** Adhere strictly to a 3-layer architecture (Controller $
ightarrow$ Service $
ightarrow$ Data Access) mapped into domain-driven feature modules.
2. **Centralized Entitlements & Usage Enforcement:** Enforce feature availability, quotas, and limits via a unified Entitlement and Usage system rather than scattered boolean logic.
3. **Data Integrity & Safety:** Guarantee atomicity across concurrent user interactions (e.g., simultaneous likes, payment webhooks, unmatch operations) using database constraints, row-level locks, and managed transactions.
4. **Privacy & Security by Design:** Protect user identity and exact location coordinates server-side. Enforce server-driven content censorship (e.g., hiding liker identities for non-paying users at the API level).
5. **Real-time Scalability:** Support low-latency chat, real-time match events, and socket distribution across stateless application nodes using Redis pub/sub adapters.
6. **AI-Assisted Maintainability:** Provide clear architectural patterns, predictable naming standards, and strict code isolation to facilitate seamless AI-driven development.

---

## 3. Technology Stack

| Domain | Technology / Library | Purpose |
| :--- | :--- | :--- |
| **Runtime / Language** | Node.js (v20+ LTS), TypeScript (v5+) | Event-driven backend execution with strict type safety |
| **Web Framework** | Express.js | Core HTTP web framework and routing pipeline |
| **Database** | PostgreSQL (v16+) | Primary relational data store |
| **Spatial Extensions** | PostGIS | High-performance spatial indexing and geographic queries |
| **ORM** | Sequelize ORM | Relational mapping, schema management, and query construction |
| **Authentication** | JWT, Argon2id | Access/Refresh token rotation & secure password hashing |
| **Caching / PubSub** | Redis (v7+) | Ephemeral data, rate-limiting, Socket.IO adapter, session cache |
| **Realtime Engine** | Socket.IO | WebSockets engine for instant messaging and notifications |
| **Validation** | Zod | Schema-based request input and environment validation |
| **File Storage** | AWS S3 | Private binary storage for user profile media |
| **Testing** | Jest, Supertest, Playwright | Unit testing, HTTP integration, and end-to-end user flow testing |
| **Containerization** | Docker, Docker Compose | Development environment alignment and container deployment |
| **Cloud Deployment** | AWS ECS / EC2, RDS PostgreSQL, ElastiCache | Cloud-native deployment infrastructure |

---

## 4. High-Level Architecture

The backend follows a modular, monolithic architecture designed for eventual microservice extraction if necessary. Application instances are completely stateless, delegating persistent state to PostgreSQL/PostGIS and ephemeral state/realtime sockets to Redis.

```
                           +------------------------+
                           |  Client App / Mobile   |
                           +-----------+------------+
                                       |
                                  HTTP / WSS
                                       v
                           +------------------------+
                           |   AWS ALB / NGINX      |
                           +-----------+------------+
                                       |
               +-----------------------+-----------------------+
               |                                               |
               v                                               v
  +-------------------------+                     +-------------------------+
  |  Express API Node 1     |                     |  Express API Node 2     |
  |  (Stateless App Server) |                     |  (Stateless App Server) |
  +------------+------------+                     +------------+------------+
               |                                               |
               +-----------------------+-----------------------+
                                       |
           +---------------------------+---------------------------+
           |                           |                           |
           v                           v                           v
+--------------------+      +--------------------+      +--------------------+
|   AWS S3 Bucket    |      |  Redis Cluster     |      | Primary PostgreSQL |
| (Private Photos)   |      | (PubSub/Rate Limit)|      |   (PostGIS DB)     |
+--------------------+      +--------------------+      +--------------------+
```

---

## 5. Request Lifecycle

Every HTTP request traverses a standardized linear pipeline. Business logic is strictly contained within the Service Layer, while Data Access controls persistence.

```
+-----------------------------------------------------------------------------------+
| 1. HTTP Request (Headers, Body, Cookies, Query)                                    |
+-----------------------------------------------------------------------------------+
                                         |
                                         v
+-----------------------------------------------------------------------------------+
| 2. Security Middleware (Helmet, CORS, Rate Limit)                                 |
+-----------------------------------------------------------------------------------+
                                         |
                                         v
+-----------------------------------------------------------------------------------+
| 3. Auth Middleware (JWT Validation, Cookie Extraction, User Session Context)      |
+-----------------------------------------------------------------------------------+
                                         |
                                         v
+-----------------------------------------------------------------------------------+
| 4. Validation Middleware (Zod Schema Validation for Body/Params/Query)            |
+-----------------------------------------------------------------------------------+
                                         |
                                         v
+-----------------------------------------------------------------------------------+
| 5. Controller (Parse DTO, delegate to Service, map Result -> HTTP Response)      |
+-----------------------------------------------------------------------------------+
                                         |
                                         v
+-----------------------------------------------------------------------------------+
| 6. Service Layer (Business Rules, Entitlements, Authorization, Transactions)     |
+-----------------------------------------------------------------------------------+
                                         |
                                         v
+-----------------------------------------------------------------------------------+
| 7. Data Access Layer (Sequelize Queries, PostGIS Functions, Aggregations)         |
+-----------------------------------------------------------------------------------+
                                         |
                                         v
+-----------------------------------------------------------------------------------+
| 8. PostgreSQL / PostGIS DB Storage                                               |
+-----------------------------------------------------------------------------------+
```

---

## 6. Layer Responsibilities

To avoid structural erosion, strict boundaries are imposed on each layer:

### 6.1 Routes (`*.routes.ts`)
* **Responsibilities:**
  * Define HTTP endpoints, paths, and HTTP verbs.
  * Connect endpoints to target controller methods.
  * Register pipeline middleware (authentication, authorization, rate limiting, validation).
* **Restrictions:** Must NOT contain any business logic, database calls, or request handling code.

### 6.2 Controllers (`*.controller.ts`)
* **Responsibilities:**
  * Extract input parameters from `req.body`, `req.params`, `req.query`, and `req.user`.
  * Call appropriate service methods with validated DTOs.
  * Map domain outputs and service errors into standardized HTTP JSON responses.
* **Restrictions:** Must NOT execute raw database queries, contain business logic, or handle subscription/entitlement logic.

### 6.3 Services (`*.service.ts`)
* **Responsibilities:**
  * Implement core business logic and rules.
  * Perform authorization checks dependent on dynamic entity states.
  * Execute Entitlement and Usage Limit checks.
  * Manage database transaction boundaries (`sequelize.transaction`).
  * Orchestrate interactions across multiple Data Access modules.
* **Restrictions:** Must NOT access Express `req` or `res` objects, set HTTP headers, or return HTTP status codes.

### 6.4 Data Access (`*.data-access.ts`)
* **Responsibilities:**
  * Encapsulate all database interaction logic using Sequelize ORM.
  * Execute specialized SQL/PostGIS queries.
  * Return plain JavaScript objects or typed domain entities.
* **Restrictions:** Must NOT contain business rules, entitlement logic, or HTTP concepts. **Repository Pattern is strictly forbidden**—use dedicated Data Access modules.

### 6.5 Sequelize Models (`database/models/*.ts`)
* **Responsibilities:**
  * Define table schemas, column types, default values, and model associations.
  * Define database-level indexes and foreign key constraints.
* **Restrictions:** Schema modifications MUST be applied exclusively through Sequelize migration scripts.

---

## 7. Feature-Based Module Architecture

Code is organized by business domain rather than global technical roles. This prevents cross-domain coupling and improves maintenance clarity.

### Expected Directory Layout

```
backend/
├── docs/
│   ├── 01-backend-architecture.md
│   ├── 02-database-design.md
│   ├── 03-api-specification.md
│   ├── 04-security.md
│   └── 05-development-plan.md
├── src/
│   ├── config/
│   │   ├── database.ts
│   │   ├── env.ts
│   │   ├── redis.ts
│   │   ├── s3.ts
│   │   └── index.ts
│   ├── modules/
│   │   ├── auth/
│   │   ├── users/
│   │   ├── profiles/
│   │   ├── photos/
│   │   ├── genders/
│   │   ├── interests/
│   │   ├── relationship-intentions/
│   │   ├── dating-preferences/
│   │   ├── location/
│   │   ├── discovery/
│   │   ├── likes/
│   │   ├── matches/
│   │   ├── chat/
│   │   ├── notifications/
│   │   ├── safety/
│   │   ├── subscriptions/
│   │   ├── payments/
│   │   ├── entitlements/
│   │   └── admin/
│   ├── database/
│   │   ├── models/
│   │   ├── migrations/
│   │   ├── seeders/
│   │   └── associations.ts
│   ├── middleware/
│   │   ├── auth.middleware.ts
│   │   ├── error.middleware.ts
│   │   ├── rate-limit.middleware.ts
│   │   └── validate.middleware.ts
│   ├── integrations/
│   │   ├── payment/
│   │   │   ├── payment.interface.ts
│   │   │   └── razorpay.provider.ts
│   │   ├── storage/
│   │   │   └── s3.provider.ts
│   │   └── sms/
│   ├── jobs/
│   │   ├── index.ts
│   │   └── subscription-reconciliation.job.ts
│   ├── socket/
│   │   ├── socket.server.ts
│   │   ├── socket.auth.ts
│   │   └── handlers/
│   ├── utils/
│   │   ├── crypto.ts
│   │   └── logger.ts
│   ├── routes/
│   │   └── index.ts
│   ├── app.ts
│   └── server.ts
├── tests/
│   ├── unit/
│   ├── integration/
│   └── e2e/
├── .env.example
├── .gitignore
├── package.json
├── tsconfig.json
└── sequelize.config.js
```

### Module Blueprint
Each module located in `src/modules/<feature-name>` must follow this composition:

```
modules/likes/
├── likes.controller.ts     # Request/response handling
├── likes.service.ts        # Business logic, limits, matching triggers
├── likes.data-access.ts    # DB queries for likes table
├── likes.routes.ts         # Route declarations and middleware bindings
├── likes.validator.ts      # Zod validation schemas
├── likes.types.ts          # Module-specific TypeScript definitions
└── likes.constants.ts      # Feature-specific configuration constants
```
*Note: Optional files (e.g., `*.constants.ts`) should only be created when explicitly needed.*

Implemented modules today are `auth`, `users`, `profiles`, `profile-photos`, `genders`, `interests`, `relationship-intentions`, `onboarding`, `discovery`, and `likes`. Discovery routes mount the like, pass, super-like, and undo handlers. There is no `passes` table and no separate `likes.routes.ts`. Chat, notifications, safety, subscriptions, payments, entitlements, matches, and admin modules are not implemented as HTTP modules. Their tables exist from Phase 1.

---

## 8. Authentication Architecture

### Authentication Principles
* Identifiers: Email OR Phone number registration.
* Password Hashing: **Argon2id** (`timeCost: 3, memoryCost: 65536, parallelism: 4`).
* Verification: Email verification link or Phone OTP verification required before access to dating APIs is granted.
* Age Restriction: Mandatory 18+ verification checked at onboarding based on Date of Birth.

### Dual-Token Lifecycle (JWT + Cookie)
* **Access Token:** Short-lived JWT (15-minute expiry) containing minimal payload (`userId`, `role`, `verificationStatus`). Distributed via HTTP response payload or standard header.
* **Refresh Token:** Long-lived JWT (7-day expiry) stored in a secure **HTTP-only, SameSite=Strict, Secure** cookie (`path=/api/v1/auth/refresh`).
* **Refresh Token Rotation & Revocation:** Every refresh exchange issues a new token pair and invalidates the prior refresh token. Active refresh tokens are hashed and tracked in PostgreSQL/Redis to allow immediate remote logout or session revocation.

```
Client                  Server                   Redis / DB
  |                       |                          |
  |--- POST /auth/login ->|                          |
  |                       |-- Validate Password ---->|
  |                       |-- Store Refresh Session->|
  |<-- Set HTTP Cookie ---|                          |
  |    (Refresh Token)    |                          |
  |    Returns Access JWT |                          |
  |                       |                          |
  |--- GET /api/data ---->|                          |
  |    (Bearer Access JWT)|-- Validate JWT Token --->|
  |<-- 200 OK Response ---|                          |
  |                       |                          |
  |(Access Token Expires) |                          |
  |--- POST /auth/refresh>|                          |
  |    (Via Cookie)       |-- Check Token Revoked ->|
  |                       |-- Rotate & Issue New --->|
  |<-- New Cookie + JWT --|                          |
```

### Account Deletion & Banning
* **Account Deletion:** Soft deletion with immediate session invalidation, followed by an automated hard deletion purge job after a 30-day grace period.
* **Account Suspension / Ban:** Instantly revokes all active refresh tokens in Redis, terminates active Socket.IO connections, and blocks access at the `auth.middleware.ts` layer.

---

## 9. Authorization Architecture

Authorization enforces access controls server-side across two core system roles:
1. `USER`: Standard dating platform application user.
2. `ADMIN`: Administrative user with elevated backend access.

*Premium access is **NOT** a role.* It is managed dynamically via entitlements and subscription checks.

### Authorization Layers
1. **Authentication Middleware (`auth.middleware.ts`):** Validates JWT, verifies token signature, checks user suspension status, and attaches `req.user`.
2. **Role Middleware (`role.middleware.ts`):** Verifies if `req.user.role` satisfies endpoint requirements (e.g., `requireRole('ADMIN')`).
3. **Resource Ownership Check:** Ensures users can only view or modify their own resources (e.g., updating profile details or deleting photos).
4. **Service-Level Business Authorization:** Services enforce state-dependent actions (e.g., verifying active match status before allowing chat message delivery).

---

## 10. Profile & User Architecture

Profile management separates account credentials from discovery metadata.

### Onboarding & Profile Completion
Profile attributes include: First Name, Date of Birth, Gender, Bio, Occupation, Education, Location, Dating Preferences, Interests, and Photos.

```
                +------------------------------+
                | User Registers (Email/Phone) |
                +--------------+---------------+
                               |
                               v
                +------------------------------+
                | Verify Email / OTP (Step 1)  |
                +--------------+---------------+
                               |
                               v
                +------------------------------+
                | Complete Onboarding Metadata |
                | (DOB >= 18, Name, Gender)    |
                +--------------+---------------+
                               |
                               v
                +------------------------------+
                | Upload Minimum 1 Profile Pic |
                +--------------+---------------+
                               |
                               v
                +------------------------------+
                | Set Profile Complete Flag    |
                |   isProfileComplete = true   |
                +--------------+---------------+
                               |
                               v
                +------------------------------+
                | Eligible for Discovery Engine |
                +------------------------------+
```

*Rule:* Only profiles marked `isProfileComplete = true` and `isVerified = true` are included in discovery indexing queries.

---

## 11. File Storage Architecture

Profile photos are stored using AWS S3 with strict access controls. No raw image binaries are stored in PostgreSQL.

### Storage Flow & Presigned URLs
1. **Direct S3 Upload via Presigned URL:**
   * Client requests an upload slot: `POST /api/v1/photos/upload-url`.
   * Server validates file type (`image/jpeg`, `image/png`, `image/webp`) and enforces a maximum size (10 MB).
   * Server generates a short-lived S3 `PutObject` presigned URL and returns it to the client along with an S3 Object Key (`photos/{userId}/{uuid}.jpg`).
   * Client uploads the file directly to S3.
2. **Read Access Control:**
   * S3 bucket objects remain strictly **PRIVATE**.
   * When returning photo records to clients, the backend generates `GetObject` presigned URLs (cached in Redis with short TTLs) or serves them through a CloudFront CDN distribution using signed cookies/URLs.
3. **Photo Metadata Management:**
   * Database stores: `id`, `user_id`, `s3_key`, `is_primary`, `display_order`, `created_at`.
   * Deleting a photo removes the database record and enqueues an asynchronous cleanup job to purge the file from S3.

---

## 12. Location & PostGIS Architecture

Location handling relies on PostgreSQL PostGIS extensions for fast, precise spatial evaluations. Exact coordinates are protected for security.

### Spatial Model & Storage
* Users possess a PostGIS `geography(Point, 4326)` column representing `(longitude, latitude)`.
* Spatial queries use a **GiST (Generalized Search Tree)** spatial index on the geography column.

```sql
-- Spatial Indexing Strategy
CREATE INDEX idx_users_location_gist ON profiles USING GIST (location);
```

### PostGIS Query Logic vs. Application Calculation
Calculating distance using application code requires fetching large datasets into memory and is inefficient. PostGIS shifts spatial calculations directly to the database engine using `ST_DWithin` and `ST_DistanceSphere`.

```sql
-- Efficient PostGIS Spatial Search Example
SELECT u.id, ST_Distance(u.location, :currentUserLocation) / 1000 AS distance_km
FROM profiles u
WHERE ST_DWithin(u.location, :currentUserLocation, :maxDistanceMeters)
  AND u.user_id != :currentUserId;
```

### Coordinate Privacy Guardrail
* **Exact spatial coordinates are NEVER exposed in client API responses.**
* Live Discovery exposes `city` and numeric `distanceKm`, rounded to one decimal place (for example, `4.2`). Latitude and longitude are not returned.

---

## 13. Discovery Architecture

The Discovery engine delivers one candidate profile at a time based on algorithmic eligibility filters.

```
                      +----------------------------------+
                      | Request Next Profile             |
                      +----------------+-----------------+
                                       |
                                       v
                      +----------------------------------+
                      | Service applies SQL / PostGIS    |
                      | filters in PostgreSQL            |
                      +----------------+-----------------+
                                       |
      +--------------------------------+--------------------------------+
      |                                |                                |
      v                                v                                v
+------------------+         +------------------+         +-------------------+
| Age & Gender     |         | Spatial Distance |         | Dynamic Safety    |
| Preferences      |         | (ST_DWithin)     |         | Exclusions        |
+------------------+         +------------------+         +-------------------+
                                                                    |
                                     +------------------------------+
                                     | - Permanent Passes
                                     | - Active Matches
                                     | - Blocks (Bidirectional)
                                     | - Incomplete Profiles
                                     | - Banned/Suspended Users
                                     v
                      +----------------------------------+
                      | Apply Entitlement Boosting Rules |
                      +----------------+-----------------+
                                       |
                                       v
                      +----------------------------------+
                      | Return Top 1 Scaled Candidate    |
                      +----------------------------------+
```

### Query Execution Strategy
`GET /api/v1/discovery` is implemented. The SQL candidate query applies distance (`ST_DWithin` on both radii), completed-year age ranges, mutual gender lists, and mutual relationship-intention overlap. It excludes the caller, non-`ACTIVE` and soft-deleted users, incomplete profiles, missing locations, missing primary photos, the viewer's active `LIKE`/`PASS`/`SUPER_LIKE` (`is_undone = false`), `ACTIVE` matches, and blocks in either direction. An undone action, an incoming `PASS`, and an `UNMATCHED` or `UNDONE` match stay eligible. Reports are not a filter. Ranking is the highest active boost multiplier, then `profiles.created_at DESC`, limit 1. A candidate with no active boost uses multiplier `1.0`. Photos, interests, and intentions are loaded for that one user and photo URLs are signed for 3600 seconds. The route returns one card or `candidate: null`. It does not paginate and does not consume a quota.

---

## 14. Like / Pass Architecture

### Daily Counter Rule
Free users have a **shared quota of 10 LIKE and PASS actions per UTC calendar day**. The count lives in `usage_records` with metric `DAILY_LIKE_PASS`. Premium subscribers with plan `PREMIUM_MONTHLY` or `PREMIUM_YEARLY` and a current `ACTIVE`, `PAST_DUE`, or `GRACE_PERIOD` period do not consume that quota. SUPER LIKE uses `user_credit_balances` where `credit_type = 'SUPER_LIKE'` and does not increment `DAILY_LIKE_PASS`. UNDO does not change `usage_records`.

*Example:* A Free user recording 6 Likes and 4 Passes reaches the daily limit of 10. A Super Like is not one of those 10.

### Stored Action Mechanics
Implemented routes are `POST /api/v1/discovery/:userId/pass`, `POST /api/v1/discovery/:userId/like`, and `POST /api/v1/discovery/:userId/super-like`. There is no `passes` table.

* **Pass:** Inserts `likes.action = 'PASS'`. While `is_undone = false`, Discovery excludes that target. Undo can mark the row undone. The row is not deleted. A pass does not create a match or a conversation.
* **Like:** Inserts `likes.action = 'LIKE'`. If the target has an active `LIKE` or `SUPER_LIKE` toward the caller, the same transaction creates an `ACTIVE` match and an `ACTIVE` conversation. A reciprocal `PASS` does not match. The reciprocal row stays active. No notification is written.
* **Super Like:** Premium only. Consumes one `SUPER_LIKE` credit and writes a `credit_transactions` row with `reason = 'CONSUMPTION'`. Matching follows the same reciprocal `LIKE` or `SUPER_LIKE` rule.
* **Idempotency:** Optional `Idempotency-Key` on LIKE and SUPER LIKE only, stored in Redis for 120 seconds. PASS does not use it.

---

## 15. Match Architecture

A match occurs when two users record mutual likes.

### User-Pair Canonical Ordering
To eliminate duplicate records and prevent deadlocks, user pairs are ordered using canonical ID mapping:

$$	ext{user\_low\_id} = \min(	ext{user}_A, 	ext{user}_B)$$
$$	ext{user\_high\_id} = \max(	ext{user}_A, 	ext{user}_B)$$

The live LIKE and SUPER LIKE transaction locks both users in canonical id order, inserts the action, and, when the other user has an active `LIKE` or `SUPER_LIKE`, inserts `matches.status = 'ACTIVE'` and `conversations.status = 'ACTIVE'`. It does not emit a notification or a Socket.IO event. A reciprocal `PASS` does not create a match.

### Status values
`chk_matches_status` allows `ACTIVE`, `UNDONE`, and `UNMATCHED`.

* **`ACTIVE`:** the current mutual match. LIKE and SUPER LIKE insert this row, with `user_one_id < user_two_id`, plus one `ACTIVE` conversation.
* **`UNDONE`:** Undo of the LIKE that created the current active match sets this status. `unmatched_at` and `unmatched_by_user_id` stay null. The `ACTIVE` conversation becomes `CLOSED` and `closed_at` is set.
* **`UNMATCHED`:** `DELETE /api/v1/matches/:matchId` sets this status for an `ACTIVE` match. `unmatched_at` is `CURRENT_TIMESTAMP` and `unmatched_by_user_id` is the caller. `updated_at` changes. The `ACTIVE` conversation becomes `CLOSED` and `closed_at` is set. Likes stay unchanged.

The live route is `matches.routes` → `likes.controller.unmatch` → `likes.service.unmatch` → `likes.data-access` → one PostgreSQL transaction. The service reuses `lockLikeUsers` and `closeActiveConversation`. There is no repository layer.

Historical `UNDONE` and `UNMATCHED` rows stay in place. `uq_matches_single_active_pair` allows a later `ACTIVE` row for the same pair. Rematch is not implemented and does not revive the old row. There is no match list API and no chat API. The match diagram's notification and Socket.IO steps are not implemented. `match:unmatch` is future scope.

---

## 16. Chat & Realtime Architecture

**Not implemented as a chat API.** LIKE and SUPER LIKE create an `ACTIVE` conversation row. Undo of that LIKE sets the conversation to `CLOSED`. No message routes exist. Phase 6 Slice 1 mounted the Socket.IO foundation only. The rules below remain the planned chat contract.

### Messaging Rules
* Unrestricted messaging: Either participant in an active match can send the first message.
* Messaging Quotas:
  * **Free Users:** Max 20 text messages/day. Attachments prohibited.
  * **Premium Users:** Unlimited text messages, images, GIFs, videos, and voice messages.

### Hybrid Persistence Flow
Realtime messaging uses Socket.IO for low-latency transport, backed by PostgreSQL for message history. **Redis does NOT store permanent messages.**

```
Client A                  Server Node                 PostgreSQL               Client B
   |                           |                           |                      |
   |--- socket.emit('msg') --->|                           |                      |
   |                           |-- Verify Entitlement ---->|                      |
   |                           |-- INSERT Message Record ->|                      |
   |                           |   (status = 'sent')       |                      |
   |<-- Ack ('sent') ----------|                           |                      |
   |                           |-- Publish via Redis Adapter ------------------->|
   |                           |                           |  (Socket Event)      |
   |                           |------------------------------------------------->|
```

---

## 17. Undo Architecture

`POST /api/v1/discovery/undo` is implemented.

* **Eligibility:** Authenticated `USER`, verified in the service, with a completed profile, location, and dating preferences. Premium subscription required. Anyone else receives `403 PREMIUM_REQUIRED`.
* **Scope:** The latest active outgoing `LIKE` or `PASS` only (`is_undone = false`). `SUPER_LIKE` is never undoable. Incoming actions are ignored. Already undone rows are ignored.
* **Window:** `created_at >= CURRENT_TIMESTAMP - INTERVAL '5 minutes'`. Exactly five minutes is valid. If that latest row is older, the response is `400 UNDO_WINDOW_EXPIRED` and an older row is not selected. No active `LIKE` or `PASS` returns `400 NO_UNDOABLE_ACTION`.
* **Persistence:** Sets `is_undone = true`. The row is not deleted. A later undo can take the next active `LIKE` or `PASS`, one at a time, when that row is still inside the window.
* **Match:** A `LIKE` that owns the current `ACTIVE` match moves that match to `UNDONE` and closes its `ACTIVE` conversation. `unmatched_at` and `unmatched_by_user_id` stay null. A `PASS` does not change matches. The other user's reciprocal `LIKE` or `SUPER_LIKE` stays active.
* **Quota and Redis:** Undo does not change `usage_records` and does not use an idempotency key.

---

## 18. Safety Architecture

Safety features operate independently from matching and communication modules.

### Blocking Logic
* **Bidirectional Isolation:** Blocking user $A 
ightarrow B$ creates a permanent isolation barrier. Neither user can discover, like, message, or view the other.
* **Execution:** Executing a block immediately terminates active matches between the pair, closes open conversations, and invalidates active Socket.IO room subscriptions.

### Report Handling
* Support classifications: `FAKE_PROFILE`, `HARASSMENT`, `SPAM`, `INAPPROPRIATE_CONTENT`, `SCAM`, `OTHER`.
* Submitting a report creates an auditable record in `reports` for Admin Review.

---

## 19. Notification Architecture

**Not implemented.** LIKE, PASS, SUPER LIKE, and UNDO do not insert `notifications` rows. The notes below are the planned contract.

Notifications are planned to be stored in PostgreSQL, then delivered in real-time via WebSockets or push notifications.

### Likers Identity Concealment Guardrail
To safeguard Premium monetization rules, **liker identities are filtered server-side** for Free users.

```javascript
// Example Server-Side Censorship Logic (Service Layer)
function formatNotificationForUser(notification, userEntitlements) {
  if (notification.type === 'NEW_LIKE' && !userEntitlements.canViewLikers) {
    return {
      id: notification.id,
      type: notification.type,
      title: "New Like!",
      message: "Someone liked your profile. Upgrade to Premium to see who!",
      actorPhotoUrl: null, // Censored server-side
      actorId: null        // Censored server-side
    };
  }
  return notification;
}
```
*Crucial Safety Rule:* Raw liker user IDs or profile images MUST NEVER be sent to the frontend for non-paying users. Client-side CSS blurring is explicitly forbidden.

---

## 20. Subscription & Entitlement Architecture

**The entitlement service is not implemented.** Live PASS, LIKE, SUPER LIKE, and UNDO read `subscriptions` and `plans` directly. Free LIKE and PASS usage is `usage_records`. Super Like usage is `user_credit_balances`. The pattern below is the planned central engine.

Entitlements are planned to manage feature availability and usage enforcement across the application.

### Entitlement Architecture Pattern
Feature logic delegates subscription status checks to a centralized Entitlement Service.

```
User Action Triggered
         |
         v
Centralized Entitlement Check (Is feature active in plan?)
         |
         +---> NO  ---> Reject Request (403 Forbidden / Upgrade Required)
         |
        YES
         |
         v
Usage Limit Check (Has daily quota been reached?)
         |
         +---> NO  ---> Reject Request (429 Too Many Requests / Quota Exceeded)
         |
        YES
         |
         v
Allow Request Execution
```

### Core Entitlement Components
1. **Plans:** Defines available tiers (`FREE`, `PREMIUM_MONTHLY`, `PREMIUM_YEARLY`).
2. **Features:** Canonical keys for protected capabilities (e.g., `UNLIMITED_LIKES`, `SEE_WHO_LIKED_YOU`, `ADVANCED_FILTERS`, `UNDO_ACTION`, `CHAT_MEDIA`).
3. **Subscriptions:** User plan associations, billing status (`active`, `past_due`, `canceled`), and valid billing dates.
4. **Usage Limits:** Configurable quantitative boundaries per tier (e.g., Free `LIKE_PASS_DAILY_LIMIT = 10`).
5. **Usage Records:** Tracks active daily consumption per user in Redis/PostgreSQL.

---

## 21. Payment Architecture

### Provider Abstraction Model
The payment pipeline uses an abstract provider interface to remain decoupled from underlying vendors (e.g., Razorpay).

```
+-------------------------------------------------------+
|                   Payment Service                     |
+---------------------------+---------------------------+
                            |
                            v
+-------------------------------------------------------+
|               IPaymentProvider Interface              |
|  - createOrder()    - verifyWebhook()  - cancelSub()  |
+---------------------------+---------------------------+
                            |
                            v
+-------------------------------------------------------+
|               Razorpay Payment Provider               |
+-------------------------------------------------------+
```

### Webhook Source of Truth
Webhooks are the definitive source of truth for payment status and subscription activations. The backend never activates subscription entitlements based solely on frontend success callbacks.

### Subscription Lifecycle Rules
* **Auto-Renew:** Enabled by default.
* **Cancellation:** User retains Premium benefits until the end of the paid billing period.
* **Payment Failure & Grace Period:**
  * Failing renewals enter a **24-hour grace period** during which Premium access remains active.
  * Successful retry maintains active subscription status.
  * Continued failure triggers automated downgrade to the Free tier.
* **Plan Switching (Monthly $\leftrightarrow$ Yearly):** New plan activates immediately upon confirmation without prorated credits.

---

## 22. Redis Architecture

Redis is ephemeral. It is not the store for users, matches, messages, payments, subscriptions, or the LIKE/PASS quota.

### Implemented now
* OTP codes and attempt counters (`auth:otp:email:` and `auth:otp:phone:`).
* Password-reset tokens (`auth:password-reset:`), SHA-256 key, 15-minute TTL.
* Sliding-window rate limits for register, login, forgot-password, OTP resend, and the public catalog reads.
* Health check ping.
* Profile-photo upload reservations until confirm.
* Optional LIKE idempotency (`idempotency:<callerId>:<uuid>`, 120 seconds).
* Optional SUPER LIKE idempotency (`idempotency:<callerId>:super-like:<uuid>`, 120 seconds).

### Not implemented
Sessions, discovery caching, daily LIKE/PASS counters (those are `usage_records`), Socket.IO presence, chat queues, notifications, Undo idempotency, and Unmatch idempotency. Undo and UNMATCH do not call Redis.

```
+-----------------------------------------------------------------------------------+
|                         REDIS — IMPLEMENTED VS PLANNED                            |
+-----------------------------------------------------------------------------------+
|  OTP, password reset, rate limits, health, photo reservation   | Implemented      |
|  LIKE and SUPER LIKE Idempotency-Key (120s)                    | Implemented      |
|  Socket.IO Redis adapter (Phase 6 Slice 1)                     | Implemented      |
|  Undo idempotency                                              | Not used         |
|  Unmatch idempotency                                           | Not used         |
|  Presence, chat queues, discovery cache                        | Planned          |
+-----------------------------------------------------------------------------------+
```

*Strict Boundary:* Redis must **NEVER** be used as a primary store for Users, Matches, Messages, Payments, or Subscriptions.

---

## 23. Realtime Architecture

**Phase 6 Slice 1 foundation is implemented.** `src/socket/socket.server.ts` attaches Socket.IO to the HTTP server created in `src/server.ts`. `src/socket/socket.auth.ts` authenticates the handshake. Chat application events and conversation rooms are not implemented.

* Framework: Socket.IO initialized over the Express HTTP server.
* Cluster Distribution: `@socket.io/redis-adapter` uses duplicated `ioredis` pub/sub clients from the existing Redis configuration.
* Room Topology:
  * Personal User Room: `user:{userId}` — auto-joined on connect from `socket.data.user.id`.
  * Match Conversation Room: `conversation:{conversationId}` — planned. Not joined in Slice 1.
* Connection Middleware: Validates the access JWT, reloads the user from PostgreSQL, rejects deleted/suspended/banned/non-`USER` accounts, and stores `AuthenticatedUser` on `socket.data.user`.

---

## 24. Database Access & Transactions

All database schema updates are executed using Sequelize migration scripts. Manual production database updates are strictly prohibited.

### Transaction Mandates
Database transactions (`sequelize.transaction()`) are mandatory for multi-step data mutations to ensure consistency:
1. **Match Creation:** Inserting the like or super like, inserting an `ACTIVE` match and `ACTIVE` conversation when a reciprocal `LIKE` or `SUPER_LIKE` exists, and incrementing the free LIKE/PASS quota. The reciprocal row is not rewritten.
2. **Undo:** Setting `likes.is_undone`, and, for a LIKE that owns the current active match, setting that match to `UNDONE` and closing its conversation.
3. **Unmatching:** Implemented. `DELETE /api/v1/matches/:matchId` locks both users in canonical id order, re-reads the match `FOR UPDATE`, sets `UNMATCHED` with `unmatched_at` and `unmatched_by_user_id`, and closes the `ACTIVE` conversation. Likes, quota, credits, and Redis are not touched.
4. **Payment & Subscription Sync:** Planned. Recording payment logs, updating subscription statuses, and granting entitlements.
5. **Account Deletion / Anonymization:** Planned. Cleaning up profile data across tables.

---

## 25. Error Handling & Standardized Responses

A centralized Express error middleware captures thrown application errors and formats standard JSON responses.

### Error Taxonomy

```
                   +-----------------------------+
                   |          AppError           |
                   |   (Base Operational Error)  |
                   +--------------+--------------+
                                  |
    +------------------+----------+----------+-------------------+
    |                  |                     |                   |
    v                  v                     v                   v
+---------------+ +------------------+ +-------------------+ +---------------------+
|  ValidationError| |UnauthorizedError| |  ForbiddenError   | |    NotFoundError    |
|  (HTTP 400)   | |  (HTTP 401)      | |  (HTTP 403)       | |    (HTTP 404)        |
+---------------+ +------------------+ +-------------------+ +---------------------+
    |                  |                     |                   |
    v                  v                     v                   v
+---------------+ +------------------+ +-------------------+ +---------------------+
| ConflictError | | RateLimitError   | | PaymentError      | | InternalServerError |
|  (HTTP 409)   | |  (HTTP 429)      | |  (HTTP 402)       | |    (HTTP 500)        |
+---------------+ +------------------+ +-------------------+ +---------------------+
```

### Response Schema

```json
{
  "success": false,
  "error": {
    "code": "DAILY_LIMIT_REACHED",
    "message": "You have reached your daily limit of 10 likes/passes.",
    "details": [],
    "timestamp": "2026-09-07T18:39:16.000Z",
    "requestId": "c1a9f4e2-8821-4122-901b"
  }
}
```

Internal error details and stack traces are stripped from API outputs in production.

---

## 26. Validation Architecture

Request validation uses **Zod** schemas executed before request reaching controllers.

```typescript
// Validation Middleware Flow Example
export const validate = (schema: AnyZodObject) => 
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      await schema.parseAsync({
        body: req.body,
        query: req.query,
        params: req.params,
      });
      return next();
    } catch (error) {
      return next(new ValidationError(error));
    }
  };
```

*Separation Boundary:* Zod validates structural integrity (e.g., email format, string lengths). Service layers validate dynamic business eligibility (e.g., user age criteria, active subscriptions).

---

## 27. Security Baseline

1. **HTTP Headers:** Standard security headers configured via `Helmet`.
2. **CORS:** Restricted to explicit, whitelisted frontend origins with credential sharing enabled.
3. **Password Security:** Hashes passwords using **Argon2id**.
4. **Authentication:** Uses secure HTTP-Only cookies for refresh tokens.
5. **Injection Defense:** Sequelize parameterizes queries to prevent SQL injection.
6. **Rate Limiting:** Protects endpoints against brute-force attacks via Redis sliding-window limiters.
7. **Object Access Control:** Profile photos remain private in S3, accessed via short-lived presigned URLs.

---

## 28. API Architecture

* API Version Prefix: `/api/v1/`
* Routing Convention: Plural nouns (e.g., `/api/v1/users`, `/api/v1/matches`).
* Pagination Strategy:
  * **Cursor-based Pagination:** Planned for chat and match lists. Live Discovery returns one card and does not paginate.
  * **Offset-based Pagination:** Used in Admin Panel management tables.

---

## 29. Background Jobs

Asynchronous worker tasks execute time-heavy processes out of the main HTTP execution thread:
* **Tasks:** Email/SMS delivery, image resizing/optimization, subscription expiration checks, notification dispatching.
* **Engine:** Redis-backed worker queues (e.g., BullMQ) or scheduled cron triggers.

---

## 30. Logging & Observability

* Logger Framework: Structured JSON output via `Winston` or `Pino`.
* Contextual Tracking: Request Correlation IDs (`X-Request-ID`) attached to incoming requests and passed across services and logs.
* Sensitive Data Redaction: Automatic filtering removes passwords, payment details, access tokens, and JWT secrets from log streams.
* Integrations: Native compatibility with CloudWatch and Sentry error tracing.

---

## 31. Testing Architecture

Testing isolates functionality across three testing layers:

```
                  /                  /                   / E2E \          Playwright (Critical End-to-End User Journeys)
               /-------              / Int-    \        Supertest + Database (API & Integration)
             /  egration             /-------------           /   Unit Tests  \     Jest (Services, Entitlements, Business Rules)
          +-----------------+
```

### Coverage Priorities
1. Auth & Refresh Token Rotation
2. Entitlement & Usage Limit Enforcement
3. Mutual Matching & Double-Like Race Handling
4. Spatial PostGIS Filtering Accuracy
5. Webhook Idempotency Processing

---

## 32. Concurrency & Idempotency Requirements

### Race Condition Mitigation
To prevent race conditions during concurrent requests (e.g., two users liking each other simultaneously):
* **Database Row Locking:** Uses `SELECT FOR UPDATE` inside Sequelize transactions.
* **Unique Constraints:** Canonical match constraints prevent duplicate records.

### Webhook Idempotency
Webhooks process events reliably using idempotent operations backed by an `processed_webhooks` table.

```sql
CREATE TABLE processed_webhooks (
  event_id VARCHAR(255) PRIMARY KEY,
  provider VARCHAR(50) NOT NULL,
  processed_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);
```
Duplicate incoming webhook deliveries check this table and terminate immediately with a `200 OK` response if already logged.

---

## 33. Environment Configuration

Configuration variables are managed via `.env` files and validated at boot using Zod.

```
# .env.example
NODE_ENV=development
PORT=5000
DATABASE_URL=postgres://user:password@localhost:5432/lovebite_db
REDIS_URL=redis://localhost:6379
JWT_ACCESS_SECRET=your_access_secret_key
JWT_REFRESH_SECRET=your_refresh_secret_key
AWS_REGION=us-east-1
AWS_S3_BUCKET_NAME=lovebite-private-photos
RAZORPAY_KEY_ID=rzp_test_xxx
RAZORPAY_KEY_SECRET=xxx
RAZORPAY_WEBHOOK_SECRET=xxx
```

---

## 34. AI-Assisted Development Rules

To maintain architecture quality during AI-assisted development, follow these operational rules:

### Workflow Process
1. **Pre-Implementation:** Review `docs/01-product-requirements.md` and this document. Formulate an implementation plan covering affected modules, schema updates, API endpoints, and required tests.
2. **Implementation:** Make minimal, targeted changes. Adhere to layer boundaries (Controller $
ightarrow$ Service $
ightarrow$ Data Access). Add corresponding Sequelize migrations for schema updates.
3. **Post-Implementation:** Execute unit/integration test suites, perform type-checking (`tsc`), and verify safety/entitlement rules.

---

## 35. Architectural Decision Principles

1. **Simplicity:** Prefer straight-forward implementations that satisfy requirements over complex, speculative architectures.
2. **Separation of Concerns:** Keep distinct responsibilities strictly within their defined layers.
3. **Security by Default:** Perform security, entitlement, and authorization checks server-side.
4. **Data Integrity:** Protect system state using PostgreSQL foreign keys, unique constraints, and transaction boundaries.
5. **AI Maintainability:** Structure code predictably so AI tools can safely read, generate, and refactor features.

---

## 36. Future Architecture Considerations

* Read Replicas: Adding PostgreSQL read-replicas for heavy discovery workloads.
* Edge Caching / CDN: Deploying CloudFront for media distribution.
* Dedicated Job Service: Extracting heavy background tasks into a dedicated worker service if HTTP nodes experience heavy CPU load.

---

## 37. Open Architectural Decisions

| Item ID | Topic | Description & Current Stance | Status |
| :--- | :--- | :--- | :--- |
| **OAD-01** | SMS Gateway Provider | Selection between Twilio, MSG91, or AWS SNS for OTP delivery. Abstracted behind `ISmsProvider`. | Pending Vendor Selection |
| **OAD-02** | Media Optimization Pipeline | Direct S3 uploads vs. processing images via AWS Lambda triggers for automated thumbnail generation. | Planned Phase 1.5 |

