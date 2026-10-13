# Love Bite - Backend Security Specification

> **Document Path:** `backend/docs/04-security.md`  
> **Status:** Authoritative Backend Security Specification & Guardrails  
> **Compliance Baseline:** OWASP API Security Top 10, PostGIS Coordinate Privacy, Razorpay Financial Security Standards  
> **Architecture Pattern:** Layered Defense-in-Depth (`Route` $\rightarrow$ `Controller` $\rightarrow$ `Service` $\rightarrow$ `Data Access` $\rightarrow$ `PostgreSQL/PostGIS`)

---

## 1. Security Overview

The **Love Bite** platform handles highly sensitive personal data, real-time messaging, geolocation coordinates, user preferences, and financial billing lifecycles. Security and privacy take precedence over monetization and user engagement.

### 1.1 Actor & Security Classification Model
The platform enforces a strict separation between **Identity (Authentication)**, **Access Control (Authorization)**, and **Product Capabilities (Entitlements)**:

```text
Authentication (AuthN)
  │ "Who are you?"
  ▼ (Validated via JWT / Argon2id / OTP)
Authorization (AuthZ)
  │ "What administrative resources are you allowed to access?"
  ▼ (Enforced via System Role: USER vs. ADMIN)
Entitlement & Usage (Entitlements)
  │ "Which product features and quotas is your current subscription tier allowed to consume?"
  ▼ (Evaluated centrally via Subscription Plan & Usage Records)
```

1. **`USER`:** Standard authenticated dating platform participant. Restricted to viewing public profile cards, managing their own profile/preferences, participating in active mutual matches, and performing authorized swipes.
2. **`ADMIN`:** Platform administrator with elevated privileges. Can view moderation queues, take disciplinary action on accounts (suspend/ban), and configure reference taxonomies and plans.
3. **`PREMIUM` Status:** **Premium is NOT a user role.** It is a dynamic entitlement state derived from an active `subscriptions` record. No administrative or security bypass privileges are granted by Premium status.

---

## 2. Security Principles

1. **Deny by Default:** All routes, endpoints, Socket.IO rooms, and database resources are closed by default unless explicitly granted through middleware.
2. **Least Privilege:** Application database connections, S3 IAM credentials, and system roles operate with the minimum permissions required for execution.
3. **Zero Frontend Trust:** The backend never trusts client-supplied user IDs, timestamps, pricing values, geolocation boundaries, or boolean entitlement flags (e.g., `isPremium: true`).
4. **Privacy by Design:** Precise spatial coordinates (`latitude`, `longitude`) and unmasked liker identities for non-paying users are filtered server-side and never reach client response payloads.
5. **Fail Securely:** When a security check, token validation, or payment signature verification fails, the system immediately rejects the transaction, logs the security event, and returns a sanitized generic error.
6. **Defense in Depth:** Multiple independent security layers are applied sequentially (e.g., Network/CORS $\rightarrow$ Rate Limiting $\rightarrow$ Authentication $\rightarrow$ Role Authorization $\rightarrow$ Ownership Validation $\rightarrow$ Zod Input Schema $\rightarrow$ Service Eligibility $\rightarrow$ Parameterized SQL $\rightarrow$ Response Serialization).
7. **Idempotent State Changes:** All financial operations, payment webhooks, and state-mutating actions support deterministic, duplicate-safe execution.

---

## 3. Threat Model & Mitigation Matrix

| Threat Category | Specific Attack Vector | Severity | Backend Mitigation Strategy |
| :--- | :--- | :--- | :--- |
| **Authentication** | Credential Stuffing & Brute Force | High | Argon2id password hashing, Redis sliding-window IP/Identifier rate limiting (5 req/min), generic error messages. |
| **Authentication** | Refresh Token Theft / Replay | Critical | Single-use token rotation, SHA-256 hash tracking in `auth_refresh_tokens`, automatic revocation of all user sessions upon token reuse detection. |
| **Authentication** | OTP Interception / Brute Force | High | 6-digit cryptographically secure OTP, 5-minute expiration, max 3 verification attempts before invalidation, 60-second cooldown on resends. |
| **Authorization** | IDOR (Insecure Direct Object Reference) | Critical | Strict resource ownership checks (`resource.user_id === req.user.id`) enforced at the service layer; UUIDv4 non-enumerable primary keys. |
| **Authorization** | Privilege Escalation to Admin | Critical | Role checked server-side via `requireRole('ADMIN')`; role attribute is immutable via standard user update endpoints (protected DTOs). |
| **Dating Logic** | Daily Swipe Limit Bypass | Medium | Server-side atomic increment on `usage_records` inside PostgreSQL transactions; client-side counters are ignored. |
| **Dating Logic** | Discovery Scraping & Coordinate Triangulation | High | Server-side PostGIS distance calculations; API returns only approximate distance rounded to nearest km and city name; coordinates never serialized. |
| **Dating Logic** | Permanent Pass Circumvention | Medium | Pass actions stored permanently in `likes (action='PASS')`; discovery queries enforce `NOT EXISTS` across all historical active passes. |
| **Dating Logic** | CSS Blur Bypassing on "Who Liked You" | High | Free user API returns aggregate count only (`{ count: 5, admirers: [] }`); liker profiles and photo URLs are redacted server-side. |
| **Messaging** | Unauthorized Chat Interception | Critical | Message queries verify user is an active participant of the conversation's active match; closed conversations reject writes. |
| **Payment** | Client-Side Price / Plan Tampering | Critical | Client provides only `planId`; backend resolves authoritative pricing from `plans` table; client-supplied amounts are ignored. |
| **Payment** | Webhook Forgery & Replay Attacks | Critical | HMAC-SHA256 signature verification using Razorpay secret; idempotency enforced via primary key on `processed_webhooks.event_id`. |
| **Infrastructure** | Malicious File Uploads / Malware | High | Direct client-to-S3 uploads via presigned URLs; backend enforces strict MIME whitelisting, 10MB size bounds, and isolated random UUID keys. |
| **Infrastructure** | SQL Injection | Critical | 100% parameterized queries via Sequelize ORM; direct string interpolation in SQL queries is strictly prohibited. |

---

## 4. Authentication Security

### 4.1 Dual-Identifier Registration & Verification
* **Supported Identifiers:** Email Address OR E.164 Phone Number.
* **Age Invariant:** Date of Birth must be verified server-side to guarantee $\text{Age} \ge 18$ at the exact time of registration:
  $$\text{Current Date} - \text{Date of Birth} \ge 18\text{ years}$$
* **Verification Mandate:** `auth.middleware.ts` allows an unverified user to authenticate. Discovery, PASS, LIKE, SUPER LIKE, UNDO, UNMATCH, and send message then reject that caller in the service with `403 EMAIL_NOT_VERIFIED` or `403 PHONE_NOT_VERIFIED`. Profile, onboarding, and photo routes do not apply that check. A verified email or a verified phone is enough. Verification is what sets `users.status` to `ACTIVE`. Onboarding completion does not change `users.status`.

### 4.2 OTP & Email Verification Security
1. **Entropy:** OTP codes are 6-digit numerical strings generated using cryptographically secure pseudorandom number generators (`crypto.randomInt(100000, 999999)`).
2. **TTL & Attempts:**
   * OTP expiration: Exactly **300 seconds (5 minutes)** stored in Redis with auto-expiry TTL.
   * Max verification attempts: **3 failed attempts**, after which the OTP key is deleted, requiring a new code request.
   * Resend cooldown: Minimum **60 seconds** enforced via Redis throttle keys.
3. **Single-Use Enforcement:** Successful OTP verification immediately deletes the key from Redis and transitions `users.phone_verified = TRUE` or `users.email_verified = TRUE`.

### 4.3 Login & Account Enumeration Defense
* Login accepts `identifier` (email or phone) and `password`.
* **Generic Error Messaging:** If credentials fail or the user does not exist, the API returns:
  ```json
  {
    "success": false,
    "error": {
      "code": "INVALID_CREDENTIALS",
      "message": "Invalid credentials provided."
    }
  }
  ```
  *Timing attacks are mitigated by executing dummy password hash verifications when users are not found.*

---

## 5. Password Security

### 5.1 Hashing Specification
* **Algorithm:** **Argon2id** (OWASP recommended password hashing algorithm).
* **Configuration Parameters:**
  * Memory Cost (`m`): `65536` KiB (64 MiB)
  * Time Cost (`t`): `3` iterations
  * Parallelism (`p`): `4` threads
* **Storage Invariants:**
  * Plaintext passwords are **NEVER** stored, logged, cached, or transmitted in unencrypted formats.
  * Sequelize models must define `password_hash` with `scope: { defaultScope: { attributes: { exclude: ['password_hash'] } } }` to prevent accidental serialization.

### 5.2 Password Reset & Session Invalidation
1. **Reset Tokens:** Cryptographically random 32-byte hex strings (`crypto.randomBytes(32).toString('hex')`), hashed using SHA-256 before storage in Redis (TTL: 15 minutes).
2. **Session Eviction:** A successful password reset revokes every active row in `auth_refresh_tokens` for that user and deletes the Redis reset key. There is no Redis session store to purge. Socket.IO is not implemented, so reset does not disconnect a socket.

---

## 6. JWT and Token Security

### 6.1 Token Architecture

```text
┌─────────────────────────────────────────────────────────────────────────┐
│                           ACCESS TOKEN (JWT)                            │
├─────────────────────────────────────────────────────────────────────────┤
│ • Lifespan: 15 minutes (900s)                                            │
│ • Transport: HTTP Header: `Authorization: Bearer <token>`                │
│ • Algorithm: HS256. Production boot requires a non-placeholder secret of at least 32 characters. │
│ • Payload Claims: `sub` (userId), `role`, `isVerified`, `isProfileComplete` │
│ • Prohibited Claims: Passwords, email, phone, billing details           │
└─────────────────────────────────────────────────────────────────────────┘
                                   │
                                   ▼ (Expired)
┌─────────────────────────────────────────────────────────────────────────┐
│                          REFRESH TOKEN (Cookie)                         │
├─────────────────────────────────────────────────────────────────────────┤
│ • Lifespan: 7 days (604,800s)                                           │
│ • Transport: `Set-Cookie: refreshToken=...; HttpOnly; Secure;           │
│              SameSite=Strict; Path=/api/v1/auth/refresh`                │
│ • Storage: SHA-256 hash persisted in `auth_refresh_tokens` table        │
│ • Rotation: Single-use; exchanging generates a new token pair            │
│ • Revocation: Explicit DB record invalidation on logout / suspension    │
└─────────────────────────────────────────────────────────────────────────┘
```

### 6.2 Refresh Token Rotation & Reuse Detection
1. **Single-Use Rotation:** Every request to `POST /api/v1/auth/refresh` invalidates the presented refresh token by recording `revoked_at = CURRENT_TIMESTAMP` and `replaced_by_hash = <new_token_hash>`.
2. **Automatic Revocation Cascade (Theft Detection):** If an incoming request presents an already-revoked refresh token, the server assumes token compromise, immediately invalidates **ALL** active refresh tokens belonging to that `user_id`, and requires a full re-authentication.

---

## 7. Authorization and Access Control

### 7.1 Layered Authorization Pipeline

```text
Incoming HTTP Request
         │
         ▼
[1. Authentication Middleware] ──► Validates JWT Signature & Expiry ──► Binds req.user
         │
         ▼
[2. Account Status Guard]     ──► Rejects BANNED, SUSPENDED, DELETED accounts
         │
         ▼
[3. Role Authorization]        ──► Verifies req.user.role satisfies endpoint (USER vs ADMIN)
         │
         ▼
[4. Resource Ownership Guard] ──► Verifies target resource belongs to req.user.id
         │
         ▼
[5. Entitlement & Quota Guard]──► Evaluates Plan Capabilities & Daily Usage Counters
         │
         ▼
[Controller / Domain Service]
```

### 7.2 Insecure Direct Object Reference (IDOR) Defense Rules
* **User Profile & Photos:** Mutating operations (`PATCH /profiles/me`, `DELETE /profile-photos/:photoId`) resolve target records exclusively using `req.user.id`.
* **Conversations & Messages:** `POST /api/v1/conversations/:conversationId/messages` derives sender identity from `req.user.id`. A missing conversation or a conversation whose match the caller does not belong to returns `404 RESOURCE_NOT_FOUND` so the id is not enumerated. A participant of a `CLOSED` conversation receives `404 CONVERSATION_CLOSED` on send. An inconsistent `ACTIVE` conversation with a non-`ACTIVE` match also returns `404 RESOURCE_NOT_FOUND`. `GET /api/v1/conversations/:conversationId/messages` uses the same missing, foreign, and inconsistent-match responses. A participant of a `CLOSED` conversation can read retained messages. A block in either direction is `409 BLOCKED_USER` for both send and history, including when the conversation is closed. History does not reveal storage keys and does not write `read_at`. `PATCH /api/v1/conversations/:conversationId/read` uses the history authorization rules. A participant of a `CLOSED` conversation can mark incoming messages read unless a block exists. A block in either direction is `409 BLOCKED_USER` and is not skipped because the conversation is closed. The caller's own messages are not marked. The route does not reopen the conversation or match. `GET /api/v1/conversations/:conversationId/unread-count` uses the same history authorization order: missing and non-participant ids are `404 RESOURCE_NOT_FOUND`, an `ACTIVE` conversation with a non-`ACTIVE` match is the same 404, and a block in either direction is `409 BLOCKED_USER` before any count is returned. A closed conversation can return its retained count. The count includes only the other participant's non-deleted rows with `read_at` null. The route does not write `read_at`. `GET /api/v1/conversations` uses the same caller gates as history: a verified `USER` with a complete profile, location, and dating preferences. It returns only conversations where the caller is a match participant, the conversation is `ACTIVE`, and the match is `ACTIVE`. A block in either direction omits that one conversation and does not fail the rest of the list. Closed conversations and an `ACTIVE` conversation with a non-`ACTIVE` match are omitted. The response includes the other participant's user id and first name only, and it does not return storage keys. The list does not write `read_at` and does not emit a socket event. `GET /api/v1/conversations/:conversationId` uses the history authorization order: a verified `USER` with a complete profile, location, and dating preferences; missing and non-participant ids are `404 RESOURCE_NOT_FOUND`; an `ACTIVE` conversation with a non-`ACTIVE` match is the same 404; a missing other-participant profile is the same 404; and a block in either direction is `409 BLOCKED_USER` before the details are returned. A `CLOSED` conversation stays readable unless a block exists, including when the match is `UNMATCHED` or `UNDONE`. The body returns the stored conversation status, the match id, the other participant's user id and first name, and the incoming unread count. It does not return messages or storage keys, and it does not write or emit a socket event.

---

## 8. User Account Security & Lifecycle

| Account Status | Login Allowed | Discovery Access | Swipe / Match | Chat Access | Session Handling |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **`UNVERIFIED`** | Yes (Returns unverified state) | Blocked | Blocked | Blocked | Restricted JWT issued solely for verification endpoints. |
| **`ACTIVE`** | Yes | Full (If profile complete) | Full (Quota enforced) | Full | Standard token lifecycle. |
| **`SUSPENDED`** | Blocked (`403 ACCOUNT_SUSPENDED`) | Excluded | Blocked | Blocked | All active refresh tokens revoked; Sockets disconnected. |
| **`BANNED`** | Blocked (`403 ACCOUNT_BANNED`) | Excluded | Blocked | Blocked | All active tokens permanently revoked; IP logged. |
| **`DELETED`** | Blocked (`404 USER_NOT_FOUND`) | Excluded | Blocked | Blocked | Soft-deleted (`deleted_at`); sessions terminated. |

---

## 9. Input Validation & Data Handling

### 9.1 Zod Schema Validation Guardrails
* Every route binds a Zod schema middleware (`validate(schema)`) executed before the controller is reached.
* **Strict Attribute Whitelisting (`strip` mode):** Unrecognized body properties submitted by clients are stripped automatically to prevent mass-assignment vulnerabilities.
* **Core Validation Rules:**
  * `UUIDv4`: Strict regex verification on all URL path and body ID parameters.
  * String bounds: Enforce `min` and `max` character lengths (e.g., `bio: z.string().max(500)`).
  * Numeric boundaries: Enforce exact ranges (e.g., `minAge: z.number().int().min(18).max(100)`).
  * Enums: Restricted to predefined string literals (e.g., `messageType: z.enum(['TEXT', 'IMAGE', 'GIF', 'VIDEO', 'VOICE'])`).

---

## 10. API Security

1. **HTTP Method Restrictions:** Endpoints accept only their designated HTTP verb; unrecognized methods return `405 Method Not Allowed`.
2. **Payload Size Limits:**
   * JSON request bodies: Capped at **100 KiB** via Express middleware (`express.json({ limit: '100kb' })`).
   * Media uploads bypass Express server memory entirely by using direct client-to-S3 presigned URLs.
3. **HTTP Parameter Pollution (HPP):** Protected via middleware to ensure query string parameters cannot be submitted as duplicate arrays to confuse SQL filters.

---

## 11. Rate Limiting and Abuse Prevention

Rate limiting uses **Redis sliding-window counters** to isolate burst abuse while accommodating regular usage:

| Rate Limit Category | Window | Limit | Target Key Format | Action on Limit Breach |
| :--- | :--- | :--- | :--- | :--- |
| **Auth Login / Password Reset** | 60s | 5 req | `ratelimit:auth:login:<ip>` | `429 Too Many Requests` + Log Security Alert |
| **OTP Generation / Resend** | 60s | 1 req | `ratelimit:auth:otp:<identifier>` | `429 Too Many Requests` |
| **Discovery swipe actions** | 60s | 60 req | `ratelimit:swipes:<userId>` | Planned. PASS, LIKE, SUPER LIKE, and UNDO are not on this limiter. The free product quota is separate: 10 LIKE+PASS actions per UTC day. |
| **Chat Message Sending** | 60s | 30 req | `ratelimit:chat:<userId>` | Planned. Slice 2 send message is not on this limiter. |
| **Public Reference APIs** | 60s | 100 req | `ratelimit:public:<ip>` | `429 Too Many Requests` |
| **Admin Operations** | 60s | 120 req | `ratelimit:admin:<adminId>` | `429 Too Many Requests` |

*Distinction:* The limits above represent **Security Rate Limits** (abuse/bot prevention). They operate independently from **Product Quotas** (e.g., Free 10 Swipes/day, Free 20 messages/day), which are managed by the Entitlements engine.

---

## 12. Discovery & Dating Security

### 12.1 Server-Side Filter Enforcements
`GET /api/v1/discovery` filters candidates in PostgreSQL. The route has no query string, so a client cannot change the criteria:
* **Active viewer actions:** An active `likes` row from the viewer (`LIKE`, `PASS`, or `SUPER_LIKE` with `is_undone = false`) excludes the candidate. An undone row does not. The candidate's incoming `PASS` does not.
* **Mutual preference enforcement:** Both distance radii (`ST_DWithin`, inclusive), both age ranges (completed years, inclusive), both gender lists, and both relationship-intention overlaps are required. An empty preferred-gender or preferred-intention list matches nobody.
* **Other exclusions:** The candidate must be a different `ACTIVE` user, not soft-deleted, with a completed profile, a non-null location, and an active primary photo. An `ACTIVE` match and a block in either direction are excluded. `UNMATCHED` and `UNDONE` matches are not. Reports are not part of this query.
* **Actions:** PASS, LIKE, SUPER LIKE, and UNDO require the same verified, complete caller. They reject a block, an active action, and an active match. LIKE and PASS enforce the free quota in PostgreSQL. SUPER LIKE and UNDO require a live Premium subscription (`PREMIUM_MONTHLY` or `PREMIUM_YEARLY`, status `ACTIVE`, `PAST_DUE`, or `GRACE_PERIOD`, with the period or grace end still in the future). The client cannot send an `isPremium` flag.

### 12.3 Unmatch
`DELETE /api/v1/matches/:matchId` is implemented. The route uses `authenticate` and `requireRole('USER')`. `requireVerified` is not on the route. The service requires a verified email or phone and a complete profile with location and dating preferences. Premium is not checked.

The caller must be `user_one_id` or `user_two_id` on an `ACTIVE` match. A missing id, a match between two other users, `UNDONE`, already `UNMATCHED`, and a request that loses the race return `404 MATCH_NOT_FOUND` with message `Active match record does not exist.` The foreign-match response is 404 so the id's existence is not confirmed.

The write is one PostgreSQL transaction. Both users are locked in canonical id order, then the match row is re-read with `FOR UPDATE`, and the status change is conditional on `ACTIVE`. The success body is only `{ "unmatched": true }`. It does not return the other user, timestamps, or conversation contents. There is no `Idempotency-Key` handling and no Redis call. Likes, quota, and credits are not changed.

### 12.2 Server-Side Liker Identity Protection ("Who Liked You")
* **The Vulnerability:** Returning full admirer profiles with a frontend CSS/UI blur filter allows attackers to inspect HTTP responses and bypass monetization.
* **The Backend Guardrail:**
  * When a Free user calls `GET /api/v1/likes/who-liked-me`, the service layer projects the SQL query to `COUNT(*)` only.
  * The API response strictly returns:
    ```json
    {
      "success": true,
      "data": { "count": 5, "isUnlocked": false, "admirers": [] }
    }
    ```
  * User IDs, display names, avatars, and timestamps are **NEVER** queried or returned for non-Premium accounts.

---

## 13. Privacy and Sensitive Data Protection

### 13.1 Data Classification & Exposure Matrix

| Data Classification | Fields / Entities | Security & Storage Controls | Exposure Rules |
| :--- | :--- | :--- | :--- |
| **Highly Confidential** | Passwords, Refresh Tokens, Razorpay Secrets, Coordinates. | Argon2id, SHA-256, Environment Variables, PostGIS geography. | **NEVER** returned in any API response or log stream. |
| **Confidential** | Email, Phone, Date of Birth, Billing Details, Safety Reports. | Encrypted in transit (TLS 1.3), restricted DB columns. | Returned **ONLY** to the owning user in `/profiles/me` or admins. |
| **Public / Discoverable** | First Name, Age (Derived), Gender, Bio, Photos, Interests. | Standard PostgreSQL columns, signed CDN URLs. | Serialized in discovery and public profile views. |

### 13.2 Serialization Whitelisting
To prevent accidental data leakage, domain services must use explicit **Response Serializer Functions** (DTOs) rather than returning raw Sequelize model instances (`model.toJSON()` directly to `res.json()` is prohibited).

---

## 14. Location Security

1. **Storage Specification:** Stored as PostGIS `geography(Point, 4326)` in `profiles.location`.
2. **Zero Coordinate Leakage Mandate:**
   * Raw `latitude` and `longitude` coordinates are **NEVER** serialized in any API response.
   * Live Discovery returns only:
     1. Registered `city` name (for example, `"Bengaluru"`).
     2. Numeric `distanceKm`, rounded to one decimal place:
        $$\text{distanceKm} = \text{ROUND}(\text{ST\_Distance}(\text{userA.location}, \text{userB.location}) / 1000,\ 1)$$
3. **Coordinate privacy:** Values below 1 km stay numeric, for example `0.7`. Latitude, longitude, and `profiles.location` are not returned.

---

## 15. Profile Photo & AWS S3 Security

### 15.1 S3 Bucket Hardening
* **Bucket Access:** S3 Bucket policy is set to **`Block Public Access = TRUE`**. Public-read ACLs are strictly disabled.
* **Server-Side Encryption:** Enabled by default using AWS KMS (`aws:kms`) or AES-256 (`AES256`).

### 15.2 Presigned Upload & Download Lifecycle
1. **Presigned Uploads (`PutObject`):**
   * Client requests upload slot via `POST /api/v1/profile-photos/upload-url`.
   * Server validates MIME type (`image/jpeg`, `image/png`, `image/webp`) and size ($\le 10\text{ MB}$).
   * Server generates short-lived presigned URL (valid for **300 seconds**) targeting a secure, isolated object key:
     `photos/{userId}/{uuidv4}.webp`
2. **Presigned Downloads (`GetObject`) / Signed CDN:**
   * Images are delivered through short-lived S3 `GetObject` presigned URLs (TTL: 3600 seconds). Redis stores the upload reservation until confirm. Signed download URLs are not cached in Redis. CloudFront signing is not implemented.

---

## 16. Chat and Messaging Security

### 16.1 Message Send Authorization (Phase 6 Slices 2–4)
`POST /api/v1/conversations/:conversationId/messages` and Socket.IO `chat:message:send` both call `chat.service.sendTextMessage`. The HTTP route uses `authenticate` and `requireRole('USER')`. `requireVerified` is not on the route. The service requires a verified email or phone and a complete profile with location and dating preferences. The socket path reloads the user from PostgreSQL before that call and uses `socket.data.user.id` as the sender.

Before insert, `chat.service.ts` runs one PostgreSQL transaction:

```text
Incoming TEXT payload
         │
         ▼
[Step 1] Authenticated USER (HTTP req.user.id or socket.data.user.id is the sender)
         │
         ▼
[Step 2] Conversation exists and caller is a match participant
         │
         ▼
[Step 3] Conversation status is ACTIVE; match status is ACTIVE
         │
         ▼
[Step 4] No bidirectional block between participants
         │
         ▼
[Step 5] Free daily TEXT quota (DAILY_TEXT_MESSAGES, 20 / UTC day)
         │         Premium callers skip this step via hasActivePremium
         ▼
[Persist TEXT in PostgreSQL and update last_message_at]
```

Media entitlement (attachments) is not part of TEXT send. Free callers consume `DAILY_TEXT_MESSAGES` after authorization succeeds; exhausted free quota is `429 DAILY_LIMIT_REACHED` with message `You have reached your daily limit of 20 text messages.` Premium callers do not write `usage_records` and return `remainingDailyMessages: null`. Quota and message write share one transaction. HTTP send does not emit a Socket.IO event. `chat:message:send` emits `chat:message:new` only after that transaction commits. User locks reuse `lockLikeUsers` so HTTP and socket sends coordinate with UNMATCH and UNDO. Redis is not used for this quota.

### 16.2 Chat Media Upload URL (Phase 6 media slice 1)
`POST /api/v1/conversations/:conversationId/media-upload-url` issues a private 300-second `PutObject` URL for an eligible Premium participant. It uses `hasActivePremium` inside a transaction after `lockLikeUsers`, `lockMatchById`, and `lockConversationById`. The transaction commits before signing and before the Redis write, so those calls do not hold row locks. A later close, block, or Premium lapse is not visible to this response. Confirmation, which is not implemented, must authorize again.

The server key is `chat-media/{conversationId}/{uploadId}`. Redis `chat-media:upload:{uploadId}` holds the user, conversation, key, media type, declared MIME type, and declared size for 300 seconds. The installed presigner sets `ContentType` but marks `content-type` unsignable and uses `UNSIGNED-PAYLOAD`. It does not sign `Content-Length`. Declared size and MIME type are not enforced on the PUT and do not prove the object bytes. No public ACL is set. The route does not insert a message, update `last_message_at`, or consume `DAILY_TEXT_MESSAGES`. History and inbox still return `mediaUrl: null`. TEXT send is unchanged.

---

## 17. Socket.IO Realtime Security

1. **Handshake Authentication (implemented in Phase 6 Slice 1):** Socket connections must supply `auth.token` with the existing access JWT. `socket.auth.ts` reuses `authenticateAccessToken`, which verifies the JWT and reloads the current user from PostgreSQL. Stale JWT claim fields are not trusted for account state. Missing token → `AUTH_REQUIRED`. Invalid/expired/deleted → `INVALID_TOKEN`. Suspended → `ACCOUNT_SUSPENDED`. Banned → `ACCOUNT_BANNED`. Non-`USER` roles → `FORBIDDEN`. Successful handshakes store the live `AuthenticatedUser` on `socket.data.user`.
2. **Server-Managed Room Subscriptions:**
   * Implemented now: the server auto-joins only `user:{userId}` where `userId === socket.data.user.id`.
   * `chat:message:new` is emitted to `user:{recipientUserId}` after a committed `chat:message:send`. The recipient id comes from the authorized match participants. The sender room does not receive that event.
   * Conversation rooms are not joined. There is no client join event for `conversation:{conversationId}`.
3. **Zero Client Trust in Socket Events:** `chat:message:send` ignores client identity fields. Unknown payload fields are rejected. Sender identity is `socket.data.user.id` after `loadAuthenticatedUser` reloads the current PostgreSQL account. A stale handshake snapshot is not enough for a send. Account-state failures acknowledge the event and do not disconnect the socket.
4. **Payload limit:** `chat:message:send`, `chat:typing:start`, and `chat:typing:stop` reject a parsed payload whose JSON UTF-8 size exceeds 100 KB. That failure does not disconnect the socket.
5. **Typing indicators:** `chat:typing:start` reloads the account and calls `chat.service.authorizeTyping`. Sender identity is the reloaded user id. Unknown payload fields are rejected. The other participant comes from the match row. Events go only to `user:{otherParticipantId}`. A block in either direction, a closed conversation, and a failed later authorization clear that socket's indicator. State is one conversation and one timer per socket in process memory. It is not stored in PostgreSQL or Redis. Ten start authorizations per socket per 10 seconds are allowed. Further starts return `RATE_LIMITED` without a query. Stop is not limited.

---

## 18. Subscription & Entitlement Security

1. **Premium checks today:** `entitlements.service.ts` is not implemented. PASS, LIKE, SUPER LIKE, and UNDO decide Premium by reading `subscriptions` joined to `plans` (`PREMIUM_MONTHLY` or `PREMIUM_YEARLY`) with status `ACTIVE`, `PAST_DUE`, or `GRACE_PERIOD` and a `current_period_end` or `grace_period_end` still in the future. Controllers do not trust a client `isPremium` flag. The centralized entitlement service remains later work.
2. **Tamper-Proof Plan Pricing:** 
   * Clients submit only `planId` during checkout.
   * The backend resolves `plans.price_in_cents` and `plans.currency` directly from PostgreSQL.
   * Client-supplied prices or currency overrides are completely ignored.

---

## 19. Payment Security (Razorpay)

1. **No Raw Card Data:** Love Bite servers never touch, process, or store raw credit/debit card numbers or CVVs (PCI-DSS compliance via Razorpay checkout elements).
2. **Server-Side Order Creation:** Orders are created server-side via official Razorpay SDKs with verified amounts before client checkout initialization.
3. **Cryptographic Signature Verification:** Handshake verifications execute HMAC-SHA256 verification:
   $$\text{HMAC-SHA256}(\text{order\_id} + "|" + \text{payment\_id}, \text{RAZORPAY\_KEY\_SECRET}) == \text{signature}$$

---

## 20. Razorpay Webhook Security

1. **Source of Truth Rule:** Subscription activations and renewals are executed **ONLY** upon receiving authenticated webhook events.
2. **Signature Verification:** The raw request body is verified against `X-Razorpay-Signature` using `RAZORPAY_WEBHOOK_SECRET` before JSON parsing.
3. **Idempotent Webhook Processing:**
   * The server inserts `event.id` into `processed_webhooks` inside a serializable database transaction.
   * If `event.id` already exists, the transaction aborts and returns `200 OK` immediately, preventing double crediting or duplicate subscription extensions.

---

## 21. Admin Security

1. **Server-Side Enforcement:** All `/api/v1/admin/*` routes require `role.middleware.ts` verifying `req.user.role === 'ADMIN'`.
2. **Admin Action Audit Trails:** All state-altering administrative actions (e.g., suspending a user, banning an account, resolving reports, modifying plan prices) are logged to structured audit streams with `adminId`, `targetId`, `action`, `reason`, and `timestamp`.

---

## 22. Block and Report Security

1. **Bidirectional Block Isolation:** When User A blocks User B, PostgreSQL constraints and discovery queries immediately prevent both users from discovering, matching, or messaging each other.
2. **Report Confidentiality:** Moderation reports and administrative investigation notes are accessible strictly by authenticated administrators. The reported user is never notified of the reporter's identity.

---

## 23. Database Security

1. **SQL Injection Defense:** All queries use Sequelize parameterized bindings or PostGIS spatial helper expressions. Raw string concatenations in SQL queries are strictly prohibited.
2. **Principle of Least Privilege:** Production database user credentials possess DML permissions (`SELECT`, `INSERT`, `UPDATE`, `DELETE`) but lack DDL permissions (`DROP TABLE`, `ALTER TABLE`) during runtime execution (DDL is restricted to migration runners).
3. **Encrypted Transport:** PostgreSQL connections require SSL encryption (`sslmode=require`).

---

## 24. Error Handling & Information Leakage

1. **Sanitized Production Responses:** In production environments (`NODE_ENV=production`), application stack traces, SQL syntax errors, database constraints, and internal file paths are stripped from error responses.
2. **Standard Error Envelope:** Errors return consistent JSON structures with standardized application error codes (e.g., `RESOURCE_NOT_FOUND`, `DAILY_LIMIT_REACHED`).

---

## 25. Logging and Audit Trails

### 25.1 Data Redaction Filter
Loggers (Winston/Pino) must pass all log streams through an automated redaction filter targeting sensitive keys:
* `password`, `password_hash`, `token`, `accessToken`, `refreshToken`, `authorization`, `otp`, `secret`, `razorpay_signature`, `keyId`, `location`.

### 25.2 Mandatory Audit Events
The following events must always generate structured audit logs:
* Failed authentication attempts (IP, identifier, timestamp).
* Account suspensions and bans (Admin ID, User ID, reason).
* Payment webhook lifecycle events (Event ID, provider, outcome).
* Security rate-limit trigger events.

---

## 26. CORS, Headers and HTTP Security

1. **Security Headers (Helmet):**
   * `Strict-Transport-Security` (HSTS): `max-age=31536000; includeSubDomains; preload`
   * `X-Content-Type-Options`: `nosniff`
   * `X-Frame-Options`: `DENY`
   * `Content-Security-Policy` (CSP): Strict default policy.
2. **CORS Policy:**
   * Whitelist explicit mobile and web client domains.
   * `Access-Control-Allow-Origin: *` is **STRICTLY PROHIBITED** on authenticated routes with credentials.
   * `credentials: true` enabled for HTTP-only cookie transmission.

---

## 27. Secrets and Environment Variables

1. **No Hardcoded Secrets:** No API keys, JWT secrets, database passwords, or AWS keys are committed to Git.
2. **Startup Environment Validation:** Application boot scripts validate all required environment variables using Zod schemas at startup (`src/config/env.ts`). If any secret is missing, the application crashes immediately with a configuration error.

---

## 28. File Upload Security

1. **Direct-to-S3 Architecture:** Uploads bypass application servers, eliminating server memory starvation / DoS attacks.
2. **MIME & Extension Whitelist:** Only `image/jpeg`, `image/png`, `image/webp` MIME types are permitted.
3. **Isolated S3 Key Generation:** Storage keys use server-generated UUIDs (`photos/{userId}/{uuid}.webp`). Client-provided original filenames are never used as storage paths.

---

## 29. Account Deletion and Data Retention

1. **Soft Delete Implementation:** User deletion sets `users.deleted_at = CURRENT_TIMESTAMP`, `status = 'DELETED'`, and revokes all active refresh tokens.
2. **Cascade Protection:** Financial transaction records (`payments`) and safety moderation records (`reports`) retain references with `ON DELETE SET NULL` to ensure tax and legal compliance.
3. **Hard Purge Window:** An automated background job permanently purges soft-deleted user records and removes S3 media binaries after a **30-day compliance retention window**.

---

## 30. Security Testing Standards

1. **Unit Security Tests:** Verify password hashing, JWT signing/expiration, Zod schema edge cases, and entitlement evaluations.
2. **Integration Security Tests (Supertest):**
   * Attempt IDOR access on profiles and messages.
   * Attempt discovery swipe bypassing when daily limits are reached.
   * Verify "Who Liked You" response censoring for Free tier users.
   * Verify Webhook HMAC signature verification and rejection of forged signatures.
3. **Negative Security Scenarios:**
   * Sending media messages from a Free user account (must return `403 PREMIUM_REQUIRED`).
   * Submitting negative or zero pricing in payment checkouts.
   * Accessing admin routes with standard `USER` tokens.

---

## 31. Developer Security Checklist

Before creating a Pull Request or deploying code, verify that all applicable items are satisfied:

### Authentication & Passwords
* [ ] Passwords hashed using Argon2id with verified parameters.
* [ ] JWT access token is short-lived (15 min) and contains no sensitive PII.
* [ ] Refresh token is transported in an `HttpOnly`, `Secure`, `SameSite=Strict` cookie.
* [ ] Refresh token rotation and reuse detection are enforced.
* [ ] Account logout revokes the refresh token in the database.

### Authorization & IDOR
* [ ] Authenticated endpoints enforce `auth.middleware.ts`.
* [ ] Admin endpoints enforce `requireRole('ADMIN')`.
* [ ] Resource ownership verified for all mutating operations (`resource.user_id === req.user.id`).
* [x] UNMATCH (`DELETE /api/v1/matches/:matchId`) allows either participant of an `ACTIVE` match and returns `404 MATCH_NOT_FOUND` for every other match id. It does not use Redis.
* [x] Send message (`POST /api/v1/conversations/:conversationId/messages`) verifies participant ownership, active match/conversation state, and bidirectional blocks. Missing or foreign conversations return `404 RESOURCE_NOT_FOUND`.

### Privacy & Data Protection
* [ ] Exact spatial coordinates (`latitude`, `longitude`) are NEVER returned in API responses.
* [ ] "Who Liked You" admirer details are redacted server-side for Free users.
* [ ] Response serializers are used to whitelist returned JSON attributes.
* [ ] Password hashes and tokens are excluded from Sequelize default scopes.

### Validation & Injection
* [ ] Request body, query parameters, and URL params validated using Zod.
* [ ] SQL queries use Sequelize parameterization (no raw string interpolation).
* [ ] JSON payload sizes are capped at 100 KiB.

### Monetization & Payments
* [ ] Entitlements are evaluated dynamically from server-side subscriptions.
* [x] Free LIKE and PASS quota (10 per UTC day) is enforced atomically in `usage_records`. Free TEXT message quota (20 per UTC day, metric `DAILY_TEXT_MESSAGES`) is enforced atomically in the same ledger after authorization. Premium callers bypass both quotas and do not write usage for those metrics. Redis is not used for product quotas.
* [ ] Plan pricing is resolved server-side; client prices are ignored.
* [ ] Razorpay webhook HMAC signatures are verified before processing.
* [ ] Webhook processing is idempotent via `processed_webhooks`.

### File Uploads & S3
* [ ] Media uploaded directly to S3 via presigned URLs.
* [ ] S3 bucket has public access blocked.
* [ ] S3 object keys are generated using random UUIDs.

---

## 32. Open Questions / Conflicts

### SEC-OQ-01: Multi-Device Push Notification Payload Security
* **Issue:** When dispatching FCM/APNS push notifications for new messages or likes, should message text previews and admirer names be included in the push payload?
* **Why it matters:** Lock-screen push notifications could leak sensitive dating activity or message snippets to unauthorized onlookers.
* **Current recommendation:** Push notifications should display generic alerts by default (e.g., *"You have a new message"*, *"Someone liked your profile"*) without embedding private chat content or sender identities in the raw push payload.
* **Needs product decision:** No (Follows security best practices for dating privacy).

### SEC-OQ-02: Automated Image Moderation (NSFW / Nudity Detection)
* **Issue:** Product Requirements designate automated photo moderation as Phase 1.5. In Phase 1, photos are uploaded directly to S3 without automated scanning.
* **Why it matters:** Malicious users could upload inappropriate profile pictures before human admin review occurs via the reporting queue.
* **Current recommendation:** Rely on user reporting (`reports` table) and manual admin review for Phase 1. Integrate AWS Rekognition in Phase 1.5 via S3 event triggers.
* **Needs product decision:** No (Aligned with approved Phase 1 vs Phase 1.5 scope).
