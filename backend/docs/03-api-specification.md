# Love Bite - API Specification & Contract

> **Document Path:** `backend/docs/03-api-specification.md`  
> **Target Version:** API v1 (`/api/v1`)  
> **Status:** Authoritative Backend Contract Specification  
> **Architecture Pattern:** Route $\rightarrow$ Controller $\rightarrow$ Service $\rightarrow$ Data Access $\rightarrow$ Sequelize Model $\rightarrow$ PostgreSQL/PostGIS

---

## 1. Overview

This document defines the complete, implementation-ready **RESTful API Specification** and **Socket.IO Realtime Contract** for the **Love Bite** dating platform. It serves as the single source of truth for frontend mobile/web engineers, backend engineers, and QA automation suites.

### Core Architectural Principles:
* **Strict REST Semantics:** Standard HTTP verbs (`GET`, `POST`, `PATCH`, `PUT`, `DELETE`) with resource-oriented URIs.
* **Dual-Token Authentication:** Ephemeral JWT Access Tokens (15-minute validity) paired with Rotating Refresh Tokens delivered via secure `HTTP-Only`, `SameSite=Strict`, `Secure` cookies.
* **Centralized Entitlements & Server-Side Enforcement:** Feature gating (Free vs. Premium tiers) and rate/usage quota limits (10 combined Swipes/day, 20 text messages/day for Free users) are strictly verified server-side. Frontend clients are never trusted with entitlement decisions.
* **Privacy & Security by Design:** 
  * Exact spatial coordinates (`latitude`, `longitude`) are **NEVER** returned in any client payload. Clients receive only the registered `city` and an approximate server-calculated distance in kilometers.
  * Liker identities for non-paying Free users are filtered server-side (returning only aggregate counts, with zero personal metadata or photos in API responses).
* **Idempotent Financial Operations:** Razorpay webhook events and client checkout verifications are guaranteed idempotent via database transaction boundaries and unique event ledgers.
* **Realtime Synchronization:** Socket.IO handles low-latency chat delivery and instant match alerts, backed by PostgreSQL as the authoritative persistence tier.

---

## 2. API Design Principles

1. **Layered Separation of Concerns:**
   * **Routes:** Define endpoint paths, bind HTTP verbs, and register middleware chains (`validate`, `authenticate`, `requireRole`, `rateLimit`).
   * **Controllers:** Extract parameters, headers, cookies, and validated bodies; invoke domain services; serialize standard JSON HTTP responses.
   * **Services:** Enforce all business rules, eligibility evaluations, entitlement checks, quota tracking, and multi-entity database transactions.
   * **Data Access:** Execute parameterized Sequelize queries, raw PostGIS spatial expressions, and transaction-bound writes.
2. **Predictable URL Structure:** Plural resource nouns prefixed by the API version: `/api/v1/<resource-name>`.
3. **Deterministic Status Codes:**
   * `200 OK` — Successful retrieval or idempotent mutation.
   * `201 Created` — Successful resource creation.
   * `204 No Content` — Successful deletion or action with no response payload.
   * `400 Bad Request` — Schema validation failure or invalid payload structure.
   * `401 Unauthorized` — Missing, expired, or cryptographically invalid JWT access token.
   * `403 Forbidden` — Insufficient role permissions or gated Premium feature entitlement required.
   * `404 Not Found` — Requested entity does not exist or has been soft-deleted.
   * `409 Conflict` — State conflict (e.g., unique constraint violation, duplicate like action).
   * `422 Unprocessable Entity` — Syntactically valid request failing domain business rules (e.g., underage registration).
   * `429 Too Many Requests` — Abuse-prevention rate limit or daily product usage quota exhausted.
   * `500 Internal Server Error` — Unhandled server exception (sanitized in production).

---

## 3. Base URL

All REST endpoints are rooted at:

```text
/api/v1
```

*Example:* `GET /api/v1/profiles/me`

---

## 4. Authentication

### 4.1 Token Mechanics
* **Access Token:** Short-lived JWT (15 minutes). Contains minimal payload:
  ```json
  {
    "sub": "b2f6c91a-8821-4122-901b-5e4d29381029",
    "role": "USER",
    "isVerified": true,
    "isProfileComplete": true,
    "iat": 1789456000,
    "exp": 1789456900
  }
  ```
  Sent by client in the HTTP Authorization header: `Authorization: Bearer <access_token>`.
* **Refresh Token:** Long-lived cryptographically random token (7 days). Stored in a secure `HTTP-Only`, `SameSite=Strict`, `Secure` cookie named `refreshToken` with path `/api/v1/auth/refresh`.
* **Token Rotation:** Exchanging a refresh token generates a brand new access token and a new refresh token cookie, invalidating the previous token in the `auth_refresh_tokens` database table.
* **Token Revocation:** Logging out or administrative account suspension instantly revokes active refresh tokens across PostgreSQL and Redis session caches.

### 4.2 Endpoint Authentication Classification
* **Public Endpoints:** Accessible without authentication (e.g., `/auth/register`, `/auth/login`, `/auth/verify-*`, `/interests`, `/relationship-intentions`, `/subscriptions/plans`, `/webhooks/*`).
* **Authenticated Endpoints:** Require a valid `Bearer` access token and active account status (`status = 'ACTIVE'`).
* **Admin Endpoints:** Require an authenticated session with `role = 'ADMIN'`.

---

## 5. Authorization

Authorization is verified across four distinct tiers:
1. **Authentication Middleware (`auth.middleware.ts`):** Validates access token signature, checks user active status, and binds `req.user`.
2. **Role Authorization (`role.middleware.ts`):** Checks role privileges (e.g., `requireRole('ADMIN')`).
3. **Resource Ownership Guardrails:** Ensures users can only mutate their own records (e.g., `profiles.user_id === req.user.id`).
4. **Entitlement Guardrails (`entitlement.middleware.ts`):** Verifies active subscription feature entitlements and evaluates daily usage limits.

---

## 6. Common Request Format

* Standard HTTP request headers:
  * `Content-Type: application/json` (for JSON bodies)
  * `Authorization: Bearer <token>` (for authenticated endpoints)
  * `Idempotency-Key: <UUIDv4>` (optional/mandatory for state-mutating checkout/actions)
  * `X-Request-ID: <UUIDv4>` (client-supplied or generated by gateway for distributed tracing)

---

## 7. Common Response Format

### 7.1 Standard Success Response
```json
{
  "success": true,
  "data": {},
  "message": "Operation completed successfully"
}
```

### 7.2 Standard Paginated Success Response
```json
{
  "success": true,
  "data": {
    "items": [],
    "pagination": {
      "nextCursor": "eyJjcmVhdGVkQXQiOiIyMDI2LTA5LTE1VDEyOjAwOjAwLjAwMFoiLCJpZCI6InV1aWQtMSJ9",
      "hasMore": true,
      "limit": 20
    }
  }
}
```

---

## 8. Error Handling

All failed HTTP requests return a standardized, machine-parseable JSON error envelope:

```json
{
  "success": false,
  "error": {
    "code": "EXCEEDED_DAILY_LIKE_LIMIT",
    "message": "You have reached your daily limit of 10 likes/passes.",
    "details": [],
    "timestamp": "2026-09-15T10:30:00.000Z",
    "requestId": "c1a9f4e2-8821-4122-901b"
  }
}
```

### Core Error Codes Catalog:
| Error Code | HTTP Status | Meaning |
| :--- | :--- | :--- |
| `AUTH_REQUIRED` | 401 | Missing or malformed Authorization header. |
| `INVALID_TOKEN` | 401 | Expired, revoked, or signature-invalid JWT. |
| `INVALID_CREDENTIALS` | 401 | Email/Phone and password combination does not match. |
| `EMAIL_NOT_VERIFIED` | 403 | Account requires email verification. |
| `PHONE_NOT_VERIFIED` | 403 | Account requires SMS OTP verification. |
| `ACCOUNT_SUSPENDED` | 403 | User account is temporarily suspended by admin. |
| `ACCOUNT_BANNED` | 403 | User account has been permanently terminated. |
| `PROFILE_INCOMPLETE` | 403 | Onboarding is incomplete; discovery/matching locked. |
| `PREMIUM_REQUIRED` | 403 | Feature requires an active Premium subscription. |
| `FORBIDDEN` | 403 | Insufficient role permissions or resource access denied. |
| `RESOURCE_NOT_FOUND` | 404 | Target entity does not exist or is soft-deleted. |
| `USER_NOT_FOUND` | 404 | Target user profile not found. |
| `MATCH_NOT_FOUND` | 404 | Active match record does not exist. |
| `CONVERSATION_CLOSED` | 404 | Conversation is closed due to unmatch or safety block. |
| `DUPLICATE_IDENTIFIER` | 409 | Email or phone is already registered to an active account. |
| `ALREADY_SWIPED` | 409 | Target user has already been liked or permanently passed. |
| `ACTIVE_MATCH_EXISTS` | 409 | Users are already in an active mutual match. |
| `BLOCKED_USER` | 409 | Interaction prohibited due to an active safety block. |
| `VALIDATION_ERROR` | 400 | Request body/query failed Zod structural validation. |
| `UNDERAGE_NOT_PERMITTED`| 422 | User date of birth indicates age < 18 years. |
| `DAILY_LIMIT_REACHED` | 429 | Free tier daily swipe or message quota exhausted. |
| `RATE_LIMITED` | 429 | Exceeded endpoint request threshold per time window. |
| `PAYMENT_FAILED` | 402 | Gateway payment initiation or capture failed. |
| `IDEMPOTENCY_CONFLICT` | 409 | Concurrent request with identical Idempotency-Key in flight. |
| `INTERNAL_SERVER_ERROR`| 500 | Unexpected server error. |

---

## 9. Pagination Strategy

### 9.1 Cursor-Based Pagination (Feeds & Infinite Streams)
Used for Discovery candidates, Chat Messages, Inbox Dialogs, and Notifications.
* **Query Parameters:**
  * `limit`: Integer (Default: `20`, Max: `50`).
  * `cursor`: Base64-encoded string representing `(created_at, id)`.
* **Response Pagination Object:**
  ```json
  "pagination": {
    "nextCursor": "eyJjcmVhdGVkQXQiOiIyMDI2LTA5LTE1VDEyOjAwOjAwLjAwMFoiLCJpZCI6IjY2ZTIxYzg1..."},
    "hasMore": true,
    "limit": 20
  }
  ```

### 9.2 Offset-Based Pagination (Admin & Search)
Used exclusively for Admin Management Tables where jumping to arbitrary page numbers is required.
* **Query Parameters:**
  * `page`: Integer (Default: `1`).
  * `limit`: Integer (Default: `20`, Max: `100`).
* **Response Pagination Object:**
  ```json
  "pagination": {
    "total": 154,
    "page": 1,
    "limit": 20,
    "totalPages": 8
  }
  ```

---

## 10. API Versioning

* Versioning is embedded in the URI path: `/api/v1/`.
* Breaking schema or behavioral modifications require incrementing the route version (e.g., `/api/v2/`).

---

## 11. Authentication APIs

### 11.1 Register Account
* **Method & Path:** `POST /api/v1/auth/register`
* **Auth:** Public
* **Purpose:** Creates a new user account with Email OR Phone credentials.
* **Request Body:**
  ```json
  {
    "email": "alex.morgan@example.com",
    "phone": "+919876543210",
    "password": "SecurePassword123!",
    "dateOfBirth": "2002-06-15",
    "termsAccepted": true,
    "privacyAccepted": true
  }
  ```
* **Validation (Zod):**
  * At least one of `email` (valid email string) OR `phone` (E.164 string) required.
  * `password`: String, min 8 chars, min 1 uppercase, min 1 number, min 1 special char.
  * `dateOfBirth`: ISO 8601 date (`YYYY-MM-DD`). Validates age $\ge 18$ years.
  * `termsAccepted`: Literal `true`.
  * `privacyAccepted`: Literal `true`.
* **Success Response (`201 Created`):**
  ```json
  {
    "success": true,
    "data": {
      "userId": "b2f6c91a-8821-4122-901b-5e4d29381029",
      "email": "alex.morgan@example.com",
      "phone": "+919876543210",
      "status": "UNVERIFIED",
      "emailVerified": false,
      "phoneVerified": false,
      "nextStep": "VERIFY_EMAIL"
    },
    "message": "Registration successful. Please verify your account."
  }
  ```
* **Errors:** `409 DUPLICATE_IDENTIFIER`, `422 UNDERAGE_NOT_PERMITTED`, `400 VALIDATION_ERROR`.

---

### 11.2 Verify Email
* **Method & Path:** `POST /api/v1/auth/verify-email`
* **Auth:** Public
* **Request Body:**
  ```json
  {
    "email": "alex.morgan@example.com",
    "token": "481920"
  }
  ```
* **Success Response (`200 OK`):**
  ```json
  {
    "success": true,
    "data": {
      "verified": true,
      "status": "ACTIVE"
    },
    "message": "Email verified successfully."
  }
  ```

---

### 11.3 Verify Phone OTP
* **Method & Path:** `POST /api/v1/auth/verify-phone`
* **Auth:** Public
* **Request Body:**
  ```json
  {
    "phone": "+919876543210",
    "otp": "839201"
  }
  ```
* **Success Response (`200 OK`):**
  ```json
  {
    "success": true,
    "data": {
      "verified": true,
      "status": "ACTIVE"
    },
    "message": "Phone number verified successfully."
  }
  ```

---

### 11.4 Resend Verification Code
* **Method & Path:** `POST /api/v1/auth/resend-verification`
* **Auth:** Public (Rate limited: 1 req/60s per identifier)
* **Request Body:**
  ```json
  {
    "identifier": "alex.morgan@example.com",
    "type": "EMAIL"
  }
  ```
* **Success Response (`200 OK`):**
  ```json
  {
    "success": true,
    "data": { "sent": true },
    "message": "Verification code resent."
  }
  ```

---

### 11.5 Login
* **Method & Path:** `POST /api/v1/auth/login`
* **Auth:** Public
* **Request Body:**
  ```json
  {
    "identifier": "alex.morgan@example.com",
    "password": "SecurePassword123!"
  }
  ```
* **Success Response (`200 OK`):** Sets `Set-Cookie: refreshToken=...; HttpOnly; Secure; SameSite=Strict; Path=/api/v1/auth/refresh`.
  ```json
  {
    "success": true,
    "data": {
      "accessToken": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
      "expiresIn": 900,
      "user": {
        "id": "b2f6c91a-8821-4122-901b-5e4d29381029",
        "email": "alex.morgan@example.com",
        "phone": "+919876543210",
        "role": "USER",
        "status": "ACTIVE",
        "isVerified": true,
        "isProfileComplete": false
      }
    },
    "message": "Login successful."
  }
  ```
* **Errors:** `401 INVALID_CREDENTIALS`, `403 ACCOUNT_SUSPENDED`, `403 ACCOUNT_BANNED`.

---

### 11.6 Refresh Access Token
* **Method & Path:** `POST /api/v1/auth/refresh`
* **Auth:** Public (Reads `refreshToken` HTTP-only cookie)
* **Success Response (`200 OK`):** Sets rotated `refreshToken` cookie.
  ```json
  {
    "success": true,
    "data": {
      "accessToken": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
      "expiresIn": 900
    },
    "message": "Token refreshed."
  }
  ```
* **Errors:** `401 INVALID_TOKEN`.

---

### 11.7 Logout
* **Method & Path:** `POST /api/v1/auth/logout`
* **Auth:** Authenticated
* **Purpose:** Revokes active refresh token in database and clears client cookie.
* **Success Response (`200 OK`):**
  ```json
  {
    "success": true,
    "data": null,
    "message": "Logged out successfully."
  }
  ```

---

### 11.8 Forgot Password
* **Method & Path:** `POST /api/v1/auth/forgot-password`
* **Auth:** Public
* **Request Body:**
  ```json
  {
    "identifier": "alex.morgan@example.com"
  }
  ```
* **Success Response (`200 OK`):** Returns generic success message to prevent user enumeration.

---

### 11.9 Reset Password
* **Method & Path:** `POST /api/v1/auth/reset-password`
* **Auth:** Public
* **Request Body:**
  ```json
  {
    "identifier": "alex.morgan@example.com",
    "token": "928374",
    "newPassword": "NewSecurePassword123!"
  }
  ```
* **Success Response (`200 OK`):**
  ```json
  {
    "success": true,
    "data": null,
    "message": "Password reset successfully. Please log in."
  }
  ```

---

## 12. Onboarding APIs

The onboarding pipeline enforces sequential profile completion before granting access to discovery.

### 12.1 Get Onboarding Status
* **Method & Path:** `GET /api/v1/onboarding/status`
* **Auth:** Authenticated
* **Success Response (`200 OK`):**
  ```json
  {
    "success": true,
    "data": {
      "isVerified": true,
      "isProfileComplete": false,
      "completedSteps": ["VERIFICATION", "BASIC_PROFILE", "PHOTOS"],
      "nextStep": "INTERESTS"
    }
  }
  ```

---

### 12.2 Save Basic Profile Info
* **Method & Path:** `PATCH /api/v1/onboarding/profile`
* **Auth:** Authenticated
* **Request Body:**
  ```json
  {
    "firstName": "Alex",
    "genderId": "9a12c4b5-8821-4122-901b-5e4d29381001",
    "bio": "Adventure enthusiast, coffee lover, and dog parent.",
    "occupation": "Software Engineer",
    "education": "B.Tech Computer Science"
  }
  ```
* **Validation:** `firstName` (1–50 chars), `genderId` (valid UUID referencing active gender), `bio` (max 500 chars).
* **Success Response (`200 OK`):** Returns updated profile summary.

---

### 12.3 Set Onboarding Interests
* **Method & Path:** `PUT /api/v1/onboarding/interests`
* **Auth:** Authenticated
* **Request Body:**
  ```json
  {
    "interestIds": [
      "1a2b3c4d-0001-4000-8000-000000000001",
      "1a2b3c4d-0002-4000-8000-000000000002",
      "1a2b3c4d-0003-4000-8000-000000000003"
    ]
  }
  ```
* **Validation:** Array of active interest UUIDs, **min 3, max 10 items**.
* **Success Response (`200 OK`):** Returns selected interest list.

---

### 12.4 Set Onboarding Relationship Intentions
* **Method & Path:** `PUT /api/v1/onboarding/relationship-intentions`
* **Auth:** Authenticated
* **Request Body:**
  ```json
  {
    "relationshipIntentionIds": [
      "2a3b4c5d-0001-4000-8000-000000000001"
    ]
  }
  ```
* **Validation:** Array of active intention UUIDs, **min 1 item**.
* **Success Response (`200 OK`):** Returns selected intention list.

---

### 12.5 Set Onboarding Dating Preferences
* **Method & Path:** `PUT /api/v1/onboarding/dating-preferences`
* **Auth:** Authenticated
* **Request Body:**
  ```json
  {
    "minAge": 22,
    "maxAge": 32,
    "maxDistanceKm": 40,
    "interestedInGenderIds": [
      "9a12c4b5-8821-4122-901b-5e4d29381002"
    ],
    "preferredIntentionIds": [
      "2a3b4c5d-0001-4000-8000-000000000001"
    ]
  }
  ```
* **Validation:** `minAge >= 18`, `maxAge <= 100`, `maxAge >= minAge`, `maxDistanceKm` between 1 and 500.
* **Success Response (`200 OK`):** Returns stored dating preferences.

---

### 12.6 Set Onboarding Location
* **Method & Path:** `PUT /api/v1/onboarding/location`
* **Auth:** Authenticated
* **Request Body:**
  ```json
  {
    "city": "Bengaluru",
    "latitude": 12.9716,
    "longitude": 77.5946
  }
  ```
* **Validation:** `city` (string, max 100), `latitude` (-90 to 90), `longitude` (-180 to 180).
* **Success Response (`200 OK`):** Returns `{ "city": "Bengaluru", "updated": true }`. *Coordinates are never reflected.*

---

### 12.7 Finalize Onboarding & Complete Profile
* **Method & Path:** `POST /api/v1/onboarding/complete`
* **Auth:** Authenticated
* **Purpose:** Server validates all onboarding prerequisites (verification, basic profile, $\ge 1$ photo, 3–10 interests, $\ge 1$ intention, dating preferences, location).
* **Success Response (`200 OK`):**
  ```json
  {
    "success": true,
    "data": {
      "isProfileComplete": true,
      "status": "ACTIVE"
    },
    "message": "Onboarding complete! Welcome to Love Bite."
  }
  ```
* **Errors:** `400 PROFILE_INCOMPLETE` with `details` listing missing prerequisite steps.

---

## 13. Profile APIs

### 13.1 Get Current User Profile (Private View)
* **Method & Path:** `GET /api/v1/profiles/me`
* **Auth:** Authenticated
* **Success Response (`200 OK`):**
  ```json
  {
    "success": true,
    "data": {
      "id": "b2f6c91a-8821-4122-901b-5e4d29381029",
      "firstName": "Alex",
      "dateOfBirth": "2002-06-15",
      "age": 24,
      "gender": { "id": "9a12c4b5...", "name": "Woman", "code": "WOMAN" },
      "bio": "Adventure enthusiast and coffee lover.",
      "occupation": "Software Engineer",
      "education": "B.Tech Computer Science",
      "city": "Bengaluru",
      "isProfileComplete": true,
      "photos": [
        {
          "id": "photo-uuid-1",
          "url": "https://cdn.lovebite.app/signed/photos/...",
          "displayOrder": 1,
          "isPrimary": true
        }
      ],
      "interests": [
        { "id": "int-uuid-1", "name": "Hiking", "code": "HIKING" }
      ],
      "relationshipIntentions": [
        { "id": "int-uuid-1", "name": "Long-term relationship", "code": "LONG_TERM_RELATIONSHIP" }
      ]
    }
  }
  ```

---

### 13.2 Update Current User Profile
* **Method & Path:** `PATCH /api/v1/profiles/me`
* **Auth:** Authenticated
* **Request Body:** Partial profile fields (`firstName`, `bio`, `occupation`, `education`).  
  *Note: `dateOfBirth` cannot be modified post-onboarding without admin review.*
* **Success Response (`200 OK`):** Returns updated private profile.

---

### 13.3 View Another User's Profile (Public View)
* **Method & Path:** `GET /api/v1/profiles/:userId`
* **Auth:** Authenticated
* **Business Rules:**
  * Checks bidirectional block state (returns `404 NOT_FOUND` if blocked).
  * Obfuscates exact coordinates; returns only `city` and server-calculated `distanceKm`.
  * Returns active photos, interests, intentions, bio, occupation, and education.
* **Success Response (`200 OK`):**
  ```json
  {
    "success": true,
    "data": {
      "id": "c3e7d81b-9932-4233-812c-6f5e39482130",
      "firstName": "Jordan",
      "age": 25,
      "gender": { "name": "Man", "code": "MAN" },
      "bio": "Photographer exploring the world.",
      "occupation": "Freelance Designer",
      "education": "NID Ahmedabad",
      "city": "Bengaluru",
      "distanceKm": 4,
      "photos": [
        { "id": "photo-uuid-2", "url": "https://cdn.lovebite.app/signed/...", "displayOrder": 1, "isPrimary": true }
      ],
      "interests": [
        { "id": "int-1", "name": "Photography" },
        { "id": "int-2", "name": "Travel" },
        { "id": "int-3", "name": "Art" }
      ],
      "relationshipIntentions": [
        { "id": "rel-1", "name": "Long-term relationship" }
      ]
    }
  }
  ```

---

## 14. Photo APIs

### 14.1 Request Presigned S3 Upload Slot
* **Method & Path:** `POST /api/v1/profile-photos/upload-url`
* **Auth:** Authenticated
* **Purpose:** Generates a short-lived S3 `PutObject` presigned URL and reserves a photo slot.
* **Request Body:**
  ```json
  {
    "mimeType": "image/webp",
    "fileSizeBytes": 2048576,
    "originalFilename": "profile_pic.webp"
  }
  ```
* **Validation:** `mimeType` in `['image/jpeg', 'image/png', 'image/webp']`, `fileSizeBytes <= 10485760` (10 MB). Max 5 active photos per user.
* **Success Response (`200 OK`):**
  ```json
  {
    "success": true,
    "data": {
      "photoId": "photo-uuid-1",
      "uploadUrl": "https://lovebite-private-photos.s3.amazonaws.com/photos/user-id/photo-uuid-1.webp?X-Amz-...",
      "storageKey": "photos/b2f6c91a.../photo-uuid-1.webp",
      "expiresInSeconds": 300
    }
  }
  ```

---

### 14.2 Confirm Uploaded Photo Metadata
* **Method & Path:** `POST /api/v1/profile-photos/confirm`
* **Auth:** Authenticated
* **Request Body:**
  ```json
  {
    "photoId": "photo-uuid-1",
    "storageKey": "photos/b2f6c91a.../photo-uuid-1.webp",
    "displayOrder": 1,
    "isPrimary": true
  }
  ```
* **Success Response (`201 Created`):** Returns confirmed photo metadata.

---

### 14.3 List Current User Photos
* **Method & Path:** `GET /api/v1/profile-photos`
* **Auth:** Authenticated
* **Success Response (`200 OK`):** Returns array of photo objects with signed GET CDN URLs.

---

### 14.4 Update Photo Order or Primary Flag
* **Method & Path:** `PATCH /api/v1/profile-photos/:photoId`
* **Auth:** Authenticated
* **Request Body:**
  ```json
  {
    "displayOrder": 2,
    "isPrimary": false
  }
  ```
* **Success Response (`200 OK`):** Returns updated photo list.

---

### 14.5 Delete Photo
* **Method & Path:** `DELETE /api/v1/profile-photos/:photoId`
* **Auth:** Authenticated
* **Business Rules:**
  * Cannot delete if it is the only remaining photo of a completed profile (minimum 1 required).
  * If the primary photo is deleted, the next photo in `displayOrder` is automatically designated primary.
* **Success Response (`200 OK`):** Returns `{ "deleted": true }`.

---

## 15. Interest APIs

### 15.1 List Active Interests
* **Method & Path:** `GET /api/v1/interests`
* **Auth:** Public / Authenticated
* **Success Response (`200 OK`):**
  ```json
  {
    "success": true,
    "data": [
      { "id": "int-uuid-1", "code": "HIKING", "name": "Hiking & Outdoors", "category": "Sports" },
      { "id": "int-uuid-2", "code": "COFFEE", "name": "Coffee & Cafes", "category": "Food & Drink" }
    ]
  }
  ```

---

### 15.2 Update Current User Interests
* **Method & Path:** `PUT /api/v1/me/interests`
* **Auth:** Authenticated
* **Request Body:** `{ "interestIds": ["uuid-1", "uuid-2", "uuid-3"] }` (min 3, max 10).
* **Success Response (`200 OK`):** Returns updated user interest list.

---

## 16. Relationship Intention APIs

### 16.1 List Active Relationship Intentions
* **Method & Path:** `GET /api/v1/relationship-intentions`
* **Auth:** Public / Authenticated
* **Success Response (`200 OK`):** Returns catalog of active intentions (`LONG_TERM_RELATIONSHIP`, `SOMETHING_CASUAL`, `FRIENDSHIP`, `NOT_SURE_YET`).

---

### 16.2 Update Current User Intentions
* **Method & Path:** `PUT /api/v1/me/relationship-intentions`
* **Auth:** Authenticated
* **Request Body:** `{ "relationshipIntentionIds": ["uuid-1", "uuid-2"] }` ($\ge 1$).
* **Success Response (`200 OK`):** Returns updated intentions list.

---

## 17. Dating Preference APIs

### 17.1 Get Dating Preferences
* **Method & Path:** `GET /api/v1/dating-preferences`
* **Auth:** Authenticated
* **Success Response (`200 OK`):**
  ```json
  {
    "success": true,
    "data": {
      "minAge": 21,
      "maxAge": 30,
      "maxDistanceKm": 35,
      "interestedInGenders": [
        { "id": "gen-1", "code": "WOMAN", "name": "Woman" }
      ],
      "preferredIntentions": [
        { "id": "rel-1", "code": "LONG_TERM_RELATIONSHIP", "name": "Long-term relationship" }
      ]
    }
  }
  ```

---

### 17.2 Update Dating Preferences
* **Method & Path:** `PUT /api/v1/dating-preferences`
* **Auth:** Authenticated
* **Request Body:**
  ```json
  {
    "minAge": 21,
    "maxAge": 30,
    "maxDistanceKm": 35,
    "interestedInGenderIds": ["gen-1"],
    "preferredIntentionIds": ["rel-1"]
  }
  ```
* **Success Response (`200 OK`):** Returns updated preferences.

---

## 18. Location APIs

### 18.1 Update User Location
* **Method & Path:** `PUT /api/v1/location`
* **Auth:** Authenticated
* **Request Body:**
  ```json
  {
    "city": "Bengaluru",
    "latitude": 12.9716,
    "longitude": 77.5946
  }
  ```
* **Success Response (`200 OK`):**
  ```json
  {
    "success": true,
    "data": { "city": "Bengaluru", "updated": true },
    "message": "Location updated."
  }
  ```

---

## 19. Discovery APIs

### 19.1 Get Next Discovery Candidate Card
* **Method & Path:** `GET /api/v1/discovery`
* **Auth:** Authenticated
* **Behavior & Business Rules:**
  * Evaluates PostGIS mutual distance (`ST_DWithin`) using `idx_profiles_location_gist`.
  * Enforces mutual age, gender, and relationship intention filters.
  * Excludes: self, incomplete profiles, inactive accounts, active matches, blocks, and permanently passed profiles.
  * Applies Boost multipliers to discovery candidate ranking.
  * **Quota Rule:** Browsing candidate profiles is **unlimited for both Free and Premium users**. Quota is consumed ONLY upon submitting a Like or Pass action.
* **Success Response (`200 OK`):**
  ```json
  {
    "success": true,
    "data": {
      "candidate": {
        "id": "c3e7d81b-9932-4233-812c-6f5e39482130",
        "firstName": "Jordan",
        "age": 25,
        "gender": { "name": "Woman", "code": "WOMAN" },
        "bio": "Designer & coffee enthusiast.",
        "occupation": "Product Designer",
        "education": "NID",
        "city": "Bengaluru",
        "distanceKm": 4,
        "isSuperLiked": false,
        "photos": [
          { "id": "p-1", "url": "https://cdn.lovebite.app/signed/...", "displayOrder": 1, "isPrimary": true },
          { "id": "p-2", "url": "https://cdn.lovebite.app/signed/...", "displayOrder": 2, "isPrimary": false }
        ],
        "interests": [{ "id": "int-1", "name": "Design" }, { "id": "int-2", "name": "Coffee" }],
        "relationshipIntentions": [{ "id": "rel-1", "name": "Long-term relationship" }]
      }
    }
  }
  ```
  *(Returns `data: { "candidate": null }` if no eligible candidates remain in the stack).*

---

## 20. Like / Pass APIs

### 20.1 Like a Profile
* **Method & Path:** `POST /api/v1/discovery/:userId/like`
* **Auth:** Authenticated
* **Quota Enforcement:** 
  * Free users: Consumes 1 from the combined 10 daily Like/Pass quota. Throws `429 DAILY_LIMIT_REACHED` if exhausted.
  * Premium users: Unlimited actions.
* **Transaction Execution:**
  * Checks for reciprocal like with row lock (`SELECT FOR UPDATE`).
  * If reciprocal like exists $\rightarrow$ Creates `matches` row (`status = 'ACTIVE'`) + creates `conversations` row + emits realtime `match:new` Socket.IO event.
* **Success Response (`200 OK`):**
  ```json
  {
    "success": true,
    "data": {
      "action": "LIKE",
      "targetUserId": "c3e7d81b-9932-4233-812c-6f5e39482130",
      "isMatch": true,
      "matchId": "m-8821c4b5-1111-4000-8000-000000000001",
      "remainingDailyActions": 9
    },
    "message": "It's a Match!"
  }
  ```

---

### 20.2 Pass a Profile
* **Method & Path:** `POST /api/v1/discovery/:userId/pass`
* **Auth:** Authenticated
* **Quota Enforcement:** Consumes 1 from combined 10 daily quota for Free users.
* **Permanence:** Stored in `likes` (`action = 'PASS'`). Excludes candidate permanently from future discovery.
* **Success Response (`200 OK`):**
  ```json
  {
    "success": true,
    "data": {
      "action": "PASS",
      "targetUserId": "c3e7d81b-9932-4233-812c-6f5e39482130",
      "remainingDailyActions": 8
    },
    "message": "Profile passed."
  }
  ```

---

### 20.3 Super Like a Profile
* **Method & Path:** `POST /api/v1/discovery/:userId/super-like`
* **Auth:** Authenticated (Requires active Super Like credit balance)
* **Success Response (`200 OK`):** Returns action summary and decremented Super Like balance.

---

## 21. Undo APIs

### 21.1 Undo Immediately Preceding Action
* **Method & Path:** `POST /api/v1/discovery/undo`
* **Auth:** Authenticated (Premium Entitlement: `UNDO_ACTION`)
* **Business Rules:**
  * Restricted to active Premium subscribers (Free users receive `403 PREMIUM_REQUIRED`).
  * Reverts only the immediately previous action (`likes.is_undone = TRUE`).
  * If the previous action created an active match, the transaction invalidates the `matches` record (`status = 'UNDONE'`), closes the conversation, and reverts state.
  * Undo does NOT consume daily Like/Pass quota.
* **Success Response (`200 OK`):**
  ```json
  {
    "success": true,
    "data": {
      "undoneAction": "PASS",
      "targetUserId": "c3e7d81b-9932-4233-812c-6f5e39482130",
      "revertedMatch": false
    },
    "message": "Previous action undone."
  }
  ```

---

## 22. Match APIs

### 22.1 List Active Matches
* **Method & Path:** `GET /api/v1/matches`
* **Auth:** Authenticated
* **Query Params:** `limit` (default 20), `cursor`
* **Success Response (`200 OK`):**
  ```json
  {
    "success": true,
    "data": {
      "items": [
        {
          "matchId": "m-8821c4b5-1111-4000-8000-000000000001",
          "matchedAt": "2026-09-15T08:30:00.000Z",
          "conversationId": "conv-uuid-1",
          "user": {
            "id": "c3e7d81b-9932-4233-812c-6f5e39482130",
            "firstName": "Jordan",
            "age": 25,
            "city": "Bengaluru",
            "primaryPhotoUrl": "https://cdn.lovebite.app/signed/..."
          },
          "lastMessage": {
            "content": "Hey Alex! Loved your hiking photos.",
            "sentAt": "2026-09-15T08:35:00.000Z"
          }
        }
      ],
      "pagination": { "nextCursor": null, "hasMore": false, "limit": 20 }
    }
  }
  ```

---

### 22.2 Unmatch a User
* **Method & Path:** `DELETE /api/v1/matches/:matchId`
* **Auth:** Authenticated
* **Business Rules:**
  * Transitions match `status = 'UNMATCHED'`, sets `unmatched_at = CURRENT_TIMESTAMP`, `unmatched_by_user_id = req.user.id`.
  * Closes conversation (`conversations.status = 'CLOSED'`).
  * Preserves message history in PostgreSQL for safety/audit compliance.
  * Allows legitimate future re-matching if users encounter each other again.
* **Success Response (`200 OK`):**
  ```json
  {
    "success": true,
    "data": { "unmatched": true },
    "message": "Unmatched successfully."
  }
  ```

---

## 23. Conversation APIs

### 23.1 List Inbox Conversations
* **Method & Path:** `GET /api/v1/conversations`
* **Auth:** Authenticated
* **Success Response (`200 OK`):** Returns cursor-paginated active conversation threads with unread counts and last message previews.

---

### 23.2 Get Conversation Details
* **Method & Path:** `GET /api/v1/conversations/:conversationId`
* **Auth:** Authenticated
* **Success Response (`200 OK`):** Returns conversation status, match participant metadata, and unread count.

---

## 24. Message APIs

### 24.1 List Messages in a Conversation
* **Method & Path:** `GET /api/v1/conversations/:conversationId/messages`
* **Auth:** Authenticated
* **Query Params:** `limit` (default 20), `cursor`
* **Success Response (`200 OK`):**
  ```json
  {
    "success": true,
    "data": {
      "items": [
        {
          "id": "msg-uuid-1",
          "conversationId": "conv-uuid-1",
          "senderId": "c3e7d81b-9932-4233-812c-6f5e39482130",
          "messageType": "TEXT",
          "content": "Hey Alex! How is your week going?",
          "mediaUrl": null,
          "readAt": "2026-09-15T08:40:00.000Z",
          "createdAt": "2026-09-15T08:35:00.000Z"
        }
      ],
      "pagination": { "nextCursor": null, "hasMore": false, "limit": 20 }
    }
  }
  ```

---

### 24.2 Send a Message
* **Method & Path:** `POST /api/v1/conversations/:conversationId/messages`
* **Auth:** Authenticated
* **Quota & Entitlement Rules:**
  * Free tier: Max 20 text messages/day. Attachments (`IMAGE`, `VIDEO`, `VOICE`, `GIF`) strictly prohibited (throws `403 PREMIUM_REQUIRED`).
  * Premium tier: Unlimited text messages + full media attachment permissions.
* **Request Body:**
  ```json
  {
    "messageType": "TEXT",
    "content": "Hey Jordan! Doing great, looking forward to the weekend."
  }
  ```
* **Success Response (`201 Created`):**
  ```json
  {
    "success": true,
    "data": {
      "id": "msg-uuid-2",
      "conversationId": "conv-uuid-1",
      "senderId": "b2f6c91a-8821-4122-901b-5e4d29381029",
      "messageType": "TEXT",
      "content": "Hey Jordan! Doing great, looking forward to the weekend.",
      "mediaUrl": null,
      "readAt": null,
      "createdAt": "2026-09-15T08:42:00.000Z",
      "remainingDailyMessages": 19
    }
  }
  ```

---

### 24.3 Mark Conversation Messages as Read
* **Method & Path:** `PATCH /api/v1/conversations/:conversationId/read`
* **Auth:** Authenticated
* **Success Response (`200 OK`):** Updates `read_at = CURRENT_TIMESTAMP` for unread messages and emits `chat:message:read` Socket.IO event.

---

## 25. Block APIs

### 25.1 Block a User
* **Method & Path:** `POST /api/v1/blocks/:userId`
* **Auth:** Authenticated
* **Business Rules:**
  * Immediately dissolves active matches, closes open conversations, and permanently isolates both profiles from discovery queues.
* **Success Response (`200 OK`):**
  ```json
  {
    "success": true,
    "data": { "blocked": true, "targetUserId": "c3e7d81b..." },
    "message": "User blocked successfully."
  }
  ```

---

### 25.2 List Blocked Users
* **Method & Path:** `GET /api/v1/blocks`
* **Auth:** Authenticated
* **Success Response (`200 OK`):** Returns list of blocked accounts.

---

### 25.3 Unblock a User
* **Method & Path:** `DELETE /api/v1/blocks/:userId`
* **Auth:** Authenticated
* **Success Response (`200 OK`):** Removes block record.

---

## 26. Report APIs

### 26.1 Report User Misconduct
* **Method & Path:** `POST /api/v1/reports`
* **Auth:** Authenticated
* **Request Body:**
  ```json
  {
    "reportedUserId": "c3e7d81b-9932-4233-812c-6f5e39482130",
    "reason": "INAPPROPRIATE_CONTENT",
    "description": "User posted offensive content in chat."
  }
  ```
* **Validation:** `reason` in `['FAKE_PROFILE', 'HARASSMENT', 'SPAM', 'INAPPROPRIATE_CONTENT', 'SCAM', 'OTHER']`.
* **Success Response (`201 Created`):**
  ```json
  {
    "success": true,
    "data": { "reportId": "rep-uuid-1", "status": "PENDING" },
    "message": "Report submitted. Our safety team will review it."
  }
  ```

---

## 27. Notification & "Who Liked You" APIs

### 27.1 List Notifications
* **Method & Path:** `GET /api/v1/notifications`
* **Auth:** Authenticated
* **Query Params:** `limit` (default 20), `cursor`
* **Success Response (`200 OK`):** Returns user notification feed (`NEW_MATCH`, `NEW_MESSAGE`, `NEW_LIKE`).

---

### 27.2 "Who Liked You" (Admirers Feed)
* **Method & Path:** `GET /api/v1/likes/who-liked-me`
* **Auth:** Authenticated
* **Security & Monetization Mandate:**
  * **Free Users:** Receive `{ "count": 5, "admirers": [] }`. **Zero user IDs, names, or photo URLs are returned.**
  * **Premium Users:** Receive full admirer profiles: `{ "count": 5, "admirers": [{ "userId": "...", "firstName": "Jordan", "photos": [...] }] }`.
* **Success Response for Free User (`200 OK`):**
  ```json
  {
    "success": true,
    "data": {
      "count": 5,
      "isUnlocked": false,
      "admirers": []
    },
    "message": "5 people liked your profile! Upgrade to Premium to see who."
  }
  ```
* **Success Response for Premium User (`200 OK`):**
  ```json
  {
    "success": true,
    "data": {
      "count": 5,
      "isUnlocked": true,
      "admirers": [
        {
          "userId": "c3e7d81b-9932-4233-812c-6f5e39482130",
          "firstName": "Jordan",
          "age": 25,
          "city": "Bengaluru",
          "distanceKm": 4,
          "likedAt": "2026-09-15T06:12:00.000Z",
          "primaryPhotoUrl": "https://cdn.lovebite.app/signed/..."
        }
      ]
    }
  }
  ```

---

## 28. Subscription APIs

### 28.1 List Subscription Plans
* **Method & Path:** `GET /api/v1/subscriptions/plans`
* **Auth:** Public / Authenticated
* **Success Response (`200 OK`):**
  ```json
  {
    "success": true,
    "data": [
      {
        "id": "plan-free",
        "code": "FREE",
        "name": "Free Tier",
        "priceInCents": 0,
        "currency": "INR",
        "billingInterval": "NONE"
      },
      {
        "id": "plan-premium-monthly",
        "code": "PREMIUM_MONTHLY",
        "name": "Love Bite Premium (Monthly)",
        "priceInCents": 49900,
        "currency": "INR",
        "billingInterval": "MONTH"
      },
      {
        "id": "plan-premium-yearly",
        "code": "PREMIUM_YEARLY",
        "name": "Love Bite Premium (Yearly)",
        "priceInCents": 399900,
        "currency": "INR",
        "billingInterval": "YEAR"
      }
    ]
  }
  ```

---

### 28.2 Get Current Active Subscription
* **Method & Path:** `GET /api/v1/subscriptions/me`
* **Auth:** Authenticated
* **Success Response (`200 OK`):**
  ```json
  {
    "success": true,
    "data": {
      "hasActiveSubscription": true,
      "plan": {
        "code": "PREMIUM_MONTHLY",
        "name": "Love Bite Premium (Monthly)"
      },
      "status": "ACTIVE",
      "autoRenew": true,
      "currentPeriodStart": "2026-09-01T00:00:00.000Z",
      "currentPeriodEnd": "2026-10-01T00:00:00.000Z",
      "gracePeriodEnd": null
    }
  }
  ```

---

### 28.3 Cancel Subscription Auto-Renewal
* **Method & Path:** `POST /api/v1/subscriptions/cancel`
* **Auth:** Authenticated
* **Business Rules:**
  * Disables auto-renew (`auto_renew = FALSE`, `status = 'CANCELED'`).
  * Premium benefits remain active until `currentPeriodEnd`.
* **Success Response (`200 OK`):**
  ```json
  {
    "success": true,
    "data": { "autoRenew": false, "activeUntil": "2026-10-01T00:00:00.000Z" },
    "message": "Subscription cancelled. Premium access remains active until period end."
  }
  ```

---

## 29. Payment APIs (Razorpay Integration)

### 29.1 Create Checkout Session
* **Method & Path:** `POST /api/v1/payments/checkout`
* **Auth:** Authenticated
* **Request Body:**
  ```json
  {
    "planId": "plan-premium-monthly",
    "paymentType": "SUBSCRIPTION_INITIAL"
  }
  ```
* **Success Response (`200 OK`):**
  ```json
  {
    "success": true,
    "data": {
      "orderId": "order_Hk9281jsa82",
      "subscriptionId": "sub_Nx82910sa8",
      "keyId": "rzp_test_xxxxxx",
      "amount": 49900,
      "currency": "INR",
      "customer": {
        "name": "Alex Morgan",
        "email": "alex.morgan@example.com"
      }
    }
  }
  ```

---

### 29.2 Verify Client Payment Handshake
* **Method & Path:** `POST /api/v1/payments/verify`
* **Auth:** Authenticated
* **Purpose:** Validates cryptographic HMAC signature returned by client Razorpay SDK.
* **Request Body:**
  ```json
  {
    "razorpayPaymentId": "pay_Hk9281a9",
    "razorpayOrderId": "order_Hk9281jsa82",
    "razorpaySignature": "9a8b7c6d5e4f3a2b1c..."
  }
  ```
* **Success Response (`200 OK`):** Returns verification confirmation. *(Note: Authoritative subscription activation occurs via webhook).*

---

## 30. Entitlement & Usage APIs

### 30.1 Get Current User Entitlements
* **Method & Path:** `GET /api/v1/me/entitlements`
* **Auth:** Authenticated
* **Success Response (`200 OK`):**
  ```json
  {
    "success": true,
    "data": {
      "tier": "PREMIUM",
      "features": {
        "unlimitedSwipes": true,
        "seeWhoLikedYou": true,
        "advancedFilters": true,
        "undoAction": true,
        "chatMedia": true,
        "adFree": true,
        "priorityVisibility": true
      },
      "credits": {
        "boostBalance": 2,
        "superLikeBalance": 5
      }
    }
  }
  ```

---

### 30.2 Get Daily Usage Quotas
* **Method & Path:** `GET /api/v1/me/usage`
* **Auth:** Authenticated
* **Success Response (`200 OK`):**
  ```json
  {
    "success": true,
    "data": {
      "dailyLikePass": {
        "used": 4,
        "limit": 10,
        "remaining": 6,
        "isUnlimited": false
      },
      "dailyTextMessages": {
        "used": 8,
        "limit": 20,
        "remaining": 12,
        "isUnlimited": false
      },
      "quotaResetsAt": "2026-09-16T00:00:00.000Z"
    }
  }
  ```

---

## 31. Admin APIs (`role: ADMIN` Required)

### 31.1 User Management
* **List Users:** `GET /api/v1/admin/users?page=1&limit=20&status=ACTIVE&search=alex`
* **Inspect User Details:** `GET /api/v1/admin/users/:userId`
* **Update User Status:** `PATCH /api/v1/admin/users/:userId/status`
  * Body: `{ "status": "SUSPENDED", "reason": "Terms violation" }`

### 31.2 Moderation & Reports
* **List Reports Queue:** `GET /api/v1/admin/reports?status=PENDING&page=1&limit=20`
* **Get Report Details:** `GET /api/v1/admin/reports/:reportId`
* **Resolve Report:** `PATCH /api/v1/admin/reports/:reportId`
  * Body: `{ "status": "RESOLVED", "adminNotes": "User banned for harassment", "actionTaken": "BAN_USER" }`

### 31.3 Dynamic Configuration Management
* **Manage Genders:** `GET`, `POST`, `PATCH /api/v1/admin/config/genders`
* **Manage Interests:** `GET`, `POST`, `PATCH /api/v1/admin/config/interests`
* **Manage Relationship Intentions:** `GET`, `POST`, `PATCH /api/v1/admin/config/relationship-intentions`
* **Manage Plans & Limits:** `GET`, `PATCH /api/v1/admin/config/plans/:planId`

### 31.4 System KPI Dashboard
* **Get System Statistics:** `GET /api/v1/admin/dashboard/stats`
  * Returns total active users, active matches, daily swipe volume, MRR, and open moderation queue counts.

---

## 32. Realtime / Socket.IO Events Specification

* **Handshake Authentication:** Client passes `auth: { token: "<access_token>" }`. Handshake rejects unauthenticated or banned sockets.
* **Room Topologies:**
  * User Private Channel: `user:{userId}` (receives system alerts, match alerts).
  * Match Conversation Channel: `conversation:{conversationId}` (receives live messages).

### 32.1 Server $\rightarrow$ Client Events
| Event Name | Room / Target | Payload Structure | Trigger Condition |
| :--- | :--- | :--- | :--- |
| `match:new` | `user:{userId}` | `{"matchId": "...", "matchedUser": { "id": "...", "firstName": "Jordan", "photos": [...] }, "matchedAt": "..."}` | Reciprocal like establishes active match. |
| `match:unmatch` | `user:{userId}` | `{"matchId": "...", "conversationId": "..."}` | Participant unmatches or block is triggered. |
| `chat:message:new` | `conversation:{id}`| `{"id": "msg-1", "conversationId": "...", "senderId": "...", "messageType": "TEXT", "content": "...", "createdAt": "..."}` | Message persisted in PostgreSQL. |
| `chat:message:read`| `conversation:{id}`| `{"conversationId": "...", "readerId": "...", "readAt": "..."}` | Participant opens active conversation. |
| `notification:new` | `user:{userId}` | `{"id": "notif-1", "type": "NEW_LIKE", "title": "New Like!", "message": "Someone liked you!"}` | System notification dispatched. |

### 32.2 Client $\rightarrow$ Server Events
| Event Name | Payload Structure | Description |
| :--- | :--- | :--- |
| `chat:message:send` | `{"conversationId": "...", "messageType": "TEXT", "content": "..."}` | Client transmits chat message. |
| `chat:message:read` | `{"conversationId": "..."}` | Client marks incoming messages as read. |
| `chat:typing:start` | `{"conversationId": "..."}` | Client begins typing in active match. |
| `chat:typing:stop` | `{"conversationId": "..."}` | Client stops typing. |

---

## 33. Webhooks Contract (Razorpay)

* **Endpoint:** `POST /api/v1/webhooks/razorpay`
* **Auth:** Validates `X-Razorpay-Signature` against `RAZORPAY_WEBHOOK_SECRET`.
* **Idempotency Strategy:** Inserts `event.id` into `processed_webhooks`. Duplicate events terminate immediately with `200 OK`.
* **Handled Event Types:**
  * `subscription.activated` $\rightarrow$ Activates user subscription (`status = 'ACTIVE'`).
  * `subscription.charged` $\rightarrow$ Records payment invoice in `payments`, extends `current_period_end`.
  * `payment.failed` $\rightarrow$ Transitions subscription to `PAST_DUE`, triggers 24-hour grace window.
  * `subscription.cancelled` $\rightarrow$ Sets `auto_renew = FALSE`.
  * `subscription.completed` $\rightarrow$ Transitions to `EXPIRED`, downgrades user entitlements to Free.

---

## 34. Idempotency Specification

1. **Client Mutating APIs:** APIs accepting `Idempotency-Key: <UUIDv4>` header:
   * `POST /api/v1/discovery/:userId/like`
   * `POST /api/v1/discovery/undo`
   * `POST /api/v1/payments/checkout`
2. **Execution Flow:**
   * Server checks Redis for cached response keyed by `idempotency:<userId>:<key>`.
   * If cached response exists, returns previous result without re-executing business mutations.
   * Lock expires after 120 seconds.

---

## 35. Rate Limiting Strategy

Rate limits are enforced using Redis sliding-window algorithms:

| Endpoint Group | Rate Limit Window | Max Requests | Scope |
| :--- | :--- | :--- | :--- |
| **Auth Login / Register** | 1 minute | 5 requests | IP / Identifier |
| **Verification OTP Resend**| 1 minute | 1 request | User / Identifier |
| **Discovery Swipe Actions**| 1 minute | 60 requests | User ID |
| **Chat Message Sending** | 1 minute | 30 requests | User ID |
| **General Public APIs** | 1 minute | 100 requests | IP Address |
| **Admin APIs** | 1 minute | 120 requests | Admin User ID |

---

## 36. Security Requirements

1. **Argon2id Password Hashing:** `timeCost: 3, memoryCost: 65536, parallelism: 4`.
2. **HTTP Security Headers:** Configured via `Helmet` (CSP, HSTS, X-Content-Type-Options).
3. **CORS:** Restricted to verified web/mobile origin domains with credentials enabled.
4. **IDOR & Mass Assignment Protection:** Sequelize explicit attribute whitelisting; ownership checks on all user resources.
5. **Private Media Storage:** Photos uploaded directly to S3 via short-lived presigned URLs; served through signed CloudFront URLs.
6. **Zero Coordinate Exposure:** SQL projections strictly exclude `profiles.location` from public serialization.

---

## 37. API-to-Database Mapping

| API Endpoint Group | Primary PostgreSQL Tables Interacted With |
| :--- | :--- |
| **Auth** (`/auth/*`) | `users`, `auth_refresh_tokens` |
| **Onboarding** (`/onboarding/*`) | `users`, `profiles`, `profile_photos`, `user_interests`, `user_relationship_intentions`, `dating_preferences`, `user_dating_preference_genders`, `user_dating_preference_intentions` |
| **Profiles** (`/profiles/*`) | `profiles`, `users`, `genders`, `profile_photos`, `interests`, `relationship_intentions` |
| **Photos** (`/profile-photos/*`) | `profile_photos` |
| **Interests / Intentions** | `interests`, `user_interests`, `relationship_intentions`, `user_relationship_intentions` |
| **Dating Preferences** | `dating_preferences`, `user_dating_preference_genders`, `user_dating_preference_intentions` |
| **Discovery** (`/discovery`) | `profiles` (PostGIS GiST), `dating_preferences`, `user_dating_preference_genders`, `user_dating_preference_intentions`, `likes`, `matches`, `blocks`, `boost_sessions` |
| **Likes & Passes** | `likes`, `matches`, `conversations`, `notifications`, `usage_records` |
| **Undo** (`/discovery/undo`) | `likes`, `matches`, `conversations`, `subscriptions`, `plan_features` |
| **Matches & Conversations** | `matches`, `conversations` |
| **Messages** (`/messages`) | `messages`, `conversations`, `usage_records` |
| **Safety** (`/blocks`, `/reports`) | `blocks`, `reports` |
| **Notifications** | `notifications` |
| **Subscriptions & Plans** | `plans`, `features`, `plan_features`, `subscriptions`, `usage_limits` |
| **Payments & Webhooks** | `payments`, `processed_webhooks`, `subscriptions` |
| **Entitlements & Usage** | `subscriptions`, `plan_features`, `usage_limits`, `usage_records`, `user_credit_balances`, `credit_transactions` |

---

## 38. Developer Implementation Rules

1. **Thin Controllers:** Controllers must contain zero business validation or database queries; they only invoke services and format HTTP responses.
2. **Service-Layer Transactions:** Multi-entity mutations (e.g., Like $\rightarrow$ Match $\rightarrow$ Conversation) must be wrapped in `sequelize.transaction()`.
3. **Zod Validation on Every Route:** Every incoming HTTP body, query param, and path parameter must be validated via Zod middleware before entering controllers.
4. **Never Query Sequelize Models from Controllers:** All database access is strictly isolated inside `*.data-access.ts` files.
5. **Enforce Entitlements Server-Side:** Never rely on client request headers to determine Free vs. Premium capabilities.
6. **Preserve Privacy Invariants:** Never return raw latitude/longitude coordinates or unmasked liker profiles in API responses.

---

## 39. Open Questions / Conflicts

| Item ID | Topic | Current Stance & Resolution | Status |
| :--- | :--- | :--- | :--- |
| **API-OQ-01** | Multi-Device Push Notifications (FCM / APNS) | REST endpoints dispatch in-app notifications and WebSocket events. Mobile push notification token registration (`/api/v1/notifications/push-token`) will be added in Phase 1.5. | Documented & Deferred |
| **API-OQ-02** | Granular Chat "Delete for Me" vs. "Delete for Everyone" | Phase 1 implements standard soft delete (`messages.deleted_at`), removing message for both participants. Granular per-user deletion flags reserved for Phase 1.5. | Resolved for MVP |
| **API-OQ-03** | Standalone Super Like / Boost A La Carte Purchase Flow | Super Likes and Boosts consume balances from `user_credit_balances`. Purchasing additional credits uses `POST /api/v1/payments/checkout` with `paymentType = 'CREDIT_PURCHASE'`. | Fully Specified |
