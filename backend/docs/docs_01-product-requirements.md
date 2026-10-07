# Love Bite - Product Requirements Document (PRD)

> **Document Path:** `docs/01-product-requirements.md`  
> **Primary Source of Truth for Product Scope**

---

## 1. Executive Summary & Product Vision

### 1.1 Product Overview
**Love Bite** is a location-based dating platform designed to facilitate meaningful connections through intuitive visual discovery, interest-based matching, and real-time interaction. It delivers a modern, secure, and engaging dating experience built on transparency, safety, and mutual consent.

### 1.2 Core Philosophy & Product Principles
* **Safety First:** Safety and privacy take precedence over monetization and user engagement. Premium capabilities must never bypass safety controls, blocking, or eligibility criteria.
* **Functional Free Experience:** Free users must have a complete, meaningful, and functional dating experience. Premium tiers enhance convenience, visibility, and control without rendering the free tier non-functional.
* **Privacy by Design:** Precise user location (latitude/longitude) and behind-the-paywall identity data (e.g., "Who Liked You") must never be exposed or leaked to client applications.
* **Centralized Logic & Configurability:** Business thresholds, quotas, and options (e.g., gender lists, pricing, limits) must be administrator-configurable rather than hard-coded into client logic.
* **Strict Scope Boundaries:** MVP features are strictly bounded by this PRD. Unmentioned features are strictly out of scope.

---

## 2. Scope & Feature Taxonomy

### 2.1 MVP Scope (Must Have)
* Dual Authentication (Email & Phone OTP)
* Configurable Profile Creation & Mandatory Onboarding Flow
* Photo Management (1–5 photos with mandatory primary selection)
* Configurable Interests & Multiple Relationship Intentions
* Mutual Dating Preferences (Interested In, Age Range, Maximum Distance, Relationship Intentions)
* City + Radius Location Engine (With strict coordinate privacy)
* Single-Profile Discovery Engine (Swipe/Button Left for Pass, Right for Like)
* Permanent Pass Logic & Mutual Matching Mechanics
* Active Match Lifecycle Management & Unmatching Mechanics
* Real-Time Text Chat (Free) & Rich Media Chat (Premium)
* Safety Framework (Block, Report with categories, Admin Review)
* System Notifications (New Match, New Message, New Like)
* Subscription Management & Entitlements Engine (Free vs. Premium Tiers)
* Payment Gateway Integration (Razorpay with Webhook-driven status engine)
* Subscriptions Lifecycle (Auto-renewal, Cancellation, 24-Hour Grace Period, Downgrade, Plan Switching)
* Premium Entitlements (Undo, Unlimited Swipes, "Who Liked You" Unlocking, Advanced Filters, Boost, Super Like, Ad-free, Higher Visibility)
* Admin Management Dashboard

### 2.2 Phase 1.5 Scope (Explicitly Deferred - Post-MVP)
* Profile Verification Badges
* Advanced Profile Filters beyond the defined Premium set
* Out-of-app Email Notifications
* Automated / Human Photo Moderation pipeline
* "Recently Active" indicator
* Online / Offline presence status
* Chat Read Receipts
* In-app Profile Sharing
* Granular / Tiered Admin Roles (e.g., Moderator vs. Super Admin)

### 2.3 Phase 2 Scope (Future Roadmap - Out of Scope for MVP)
* AI-based Matching Algorithms & Compatibility Scoring
* AI Profile Writing Assistance & Suggestions
* Native Audio / Video Calling functionality
* User Stories / Moments Feed
* Community Events & Date Planning tools
* Incognito Mode / Stealth Browsing
* Advanced Recommendation & Behavioral Ranking Engine
* Advanced Business Analytics & Growth Dashboards
* Referral & Reward Programs

---

## 3. User Roles & Account Lifecycle

### 3.1 MVP User Roles
The system strictly supports two (2) roles in the MVP:

1. **`USER`:** Standard account holder seeking connections on the platform.
2. **`ADMIN`:** Platform administrator with management, configuration, and moderation privileges.

*Note: Premium status is an active entitlement/subscription state tied to a `USER` account, NOT a separate user role.*

### 3.2 Account Status Lifecycle
A user account transitions through defined administrative and operational states:

```
                  ┌──────────────┐
                  │ UNVERIFIED   │
                  └──────┬───────┘
                         │ (Verify Email/OTP)
                         ▼
                  ┌──────────────┐
                  │    ACTIVE    │◄──────────────┐
                  └──────┬───────┘               │
                         │                       │
         ┌───────────────┼───────────────┐       │
         ▼               ▼               ▼       │
  ┌────────────┐  ┌────────────┐  ┌────────────┐ │
  │ SUSPENDED  │  │   BANNED   │  │  DELETED   │ │
  └─────┬──────┘  └────────────┘  └────────────┘ │
        │                                        │
        └────────────────────────────────────────┘
                   (Admin Unban/Unsuspend)
```

#### Status Descriptions:
* **`UNVERIFIED`:** Registration completed; pending email or phone verification. Prohibited from accessing discovery, matching, or chat.
* **`ACTIVE`:** Verification complete and onboarding finished (or in progress). Fully operational unless restricted by free-tier limits.
* **`SUSPENDED`:** Temporarily restricted by an Admin due to policy violations. Cannot access discovery or chat.
* **`BANNED`:** Permanently barred by an Admin due to severe safety/policy violations.
* **`DELETED`:** Account soft-deleted by the user or admin. Excluded from discovery, matching, and active interactions. Data retained per soft-delete retention policies.

---

## 4. Authentication & Onboarding

### 4.1 Registration & Authentication Requirements
* **Identifier Options:** Users register using either a unique Email Address OR a unique Phone Number.
* **Required Registration Inputs:**
  * Identifier (Email or Phone)
  * Password
  * Date of Birth (Must be >= 18 years old at time of registration)
  * Terms of Service Acceptance (Explicit confirmation flag)
  * Privacy Policy Acceptance (Explicit confirmation flag)
* **Verification Enforcements:**
  * Email Registration requires a verified link/code via email.
  * Phone Registration requires OTP verification via SMS/WhatsApp.
  * Unverified users are blocked from proceeding to discovery or receiving matches.
* **Login Protocol:**
  * Credentials: (Email OR Phone) + Password.
  * Passwordless / Magic Link login is **not** supported in MVP.

### 4.2 Linear Onboarding Flow
To ensure high-quality discovery, users must complete a mandatory, sequential onboarding process before entering the discovery queue:

```
[SIGN UP] ──► [VERIFY EMAIL/OTP] ──► [FIRST NAME] ──► [DATE OF BIRTH]
                                                             │
[ABOUT YOU] ◄── [1-5 PHOTOS] ◄── [GENDER] ◄──────────────────┘
     │
     └──► [3-10 INTERESTS] ──► [RELATIONSHIP INTENTIONS]
                                       │
[DISCOVERY] ◄── [PROFILE COMPLETE] ◄── [LOCATION] ◄── [DATING PREFERENCES]
```

#### Step Breakdown:
1. **SIGN UP:** Capture identifier, password, DOB, legal agreements.
2. **VERIFY:** Validate OTP or Email link.
3. **FIRST NAME:** User's display name.
4. **DATE OF BIRTH:** Used to compute age; locks age validation (>= 18).
5. **GENDER:** Selected from administrator-configured gender options.
6. **1–5 PHOTOS:** Upload initial profile photos (at least 1 mandatory; 1 designated as primary).
7. **ABOUT YOU:** Short profile bio (Optional during onboarding, but step must be presented).
8. **3–10 INTERESTS:** Select between 3 and 10 interests from active system list.
9. **MULTIPLE RELATIONSHIP INTENTIONS:** Select one or more intentions from active system list.
10. **DATING PREFERENCES:** Define "Interested In" genders, age range (18-100), maximum radius, and target relationship intentions.
11. **LOCATION:** Capture current city and geographical coordinates.
12. **PROFILE COMPLETE:** Profile state switches to searchable/discoverable.
13. **DISCOVERY:** User lands on the main card stack.

---

## 5. Profile Management

### 5.1 Profile Data Attributes

| Attribute | Type | Requirement | Discoverable / Visible | Editable Post-Onboarding |
| :--- | :--- | :--- | :--- | :--- |
| **First Name** | Text | **Mandatory** | Yes | Yes |
| **Date of Birth** | Date | **Mandatory** | Age derived from DOB | No (Admin approval required) |
| **Gender** | Configurable ID | **Mandatory** | Yes | Yes |
| **Photos** | Media List | **Mandatory** (1 to 5) | Yes | Yes |
| **Location** | City / Radius | **Mandatory** | Approx. Distance + City | Yes |
| **Preferences** | Object | **Mandatory** | Internal Matching Logic | Yes |
| **Interests** | Configurable IDs | **Mandatory** (3 to 10) | Yes | Yes |
| **Intentions** | Configurable IDs | **Mandatory** (>= 1) | Yes | Yes |
| **Bio** | Text | Optional | Yes | Yes |
| **Occupation** | Text | Optional | Yes | Yes |
| **Education** | Text | Optional | Yes | Yes |

*Note: Incomplete profiles must be excluded from the discovery pool of other users.*

### 5.2 Dynamic & Configurable Attributes
To maintain flexibility without code changes, the following entities are administrator-managed:

* **Gender Options:** Dynamic entity. Initial seed defaults include `Man`, `Woman`, `Non-binary`, `Prefer not to say`. Administrators can add, edit, or deactivate options.
* **Interests:** Dynamic entity. Deactivated interests remain attached to existing user profiles for display purposes, but cannot be selected by new or editing users.
* **Relationship Intentions:** Dynamic entity. Initial seed defaults include `Long-term relationship`, `Something casual`, `Friendship`, `Not sure yet`. Users can select multiple options.

### 5.3 Profile Photo Rules
* **Quantity Limits:** Minimum 1 photo, Maximum 5 photos.
* **Primary Photo:** Exactly one photo must be designated as primary. It serves as the primary card picture in Discovery.
* **User Operations:** Users can upload, delete, reorder, and change the primary selection at any time, provided the total count remains between 1 and 5.

---

## 6. Location & Privacy Model

### 6.1 City + Radius Architecture
The platform relies on a local radius discovery model:
* **User Parameters:** User City / Region Name, Center Point Coordinates (Lat/Long), Maximum Radius (km/miles).
* **Location Updates:** Users can update their location manually or allow auto-location via device permissions.

### 6.2 Strict Location Privacy Mandate
* **No Exact Coordinates:** The system **must never** deliver raw latitude and longitude coordinates of any user to any client API payload.
* **Exposed Location Data:** Clients receive only:
  1. The user's registered City/Town name.
  2. On the live Discovery card, numeric `distanceKm`, rounded to one decimal place. Latitude and longitude are not returned.

---

## 7. Discovery Engine & Matching Mechanics

### 7.1 Single-Card Discovery Stack
The live Discovery API returns one candidate card at a time. Pass, like, super like, and undo are implemented.
* Users view candidate profiles **one at a time**.
* **Implemented actions:**
  * **Pass:** `POST /api/v1/discovery/:userId/pass`.
  * **Like:** `POST /api/v1/discovery/:userId/like`.
  * **Super Like:** `POST /api/v1/discovery/:userId/super-like`. Premium only, and it spends a Super Like credit.
  * **Undo:** `POST /api/v1/discovery/undo`. Premium only, latest outgoing Like or Pass, five-minute window.

### 7.2 Candidate Exclusion Criteria
`GET /api/v1/discovery` filters out candidate profile B for viewing user A if any of the following are true:

1. B is user A.
2. B's account status is not `ACTIVE`, or B is soft-deleted.
3. B's profile is incomplete, B has no location, or B has no active primary photo.
4. A and B have a match with status `ACTIVE`. An `UNMATCHED` or `UNDONE` match does not exclude B.
5. A has blocked B, or B has blocked A.
6. A has an active `LIKE`, `PASS`, or `SUPER_LIKE` toward B (`is_undone = false`). An undone action does not exclude B. B's incoming `PASS` toward A does not exclude B.
7. A and B do not both satisfy distance, age, gender preference, and relationship-intention overlap. Distance uses inclusive PostGIS `ST_DWithin`. Age uses completed years and is inclusive. An empty preferred-gender list or an empty preferred-intention list produces no candidate.
8. A is unverified, or A's profile, dating preferences, or location are missing. That caller receives a verification error or `400 PROFILE_INCOMPLETE`, not an empty stack.

Reports are not a Discovery exclusion. Browsing candidate cards does not consume action quotas. Pass and like consume the free daily quota. Super like and undo do not.

### 7.3 Swipe Actions Logic

#### Pass Action
* **Persistence:** Stored as `likes.action = 'PASS'`. Logging out does not clear it.
* **Undo:** A Premium user can undo that pass only while it is the latest active outgoing Like or Pass and it is inside the five-minute window. The row stays, with `is_undone = true`. While the row is active, Discovery excludes the target.

#### Like Action & Matching Mechanics
* **Unilateral Like:** Saved as `likes.action = 'LIKE'`. The target leaves the caller's Discovery stack while the row is active.
* **Mutual Matching:** Triggered when the new action is `LIKE` or `SUPER_LIKE` and the other user already has an active `LIKE` or `SUPER_LIKE`. A reciprocal `PASS` does not match.
  * The system inserts a `matches` row with `status = 'ACTIVE'` and canonical user order.
  * The system inserts one `conversations` row with `status = 'ACTIVE'`.
  * Chat send/list APIs and match notifications are not implemented.
* **Free quota:** A like consumes one of the 10 combined Like and Pass actions for the UTC day, unless the caller has Premium.

#### Super Like
* Premium only. It spends one `SUPER_LIKE` credit and writes a consumption ledger row. It does not use the daily Like/Pass quota. It can create the same kind of match as a like.

#### Unmatching Mechanics
* **Not implemented.** The schema can store `status = 'UNMATCHED'` with `unmatched_at` and `unmatched_by_user_id`. No unmatch route is mounted. Undo of a like is a different state: `UNDONE`, with those two columns left null.

#### Undo Action Rules (Premium Only)
* **Access:** An active Premium subscription. Free users receive `403 PREMIUM_REQUIRED`.
* **Scope:** The latest active outgoing `LIKE` or `PASS` only. `SUPER_LIKE` is never undone. Incoming actions do not count.
* **Window:** `created_at >= CURRENT_TIMESTAMP - INTERVAL '5 minutes'`. Exactly five minutes is valid. If that latest action is older, the result is `400 UNDO_WINDOW_EXPIRED` and an older action is not chosen. No active Like or Pass returns `400 NO_UNDOABLE_ACTION`.
* **Repeated Use:** After one undo, the next latest active Like or Pass can be undone, one at a time, when it is still inside the window.
* **Quota:** Undo does not restore quota, does not consume quota, and does not change `usage_records`.
* **State:** `is_undone` becomes true. The row is not deleted.
* **Match:** If that Like created the current `ACTIVE` match, the match becomes `UNDONE`, the `ACTIVE` conversation becomes `CLOSED`, and `closed_at` is set. The other user's reciprocal Like or Super Like stays active. A Pass does not change matches.

---

## 8. Messaging & Communication (Chat)

### 8.1 Chat Access Rules
* Chat is unlocked **only** after a mutual Match is established.
* Either participant can send the first message (No gender-restricted first-message rules).

### 8.2 Tiered Media Capabilities

| Feature | Free Tier Users | Premium Tier Users |
| :--- | :--- | :--- |
| **Text Messages** | Allowed (Max 20 sent/day) | Allowed (Unlimited) |
| **Images** | Prohibited | Allowed |
| **GIFs** | Prohibited | Allowed |
| **Videos** | Prohibited | Allowed |
| **Voice Messages** | Prohibited | Allowed |

### 8.3 Messaging Quotas & Lifecycle
* **Free Tier Daily Quota:** 20 sent text messages per 24-hour rolling window (or calendar day, defined by business rules).
* **Incoming Messages:** Received messages do **not** consume the receiver's daily sent quota.
* **Unmatch Impact:** When a match is dissolved, the conversation becomes inactive immediately; sending further messages is blocked.

---

## 9. Monetization, Subscriptions & Feature Entitlements

### 9.1 Entitlement Matrix (Free vs. Premium)

| Feature / Limit | Free Tier | Premium Tier (Monthly / Yearly) |
| :--- | :--- | :--- |
| **Daily Swipes (Like + Pass)** | 10 combined actions / day | Unlimited |
| **Profile Card Browsing** | Unlimited | Unlimited |
| **Daily Sent Text Messages** | 20 messages / day | Unlimited |
| **Chat Media (Photo, Video, Voice)**| Disabled | Enabled |
| **Undo Last Action** | Disabled | Enabled |
| **Who Liked You Unlocking** | Blurred Count Only | Full Profile Unlocked |
| **Discovery Filters** | Basic (Age, Distance, Gender, Intentions) | Advanced (Education, Occupation, Interests, Lifestyle) |
| **Boost Credits** | None | Configurable Monthly Allowance + Purchases |
| **Super Like Credits** | None | Configurable Monthly Allowance + Purchases |
| **Discovery Visibility** | Standard Ranking | Enhanced / Prioritized (Configurable) |
| **In-App Advertisements** | Displayed | Hidden (Ad-Free) |

### 9.2 Feature Deep-Dives

#### "Who Liked You" Unlocking
* **Free User Experience:** Displays a notification badge and blurred card count (e.g., *"5 people like you!"*).
* **Security & Privacy Mandate:** Free users **must never** receive the raw profile payload (name, photo URL, user ID) of admirer profiles in the API response. Obfuscation must occur on the backend, not via CSS/frontend blur filters.
* **Premium User Experience:** Receives full profile payloads to directly view, pass, or instantly match with admirers.

#### Advanced Filters (Premium Only)
* Basic filters applied to Free tier: Age, Max Distance, Interested In Gender, Relationship Intention.
* Advanced filters applied to Premium tier: Occupation, Education level, Specific Interest overlap, Lifestyle traits.

#### Boost Feature (Premium Only)
* Temporarily increases the user's card priority in the discovery stack of surrounding users.
* Premium users receive a recurring monthly allowance of Boost credits.
* Additional standalone Boost credits can be purchased à la carte.
* *Exact duration (e.g., 30 mins), credit allocation, and pricing are TBD and managed via configuration.*

#### Super Like Feature (Premium Only)
* Highlights the user's profile card when presented to the recipient, signaling high interest.
* Premium users receive a monthly quota of Super Likes.
* Additional Super Likes can be purchased à la carte.
* *Exact quota and pricing are TBD and managed via configuration.*

---

## 10. Subscriptions & Payment Lifecycle

### 10.1 Billing Plans
* **Plans Supported:**
  * Free
  * Premium Monthly
  * Premium Yearly
* Both Premium Monthly and Premium Yearly grant identical feature entitlements; they differ solely in billing frequency and pricing tier.
* All plan pricing details are administrator-configurable.

### 10.2 Payment Gateway Abstraction & Provider
* **Primary Provider:** Razorpay.
* **Architectural Abstraction:** The billing layer must be decoupled behind a Payment Abstraction Interface to allow secondary gateway integration in the future.
* **Source of Truth Rule:** Subscription state changes must be driven **exclusively by authenticated webhook events** from the payment provider, rather than frontend success callbacks.

### 10.3 Auto-Renewal & Cancellation Flow
* **Auto-Renewal Default:** Enabled upon subscription purchase.
* **Cancellation:** Users can cancel subscription auto-renewal at any time.
* **Effect of Cancellation:** Halts future recurring charges. Premium entitlements **remain active** until the conclusion of the current paid billing period. No mid-term prorated refunds are issued.
* **Reactivation Constraint:** A cancelled subscription cannot be "reactivated" mid-cycle. Upon expiration, the user must initiate a new subscription.

### 10.4 Subscription Renewal Failure & Grace Period Flow

```
[RENEWAL ATTEMPT]
       │
       ├─► (Success) ──► [EXTEND SUBSCRIPTION]
       │
       └─► (Fails) ───► [EXPIRY DATE REACHED]
                               │
                               ▼
                   [24-HOUR GRACE PERIOD]
                   (Premium Access Maintained)
                               │
                ┌──────────────┴──────────────┐
                ▼                             ▼
        (Payment Recovered)         (Payment Unrecovered)
                │                             │
                ▼                             ▼
      [CONTINUE PREMIUM]              [DOWNGRADE TO FREE]
                                      (Free Limits Apply)
```

1. Payment renewal fails prior to expiry.
2. User retains Premium until the original plan expiry date.
3. Upon reaching the expiry date, a **24-Hour Premium Grace Period** begins automatically.
4. During the 24-hour grace period, Premium access remains fully functional while retry webhooks/notifications are dispatched.
5. If payment is recovered within 24 hours, the subscription extends seamlessly.
6. If payment is not recovered after 24 hours, the user account is automatically downgraded to the Free tier, enforcing standard Free quotas.

### 10.5 Plan Switching (Monthly <-> Yearly)
* Users can switch between Monthly and Yearly plans at any time without waiting for plan expiration.
* **Transition Logic:** Switching triggers immediate processing of the new plan via the payment gateway without prorated credits. The new plan billing cycle starts fresh according to payment transition rules, ensuring continuous Premium access without service interruption.
* Historical payment records must be preserved in the subscription history log.

---

## 11. Safety, Moderation & Admin Control

### 11.1 Safety Mechanics

#### Blocking
* Users can block any profile from Discovery, Match lists, or Chat windows.
* **System Effect:**
  * Instantly closes active matches and hides chats.
  * Removes both users permanently from each other's Discovery queues.
  * Prevents all present and future interactions.

#### Reporting
* Users can report profiles for misconduct.
* **Mandatory Report Categories:**
  * Fake Profile / Impersonation
  * Harassment / Abusive Behavior
  * Spam / Commercial Promotion
  * Inappropriate Content / Nudity
  * Scam / Fraud
  * Other (Requires text details)
* Submitted reports enter the Admin Moderation Queue for review.

### 11.2 Admin Management Capabilities
The Admin Dashboard provides full operational management over the platform:

* **User Management:** View all accounts, search by identifier/name, inspect full profile details and media.
* **Account Enforcement:** Apply administrative `SUSPENDED` or `BANNED` statuses; execute `UNBAN` / `UNSUSPEND` actions.
* **Moderation Queue:** Review flagged reports, inspect message context, and execute dismissal or user disciplinary actions.
* **Configurable Data Management:**
  * Add, edit, or deactivate Gender options.
  * Add, edit, or deactivate Interests.
  * Add, edit, or deactivate Relationship Intentions.
* **System & Entitlement Configuration:**
  * Define subscription plans and pricing structures.
  * Configure Premium feature limits (e.g., Free swipe daily quota, Free message daily quota).
  * Configure Premium visibility boost multiplier.
  * View high-level system activity metrics (e.g., total users, active matches, subscription metrics).

*Note: Admin capabilities are strictly bounded by these explicit operational points.*

---

## 12. Notifications System

The system must support an event-driven notification dispatch pipeline for critical user engagement events:

### Supported Notification Triggers:
1. **New Match:** Dispatched to both users when a mutual Like occurs.
2. **New Message:** Dispatched to the recipient when a chat message is delivered.
3. **New Like:** Dispatched to a Free or Premium recipient when another user Likes their profile.

*Note: Specific delivery channels (In-App Push notifications, APNS/FCM specs) will be specified in the technical architecture document.*

---

## 13. Assumed vs. Confirmed Requirements & TBD Summary

### 13.1 Confirmed Requirements
* Platform concept, 2-role restriction (`USER`, `ADMIN`), and linear onboarding sequence.
* Free limit of 10 combined Swipes (Like + Pass) and 20 text messages per day.
* Requirement for Email verification and SMS OTP verification.
* Mandatory obfuscation of exact user coordinates (Lat/Long).
* Server-side redaction of "Who Liked You" profiles for Free users.
* Razorpay as the initial payment provider with webhook-driven state management.
* 24-hour grace period for failed subscription renewals.
* Permanence of Pass action in MVP.

### 13.2 Assumptions (Explicit)
* Soft-deleted accounts retain data internally for regulatory/audit compliance before hard purge.
* A user's age is calculated dynamically from `Date of Birth` relative to the current UTC date.
* Distance calculations utilize standard haversine/spherical geometry based on city center or user-provided coordinates.

### 13.3 To Be Decided (TBD)
The following parameter values are designated as **TBD** and must be populated via system configuration during implementation:

| Parameter Item | Status | Description / Notes |
| :--- | :--- | :--- |
| **Boost Credit Quantity** | **TBD** | Number of free Boost credits allocated to Premium subscribers monthly. |
| **Boost Duration** | **TBD** | Active duration of a Boost session (e.g., 30 minutes, 60 minutes). |
| **Boost Individual Pricing** | **TBD** | Cost per additional Boost credit purchased à la carte. |
| **Super Like Monthly Quota** | **TBD** | Number of Super Likes granted to Premium users each month. |
| **Super Like Pricing** | **TBD** | Cost per additional Super Like credit purchased à la carte. |
| **Subscription Plan Prices** | **TBD** | Exact price points for Monthly and Yearly subscriptions. |
| **Visibility Boost Strength**| **TBD** | Algorithmic weight/multiplier for Premium profile discovery priority. |
| **Supported Cities List** | **TBD** | List of specific cities or regions enabled during initial launch. |

---

## Document Status
* **Status:** DRAFT
* **Version:** 1.0
* **Last Updated:** 7 October 2026. Discovery, pass, like, super like, and undo descriptions match the implemented API. Chat, unmatch, who-liked-you, and payments remain product scope that is not yet implemented.
