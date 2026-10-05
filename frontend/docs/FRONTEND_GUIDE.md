# Love Bite — Frontend Integration Guide

This is the frontend integration guide for Love Bite. It tells a frontend developer or coding agent how to call the backend that exists today.

`backend/docs/03-api-specification.md` remains the detailed API contract, including planned routes that are not mounted yet. This guide only describes how to consume the **currently implemented** backend. Where this guide and an older planning note disagree, follow the running backend and report the mismatch.

---

## 1. Purpose

Use this document to wire registration, verification, login, refresh, logout, password reset, and the Phase 3 onboarding contract: public catalogs, the basic profile, photos, interests, relationship intentions, dating preferences, location, onboarding status, and onboarding completion. Do not treat later product areas (discovery, chat, payments) as available APIs.

---

## 2. Current backend status

### Implemented now

Phase 2 authentication:

- Registration
- Email verification
- Phone verification
- Resend verification
- Login
- Refresh
- Logout
- Forgot password
- Reset password

`GET /health` and `GET /api/v1/health` also exist. They are not auth endpoints.

Phase 3 onboarding is implemented. Section 26 is the flow. Section 23 lists the paths.

### Not implemented yet

Do not call these. Tables may exist in PostgreSQL, but there are no mounted routes or frontend APIs for them:

- `PATCH /api/v1/onboarding/profile` (use `GET`, `POST`, and `PATCH /api/v1/profile`)
- `PUT /api/v1/location` (use `PUT /api/v1/onboarding/location`)
- `PUT /api/v1/me/interests` and `PUT /api/v1/me/relationship-intentions`
- `GET /api/v1/dating-preferences` and `PUT /api/v1/dating-preferences`
- `GET /api/v1/profiles/me` and `GET /api/v1/profiles/:userId`
- Discovery
- Likes
- Matches
- Conversations
- Chat
- Blocks
- Reports
- Notification APIs
- Subscriptions
- Payments
- Usage limits
- Credits
- Boosts

Planning documents describe those as future work. They are not live.

---

## 3. Backend base URL

There is no production URL in this repository. Do not invent one.

Local development, from `backend/.env.example`:

| Setting | Example value |
| :--- | :--- |
| Host port | `5000` (`PORT`) |
| API prefix | `/api/v1` (`API_PREFIX`) |
| Allowed browser origin | `http://localhost:3000` (`CORS_ORIGIN`) |

Configure the frontend with an environment value, for example `http://localhost:5000` in development. Auth paths below are relative to that origin plus `/api/v1`. The real deployment URL must come from the environment, not from this guide.

Send JSON as `Content-Type: application/json`.

CORS allows credentialed requests from `CORS_ORIGIN` (`credentials: true`). The web app origin must be same-site with the API because the refresh cookie is `SameSite=Strict`.

---

## 4. Authentication overview

```text
Frontend
   |
   | Login / Register
   v
Backend Auth API
   |
   +--> Access token (JWT in the JSON body)
   |       |
   |       +--> Authorization: Bearer <accessToken>
   |
   +--> Refresh token (opaque value)
           |
           +--> HttpOnly cookie named refreshToken
```

The access token is what the frontend keeps and sends. The refresh token is what the browser stores and sends by itself. JavaScript must not read the refresh token.

### Access token

- JWT signed with **HS256**
- Default lifetime **15 minutes** (`expiresIn` is `900` seconds unless `JWT_ACCESS_EXPIRATION` is changed)
- Header: `Authorization: Bearer <accessToken>`

Claims:

| Claim | Meaning |
| :--- | :--- |
| `sub` | User id |
| `role` | `USER` or `ADMIN` |
| `isVerified` | Whether a stored email or phone is verified |
| `isProfileComplete` | Stored `profiles.is_profile_complete`. False until onboarding completion. |
| `iat` | Issued-at (seconds) |
| `exp` | Expiry (seconds) |

These claims are a snapshot. After verification, log in again or refresh to receive updated `isVerified`. `POST /api/v1/onboarding/complete` does not issue a new access token. Refresh or log in again when the client needs the `isProfileComplete` claim to become `true`. `GET /api/v1/onboarding/status` already returns the stored flag.

### Refresh token

- Opaque random token, not a JWT
- The server stores only a SHA-256 hash
- Lifetime 7 days
- Delivered only as a cookie

| Cookie attribute | Value |
| :--- | :--- |
| Name | `refreshToken` |
| `HttpOnly` | `true` |
| `SameSite` | `Strict` |
| `Secure` | `true` only when `NODE_ENV` is `production`. Local HTTP development does not set `Secure`, so the cookie can be stored. |
| `Path` | `/api/v1/auth/refresh` |
| `Max-Age` | 7 days |

The browser attaches this cookie only to `POST /api/v1/auth/refresh`.

> Never store the refresh token in localStorage or sessionStorage.

Do not read `document.cookie` for it. `HttpOnly` hides it from JavaScript.

---

## 5. Browser credential handling

Any call that must send or accept the refresh cookie needs credentials. That is login (to store the cookie), refresh (to send it), and logout (to accept the clear-cookie response).

`fetch`:

```text
credentials: "include"
```

Axios, if the app uses it (this repository does not install Axios for a frontend):

```text
withCredentials: true
```

These are client settings, not new dependencies to add from this guide. Without credentials, the browser drops the `Set-Cookie` and will not send `refreshToken` on refresh.

---

## 6. Registration flow

`POST /api/v1/auth/register`

No auth header. Rate limit: 5 requests / 60 seconds / IP.

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

| Field | Required | Rules |
| :--- | :--- | :--- |
| `email` | One of email or phone | Valid email. Stored lowercased. Empty string is treated as omitted. |
| `phone` | One of email or phone | E.164: `+`, first digit 1–9, then 1–14 more digits. Empty string is omitted. |
| `password` | Yes | 8–128 characters, at least one uppercase letter, one digit, and one special character. |
| `dateOfBirth` | Yes | `YYYY-MM-DD`, a real calendar date, age at least 18 in UTC. |
| `termsAccepted` | Yes | Boolean `true` only. |
| `privacyAccepted` | Yes | Boolean `true` only. |

> Date of birth is accepted and validated during registration for the 18+ requirement, but it is NOT persisted during Phase 2.

Registration creates a `users` row only. It does not create a profile. Do not read date of birth back from the user. Store it with `POST /api/v1/profile`.

`201 Created` does not log the user in. There is no access token and no refresh cookie.

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

`nextStep` is `VERIFY_EMAIL` when an email was provided, otherwise `VERIFY_PHONE`. If both are sent, only the email code is sent.

A verification code is 6 digits, expires in 5 minutes, and allows 3 attempts. Registration also starts the 60-second resend window, so an immediate resend returns `429`.

Show the screen for `nextStep`. Do not mark the user as logged in.

| Status | Code | When |
| :--- | :--- | :--- |
| 400 | `VALIDATION_ERROR` | Shape, password, missing identifier, or legal flags. `error.details[]` has `field`, `message`, and `code`. |
| 422 | `UNDERAGE_NOT_PERMITTED` | Age is the only problem. Message: `You must be at least 18 years old.` If other fields are also invalid, the response is `400`, not `422`. |
| 409 | `DUPLICATE_IDENTIFIER` | An active account already uses that email or phone. Message: `An account with this email or phone already exists.` |
| 429 | `RATE_LIMITED` | IP limit. Message: `Too many requests. Please try again later.` |

A soft-deleted account does not block reuse of its email or phone.

---

## 7. Email verification

`POST /api/v1/auth/verify-email`

No auth header.

```json
{
  "email": "alex.morgan@example.com",
  "token": "481920"
}
```

`token` is the 6-digit code, not a JWT.

`200 OK`:

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

The account becomes `ACTIVE` when `isVerified` becomes true, unless it is already `SUSPENDED`, `BANNED`, or `DELETED`. `isVerified` is true when the account's email is verified **or** its phone is verified. Verifying email on an account that also has a phone still sets `status` to `ACTIVE` even if the phone is not verified yet.

Wrong, expired, used-up, or unknown-email codes all return:

- `401 INVALID_TOKEN`
- Message: `Invalid or expired verification code.`

The third wrong attempt deletes the code. Do not tell the user which case it was. This call does not create a session. After success, go to login.

---

## 8. Phone verification

`POST /api/v1/auth/verify-phone`

No auth header.

```json
{
  "phone": "+919876543210",
  "otp": "839201"
}
```

The field name is `otp`, not `token`. It is the same 6-digit code: 5-minute lifetime, 3 attempts, then the code is deleted.

`200 OK`:

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

A phone-only registration uses this step (`nextStep: VERIFY_PHONE`). Failure matches email verification: `401 INVALID_TOKEN` and `Invalid or expired verification code.`, including an unknown phone. No session is issued. Then go to login.

---

## 9. Resend verification

`POST /api/v1/auth/resend-verification`

No auth header. Limit: **1 request / 60 seconds / identifier**. Registration already consumed that window for the identifier it emailed or texted.

```json
{
  "identifier": "alex.morgan@example.com",
  "type": "EMAIL"
}
```

`type` is `EMAIL` or `PHONE`. `EMAIL` requires a valid email. `PHONE` requires E.164. The identifier is lowercased for email.

This endpoint does **not** hide whether an account exists.

`200 OK`:

```json
{
  "success": true,
  "data": { "sent": true },
  "message": "Verification code resent."
}
```

| Status | Code | Message |
| :--- | :--- | :--- |
| 429 | `RATE_LIMITED` | `Please wait before requesting another verification code.` |
| 404 | `USER_NOT_FOUND` | `User not found.` No account, or the account is deleted. |
| 400 | `VALIDATION_ERROR` | Bad identifier, or that channel is already verified (`Email is already verified.` / `Phone number is already verified.`). |

Disable resend for 60 seconds after register or a successful resend. Do not describe this route as always returning success.

---

## 10. Login flow

`POST /api/v1/auth/login`

No auth header. Rate limit: 5 requests / 60 seconds / IP. Send credentials so the browser stores the cookie.

```json
{
  "identifier": "alex.morgan@example.com",
  "password": "SecurePassword123!"
}
```

`identifier` is an email or an E.164 phone. Unverified accounts may log in.

`200 OK` sets the `refreshToken` cookie. The JSON body does not include the refresh token.

```json
{
  "success": true,
  "data": {
    "accessToken": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
    "expiresIn": 900,
    "user": {
      "id": "b2f6c91a-8821-4122-901b-5e4d29381029",
      "email": "alex.morgan@example.com",
      "phone": null,
      "role": "USER",
      "status": "ACTIVE",
      "isVerified": true,
      "isProfileComplete": false
    }
  },
  "message": "Login successful."
}
```

Keep `accessToken` and `user` in application memory for the session. There is no existing frontend storage module to follow. Do not persist the refresh token. `expiresIn` is seconds. `isProfileComplete` is `false` after Phase 2 registration because no profile row is created. `user` has no date of birth.

| Status | Code | When |
| :--- | :--- | :--- |
| 401 | `INVALID_CREDENTIALS` | Unknown, deleted, or wrong password. Message: `Invalid credentials provided.` |
| 403 | `ACCOUNT_SUSPENDED` | `Account is suspended.` |
| 403 | `ACCOUNT_BANNED` | `Account is banned.` |
| 429 | `RATE_LIMITED` | IP limit. |
| 400 | `VALIDATION_ERROR` | Identifier or password shape. |

---

## 11. Authenticated requests

Protected calls send:

```text
Authorization: Bearer <accessToken>
```

The only protected auth route today is logout. Do not invent other authenticated product endpoints. The access token expires in about 15 minutes. When it expires, use the refresh flow once, then retry.

---

## 12. Refresh flow

`POST /api/v1/auth/refresh`

No bearer token. No JSON body. Credentials must be included so the browser sends the cookie.

```text
Access token expires, or a protected call returns 401 INVALID_TOKEN
        ↓
POST /api/v1/auth/refresh with credentials
        ↓
Browser sends the HttpOnly refreshToken cookie
        ↓
Backend validates the opaque token
        ↓
Backend revokes that row and sets a new refresh cookie (rotation)
        ↓
JSON contains a new access token
        ↓
Replace the in-memory access token and retry the original request once
```

The frontend does not read the refresh token. The new cookie is applied by the browser.

`200 OK`:

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

The new JWT uses the current `isVerified` and `isProfileComplete`. The `user` object is not returned. Keep the user object from login unless you log in again.

Failure:

| Status | Code | Frontend |
| :--- | :--- | :--- |
| 401 | `INVALID_TOKEN` | Message `Invalid token.` Clear auth state and show login. Covers a missing cookie, an expired refresh token, a deleted user, and reuse of an already rotated token. Reuse also revokes that user's other active refresh rows. |
| 403 | `ACCOUNT_SUSPENDED` or `ACCOUNT_BANNED` | Clear auth state and show the message. Do not refresh again. |

Do not loop refresh.

---

## 13. Logout

`POST /api/v1/auth/logout`

Requires `Authorization: Bearer <accessToken>`. No body. Send credentials so the browser accepts the cookie-clearing response.

`200 OK`:

```json
{
  "success": true,
  "data": null,
  "message": "Logged out successfully."
}
```

The response clears the `refreshToken` cookie using the same name, path, `SameSite`, and `Secure` flag. Clear the in-memory access token and user.

The cookie path is only `/api/v1/auth/refresh`, so the browser does not attach the refresh cookie to `/logout`. Logout still clears the cookie. It revokes the stored refresh row only when that cookie is actually present and belongs to the authenticated user. An unverified user may log out.

Missing credentials return `401 AUTH_REQUIRED` (`Authentication required.`). A bad or expired access token returns `401 INVALID_TOKEN`.

---

## 14. Forgot password

`POST /api/v1/auth/forgot-password`

No auth header. Rate limit: 5 requests / 60 seconds / IP.

```json
{
  "identifier": "alex.morgan@example.com"
}
```

`identifier` is an email or E.164 phone.

`200 OK` with `data: null` and this message whether or not an account exists:

```text
If an account exists for this identifier, password reset instructions have been sent.
```

Show that same confirmation every time. Do not use the response to decide whether the account exists. A deleted account also gets `200` and no message is sent.

When an account exists, the reset token is a 64-character hex string, valid for 15 minutes. It is not a 6-digit code. Delivery is the current mock email or SMS provider.

`429 RATE_LIMITED` uses the IP-limit message. `400 VALIDATION_ERROR` means the identifier is not a valid email or phone.

---

## 15. Reset password

`POST /api/v1/auth/reset-password`

No auth header.

```json
{
  "identifier": "alex.morgan@example.com",
  "token": "64-character-hex-reset-token",
  "newPassword": "NewSecurePassword123!"
}
```

`identifier` must be the same email or phone used for forgot-password. `token` is the 64-character hex value and expires in 15 minutes. `newPassword` uses the same rules as registration. A used token cannot be reused.

`200 OK`:

```json
{
  "success": true,
  "data": null,
  "message": "Password reset successfully. Please log in."
}
```

The server revokes that user's active refresh rows. This call does not log the user in and does not set a cookie. Navigate to login.

Invalid, expired, mismatched, or already-used tokens return `401 INVALID_TOKEN` with message `Invalid or expired reset token.` Ask for a new reset. A weak password or bad identifier is `400 VALIDATION_ERROR`.

---

## 16. Authentication state

Registration returns channel flags. Login returns the account summary. The access token repeats `role`, `isVerified`, and `isProfileComplete`.

| Field | Where | Meaning |
| :--- | :--- | :--- |
| `status` | Register `data`, login `user` | `UNVERIFIED` until a required identifier is verified, then `ACTIVE`. `SUSPENDED` and `BANNED` are rejected at login and refresh. `DELETED` accounts are not returned as a successful session. |
| `emailVerified` / `phoneVerified` | Register `data` only | That channel. Not on the login `user` object. |
| `isVerified` | Login `user` and JWT | True when a stored email is verified, or a stored phone is verified. |
| `isProfileComplete` | Login `user`, JWT, and `GET /api/v1/onboarding/status` | The stored `profiles.is_profile_complete` flag. It is not calculated from the onboarding steps. Registration, a basic profile, and the other onboarding saves leave it `false` until `POST /api/v1/onboarding/complete`. |
| `status` on completion | `POST /api/v1/onboarding/complete` `data.status` | The current `users.status`. Verification sets this. Completion does not change it. |
| `role` | Login `user` and JWT | `USER` for accounts created by register. |
| `nextStep` | Register `data` only | `VERIFY_EMAIL` or `VERIFY_PHONE`. |

Do not add other account states.

---

## 17. Roles

The user model allows `USER` and `ADMIN` only. There is no `PHYSICIAN` role.

Register always creates `USER`. No admin UI or role-based screens are implemented. Do not build role-gated product UI from this guide. A later `requireRole('ADMIN')` helper exists on the server and is not mounted on a public admin API.

---

## 18. Error handling

Failed responses:

```json
{
  "success": false,
  "error": {
    "code": "INVALID_CREDENTIALS",
    "message": "Invalid credentials provided.",
    "details": [],
    "timestamp": "2026-09-25T10:30:00.000Z",
    "requestId": "c1a9f4e2-8821-4122-901b"
  }
}
```

Branch on HTTP status and `error.code`. Use `error.message` for display. Use `error.details` for field errors. Do not switch logic on message text alone.

Auth codes that the server actually returns:

| Status | Code | Typical use |
| :--- | :--- | :--- |
| 400 | `VALIDATION_ERROR` | Schema failure, or "already verified" on resend. |
| 401 | `AUTH_REQUIRED` | Logout without a bearer token. |
| 401 | `INVALID_TOKEN` | Bad access token, refresh failure, bad verification code, bad reset token. |
| 401 | `INVALID_CREDENTIALS` | Login failure. |
| 403 | `ACCOUNT_SUSPENDED` | Login, refresh, or a later authenticated call. |
| 403 | `ACCOUNT_BANNED` | Login, refresh, or a later authenticated call. |
| 403 | `EMAIL_NOT_VERIFIED` | Not returned by the Phase 2 auth routes. Reserved for a later verified-only route. |
| 403 | `PHONE_NOT_VERIFIED` | Same. Phone-only account that is still unverified. |
| 403 | `FORBIDDEN` | Role helper only. No live admin route uses it yet. |
| 404 | `USER_NOT_FOUND` | Resend when the account does not exist. |
| 409 | `DUPLICATE_IDENTIFIER` | Register. There is no separate email-exists or phone-exists code. |
| 422 | `UNDERAGE_NOT_PERMITTED` | Register, and only when age is the sole validation failure. |
| 429 | `RATE_LIMITED` | Register, login, forgot-password, resend. |
| 500 | `INTERNAL_SERVER_ERROR` | Unexpected failure. Message: `An unexpected error occurred. Please try again later.` |

There is no `EMAIL_ALREADY_EXISTS`, `PHONE_ALREADY_EXISTS`, or `INVALID_VERIFICATION_CODE` code.

---

## 19. Rate limits

| Endpoint | Limit |
| :--- | :--- |
| Register | 5 requests / 60 seconds / IP |
| Login | 5 requests / 60 seconds / IP |
| Forgot password | 5 requests / 60 seconds / IP |
| Resend verification | 1 request / 60 seconds / identifier |

There is no `Retry-After` header. On `429`, show `error.message` and wait. Do not add a frontend rate limiter as part of reading this guide.

Register, login, and forgot-password share the message `Too many requests. Please try again later.` Resend uses `Please wait before requesting another verification code.`

---

## 20. Frontend authentication flow

```text
Register
   ↓
Verification required (nextStep)
   ↓
Verify email or phone
   ↓
Login
   ↓
Access token in memory + refresh cookie in the browser
   ↓
Authenticated requests (Authorization: Bearer)
   ↓
Access token expires
   ↓
POST /api/v1/auth/refresh once
   ↓
New access token
   ↓
Continue the session
```

```text
Logout
   ↓
Clear in-memory access token and user
   ↓
Login required
```

---

## 21. 401 / refresh retry guidance

```text
API request with Bearer access token
   ↓
401 INVALID_TOKEN
   ↓
Attempt POST /api/v1/auth/refresh once
   ↓
Refresh succeeds?
   ├── Yes → save the new access token → retry the original request once
   └── No  → clear auth state → show login
```

If the retried request fails again, stop. Do not refresh a second time for that call. `401 AUTH_REQUIRED` means the client never sent a bearer token; send the user to login. `401 INVALID_CREDENTIALS` is a login form error, not a refresh trigger. `403` suspended or banned accounts should not be refreshed.

---

## 22. Security rules for frontend developers

- Never expose the refresh token to JavaScript.
- Never put the refresh token in localStorage.
- Never put the refresh token in sessionStorage.
- Use HTTPS in production. The cookie is `Secure` only in production.
- Do not log access tokens.
- Do not log passwords.
- Do not log verification codes.
- Do not log or display password-reset tokens beyond the reset form that receives them.
- Do not trust frontend validation as a security boundary. The backend is authoritative.
- `isProfileComplete` is the stored `profiles.is_profile_complete` flag. A basic profile and the other onboarding saves leave it `false`. Only `POST /api/v1/onboarding/complete` sets it. That call does not change `users.status`.
- Do not invent API endpoints that are not implemented.

---

## 23. Current API availability

| Method | Endpoint | Status |
| :--- | :--- | :--- |
| POST | `/api/v1/auth/register` | Implemented |
| POST | `/api/v1/auth/verify-email` | Implemented |
| POST | `/api/v1/auth/verify-phone` | Implemented |
| POST | `/api/v1/auth/resend-verification` | Implemented |
| POST | `/api/v1/auth/login` | Implemented |
| POST | `/api/v1/auth/refresh` | Implemented |
| POST | `/api/v1/auth/logout` | Implemented |
| POST | `/api/v1/auth/forgot-password` | Implemented |
| POST | `/api/v1/auth/reset-password` | Implemented |
| GET | `/api/v1/genders` | Implemented. Public. No bearer token. |
| GET | `/api/v1/interests` | Implemented. Public. May return an empty array. |
| GET | `/api/v1/relationship-intentions` | Implemented. Public. No bearer token. |
| GET | `/api/v1/profile` | Implemented. Bearer token. Role `USER`. |
| POST | `/api/v1/profile` | Implemented. Bearer token. Role `USER`. Creates the caller's basic profile. |
| PATCH | `/api/v1/profile` | Implemented. Bearer token. Role `USER`. Updates the caller's basic profile. |
| PUT | `/api/v1/onboarding/interests` | Implemented. Bearer token. Role `USER`. Replaces 3 to 10 interests. |
| PUT | `/api/v1/onboarding/relationship-intentions` | Implemented. Bearer token. Role `USER`. Replaces one or more intentions. |
| PUT | `/api/v1/onboarding/dating-preferences` | Implemented. Bearer token. Role `USER`. Replaces age range, distance, and target genders and intentions. |
| PUT | `/api/v1/onboarding/location` | Implemented. Bearer token. Role `USER`. Stores city and a private point. Response has no coordinates. |
| GET | `/api/v1/onboarding/status` | Implemented. Bearer token. Role `USER`. Read-only step status. |
| POST | `/api/v1/onboarding/complete` | Implemented. Bearer token. Role `USER`. Sets the stored completion flag when all seven prerequisites are met. |
| POST | `/api/v1/profile-photos/upload-url` | Implemented. Bearer token. Role `USER`. Returns a private presigned PUT URL. Does not store a photo row. |
| POST | `/api/v1/profile-photos/confirm` | Implemented. Bearer token. Role `USER`. Stores the reserved photo. |
| GET | `/api/v1/profile-photos` | Implemented. Bearer token. Role `USER`. Active photos only. |
| PATCH | `/api/v1/profile-photos/:photoId` | Implemented. Bearer token. Role `USER`. Changes order and/or primary. |
| DELETE | `/api/v1/profile-photos/:photoId` | Implemented. Bearer token. Role `USER`. Soft-deletes the caller's photo. |

Paths are prefixed by `API_PREFIX`, which defaults to `/api/v1`.

The three catalog reads share one limit of 100 requests per 60 seconds per IP. A catalog response is `{ "success": true, "data": [], "message": "..." }`. Gender and intention items are `{ "id", "code", "name" }`. Interest items also include `category`, which may be `null`. Only active rows are returned, ordered by `display_order`. Do not expect a production interest list. Gender and relationship-intention seed values are the approved codes in `backend/docs/03-api-specification.md` section 11.13.

The basic profile routes are not part of that public limit. Send `Authorization: Bearer <accessToken>`. The signed-in user must have role `USER`. There is no `/api/v1/profile/:userId` route.

`POST /api/v1/profile` body fields are `firstName` (required, 1–100), `dateOfBirth` (required, `YYYY-MM-DD`, age 18+), `genderId` (required UUID of an active gender), and optional `bio` (max 500), `occupation` (max 100), and `education` (max 100). Do not send `userId`, `isProfileComplete`, `city`, `location`, interests, intentions, preferences, or photos. Success is `201` with `data` containing `id`, `userId`, `firstName`, `dateOfBirth`, `gender` (`id`, `code`, `name`), `bio`, `occupation`, `education`, `city` (`null` at this step), and `isProfileComplete` (`false`). `location` is not returned.

`GET /api/v1/profile` returns that same object. No profile is `404` with code `PROFILE_NOT_FOUND`. A second create is `409` with code `PROFILE_ALREADY_EXISTS`. `PATCH /api/v1/profile` sends any subset of the writable fields and returns the same object. An empty patch is `400 VALIDATION_ERROR`. No profile on patch is `404 PROFILE_NOT_FOUND`. An unknown or inactive gender is `400 INVALID_GENDER`. An underage date of birth is `422 UNDERAGE_NOT_PERMITTED`. The full request and error contract is `backend/docs/03-api-specification.md` section 11.14.

`PUT /api/v1/onboarding/interests` and `PUT /api/v1/onboarding/relationship-intentions` use the same bearer token and `USER` role. They are not public, and they do not use the catalog rate limit. Verification is not required. Do not send `userId`. `POST` and `PATCH /api/v1/profile` still reject `interests` and `relationshipIntentions`.

Interest body: `{ "interestIds": ["uuid", "uuid", "uuid"] }`. Minimum 3, maximum 10, unique UUIDs, and every id must be an active interest. Success is `200` with message `Interests updated successfully`. `data` is `{ "id", "code", "name", "category" }` ordered by catalog display order. `category` may be `null`.

Intention body: `{ "relationshipIntentionIds": ["uuid"] }`. Minimum 1, no maximum, unique UUIDs, and every id must be an active intention. Success is `200` with message `Relationship intentions updated successfully`. `data` is `{ "id", "code", "name" }` ordered by catalog display order.

Both calls replace the signed-in user's current rows. They do not append, and they do not change `isProfileComplete`. A bad UUID, a duplicate, or the wrong count is `400 VALIDATION_ERROR`. An unknown or inactive interest is `400 INVALID_INTEREST`. An unknown or inactive intention is `400 INVALID_RELATIONSHIP_INTENTION`. `PUT /api/v1/me/interests` and `PUT /api/v1/me/relationship-intentions` are not mounted. The full contract is `backend/docs/03-api-specification.md` section 11.15.

`PUT /api/v1/onboarding/dating-preferences` uses the same bearer token and `USER` role. Verification is not required. Do not send `userId`. This is not `PUT /api/v1/dating-preferences`, which is not mounted.

Body: `minAge` (integer, at least 18), `maxAge` (integer, at most 100, and at least `minAge`), `maxDistanceKm` (integer, 1 to 500), `interestedInGenderIds` (UUID array), and `preferredIntentionIds` (UUID array). Neither array has a minimum or maximum count. An empty array is valid. Every gender id must be an active gender. Every intention id must be an active relationship intention. These are the genders and intentions the user wants to find. They are not the user's own gender, interests, or relationship intentions.

Success is `200` with message `Dating preferences updated successfully`. `data` is `minAge`, `maxAge`, `maxDistanceKm`, `interestedInGenders` (`id`, `code`, `name`), and `preferredIntentions` (`id`, `code`, `name`). Catalog objects are ordered by display order. An empty list comes back as `[]`. A later call replaces the previous values. A bad number, a bad UUID, a duplicate, or an extra field is `400 VALIDATION_ERROR`. An unknown or inactive gender is `400 INVALID_GENDER`. An unknown or inactive intention is `400 INVALID_RELATIONSHIP_INTENTION`. This route does not change `isProfileComplete`. The full contract is `backend/docs/03-api-specification.md` section 12.5.

Profile photos use the same bearer token and `USER` role. The path is `/api/v1/profile-photos`, not `/api/v1/profile/photos`. The client uploads the file to S3 with the returned PUT URL. This API never receives the image bytes.

`POST /api/v1/profile-photos/upload-url` body: `mimeType` (`image/jpeg`, `image/png`, or `image/webp`), `fileSizeBytes` (integer, 1 to 10485760), and optional `originalFilename` (max 255). Success is `200`. `data` is `photoId`, `uploadUrl`, `storageKey`, and `expiresInSeconds` (`300`). The storage key is always `photos/{userId}/{photoId}.webp`. Send the PUT with the same `Content-Type` as `mimeType`. A sixth active photo is `409 PHOTO_LIMIT_REACHED`.

`POST /api/v1/profile-photos/confirm` body: `photoId`, `storageKey` (the value just returned), `displayOrder` (1–5), and `isPrimary`. Success is `201`. `data` is `id`, `url`, `displayOrder`, and `isPrimary`. `url` is a signed GET URL valid for 3600 seconds. Do not send a different storage key. A missing reservation is `404 RESOURCE_NOT_FOUND`. A mismatched key is `400 INVALID_STORAGE_KEY`.

`GET /api/v1/profile-photos` returns that photo shape for the signed-in user's active photos, ordered by `displayOrder`. `PATCH /api/v1/profile-photos/:photoId` accepts `displayOrder` and/or `isPrimary` and returns the full active list. `DELETE /api/v1/profile-photos/:photoId` returns `{ "deleted": true }`. Another user's photo is `404 RESOURCE_NOT_FOUND`. A completed profile cannot delete its only photo (`409 PHOTO_REQUIRED`). The first confirmed photo becomes primary. Deleting the primary promotes another active photo. At most 5 active photos. JPEG, PNG, or WebP, at most 10 MB. Photo routes do not change `isProfileComplete`. The full contract is `backend/docs/03-api-specification.md` section 14.

`PUT /api/v1/onboarding/location` uses the same bearer token and `USER` role. Verification is not required. A profile must already exist. No profile is `404 PROFILE_NOT_FOUND`.

Body: `city` (trimmed, non-empty, at most 100 characters), `latitude` (finite, -90 to 90), and `longitude` (finite, -180 to 180). Success is `200` with message `Location updated successfully`. `data` is only `{ "city": "<trimmed city>", "updated": true }`. Do not expect `latitude`, `longitude`, or `location` in that response, or on `GET /api/v1/profile`. The server stores a PostGIS geography Point, SRID 4326. This route does not change `isProfileComplete`. `PUT /api/v1/location` is not mounted. The full contract is `backend/docs/03-api-specification.md` section 12.6.

`GET /api/v1/onboarding/status` has no body. Success is `200` with message `Onboarding status retrieved successfully`. `data` is only `isVerified`, `isProfileComplete`, `completedSteps`, and `nextStep`. `isProfileComplete` is the stored flag. A missing profile is `200` with `isProfileComplete: false`, not `404`. `completedSteps` uses this order and never includes `COMPLETE`: `VERIFICATION`, `BASIC_PROFILE`, `PHOTOS`, `INTERESTS`, `RELATIONSHIP_INTENTIONS`, `DATING_PREFERENCES`, `LOCATION`. `nextStep` is the first missing step. When all seven are satisfied and the stored flag is still false, `nextStep` is `COMPLETE`. When the stored flag is true, `nextStep` is `null`. The full contract is section 12.1.

`POST /api/v1/onboarding/complete` has no body. It does not require a separate verification middleware. It requires the same seven prerequisites as status. Success is `200`:

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

`data` contains only `isProfileComplete` and `status`. `status` is the current account status (`users.status`). Completion does not change it. The call sets only the stored profile flag. It does not return a profile, coordinates, photos, or steps, and it does not issue a new JWT. Calling it again returns the same `200`. It does not return `409`.

An incomplete account is `400` with code `PROFILE_INCOMPLETE`. `error.details` lists every missing prerequisite. Each item is `{ "field": "<STEP>", "message": "<STEP> is required" }`. Nothing is written. Do not call completion after every edit. None of the onboarding PUT routes complete the profile by themselves.

---

## 24. Phase 3 boundary

Phase 2 authentication is implemented. Phase 3 onboarding is implemented: catalogs, basic profile, photos, own interests, own relationship intentions, dating preferences, location, onboarding status, and onboarding completion. Section 26 is the order to call them.

`GET /api/v1/dating-preferences` and `PUT /api/v1/dating-preferences` are not mounted. `PUT /api/v1/me/interests` and `PUT /api/v1/me/relationship-intentions` are not mounted. `PUT /api/v1/location` and `PATCH /api/v1/onboarding/profile` are not mounted. Registration still does not write `profiles.date_of_birth`. `POST /api/v1/profile` does.

Phase 4 — Discovery is next and is not implemented. The later sections of `backend/docs/03-api-specification.md` describe that planned contract. Do not call discovery, likes, matches, or chat.

---

## 25. Source of truth

When something is unclear, use this order:

1. The actual backend implementation (`backend/src/modules/auth/`, auth middleware, JWT and crypto utilities, rate limits, and environment configuration).
2. `backend/docs/03-api-specification.md` for the wider contract, including routes that are still planned.
3. The other backend documents for product, architecture, database, security, and the development plan.

If documentation conflicts with the running backend, investigate the implementation and report the discrepancy. Do not guess a request field, error code, or endpoint into existence.

---

## 26. Onboarding flow

Call these in this order. Each save stands on its own. Do not call `POST /api/v1/onboarding/complete` after every edit. Use `GET /api/v1/onboarding/status` to see which step is next.

1. Verify the account (`POST /api/v1/auth/verify-email` or `POST /api/v1/auth/verify-phone`). Verification is what can set `users.status` to `ACTIVE`.
2. Create or update the basic profile with `POST` or `PATCH /api/v1/profile`. This does not complete onboarding.
3. Add photos with `POST /api/v1/profile-photos/upload-url`, upload the file to the returned URL, then `POST /api/v1/profile-photos/confirm`. List, reorder, and delete with the other `/api/v1/profile-photos` routes.
4. Replace the user's own interests with `PUT /api/v1/onboarding/interests` (3 to 10 active ids).
5. Replace the user's own relationship intentions with `PUT /api/v1/onboarding/relationship-intentions` (at least one active id). These are `user_relationship_intentions`, not discovery preferences.
6. Replace discovery preferences with `PUT /api/v1/onboarding/dating-preferences`. `interestedInGenderIds` and `preferredIntentionIds` are who the user wants to discover. Empty arrays are allowed. A saved `dating_preferences` row is enough for this step.
7. Set location with `PUT /api/v1/onboarding/location`. Read `city` from the response. Do not expect coordinates.
8. Call `POST /api/v1/onboarding/complete` once the status `nextStep` is `COMPLETE`. Success `data` is only `isProfileComplete` and `status`.
9. Keep using `GET /api/v1/onboarding/status` to decide the current step. `isProfileComplete` there is the stored flag. If every prerequisite is done and that flag is still false, `nextStep` is `COMPLETE`. After completion, `nextStep` is `null`.

`PROFILE_INCOMPLETE` is HTTP 400. `details` can contain more than one missing step. Fix those steps, then call completion again. A second successful completion returns the same `200`.
