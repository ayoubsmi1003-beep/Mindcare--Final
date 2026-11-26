# Social content — lifecycle, approval, publishing, brand

> **Status: DOCUMENTED / CONTRACT READY.** The Zod types ship in
> `src/shared/integrations/contracts.ts`. The schema below is a **proposal**: rule 9 requires
> explicit owner approval before migration `236_social_content.sql` is written. Nothing
> publishes, and no Meta account is connected.

## 1. Isolation from clinical data (non-negotiable)

- **No foreign key to clinical tables.** Social tables never reference `patients`,
  `appointments`, notes, prescriptions or documents.
- **No access to clinical data for the Social agent.** It gets a dedicated DB-less service
  path: its only data is marketing content and the brand library.
- **No reuse of clinical gates.** Social gates never call `get_patient` or any other clinical
  gate. A checkpoint asserts that no social function body names a clinical table.
- **Approved sources only.** Inputs are approved, non-patient marketing material: services,
  hours, doctor-approved educational topics.

## 2. Lifecycle

`DRAFT → GENERATING → AWAITING_APPROVAL → APPROVED → SCHEDULED → PUBLISHING → PUBLISHED`

Failure and exit states:
- `REJECTED`, from `AWAITING_APPROVAL`;
- `FAILED`, from `PUBLISHING`, retryable;
- `CANCELLED`, from any state before `PUBLISHED`;
- `ARCHIVED`, from `PUBLISHED` or `REJECTED`.

Transitions are enforced by a trigger, the same way appointments are (022).

## 3. The binding rule: approval covers one exact version

- **Versions are immutable.** `social_content_versions` rows are never updated. Any change
  (caption, hashtags, slide order, any asset) creates version n+1.
- **The hash is computed by the database.** `content_hash` = `sha256` (built into PG ≥ 11) of
  the canonical `jsonb` of `{platform, format, caption, hashtags, slides:[{position,
  asset_sha256, mime_type, alt_text}]}`. The caller never supplies it.
- **An approval pins a version and its hash.** `social_content_approvals(version_id,
  content_hash, approved_by, approved_at, revoked_at)`.
- **The publish gate checks, under lock:**
  - an approval row exists for **this** version, not revoked (`FOR SHARE`);
  - its `content_hash` equals the hash recomputed **now** from the version and its assets;
  - the assets' stored `sha256` still match.

  Anything else is refused. Revoking takes `FOR UPDATE`, so a revoke cannot slip between
  the check and the publish.
- **Publishing is idempotent.** `social_publish_jobs` is UNIQUE(version_id, platform). A
  retry reuses the job and never creates a second post. The provider post id and URL are
  recorded once, and attempts go to `social_publish_attempts` (code, timestamp, never the
  token).
- **Who may approve.** Approval and scheduling are owner-only (RLS on `app.current_role() =
  'owner'`, decision D7). They are online actions: never queued offline, never performed by
  an agent or an n8n workflow.

### Proposed tables (for approval)

| Table | Key columns |
|---|---|
| `app.social_contents` | id, cabinet_id, title, status, created_by, created_at, archived_at |
| `app.social_content_versions` | id, content_id, version (unique per content), platform, format, caption, hashtags text[], slides jsonb, content_hash (computed), created_by, created_at — **no UPDATE grant** |
| `app.social_media_assets` | id, cabinet_id, sha256 (unique), mime_type, bytes, width, height, storage_path (clinic disk), source (`generated` / `uploaded` / `brand`), created_at |
| `app.social_content_approvals` | id, version_id, content_hash, approved_by, approved_at, revoked_at, revoked_by |
| `app.social_publish_jobs` | id, version_id, platform, approval_id, scheduled_at, status, provider_post_id, provider_url, attempts, last_error_code — UNIQUE(version_id, platform) |
| `app.social_publish_attempts` | id, job_id, attempted_at, outcome, error_code |

Every table: RLS + FORCE, `REVOKE ALL FROM authenticated` then the narrowest grant, `trg_audit`.

## 4. Provider interfaces (to build with the schema, mocks first)

```ts
interface SocialPublisher {        // MetaFacebookPublisher, MetaInstagramPublisher, MockPublisher
  publish(job: SocialPublishJobV1, version: SocialContentVersionV1, media: readonly PublicMediaUrl[]):
    Promise<{ ok: true; postId: string; url: string } | { ok: false; code: IntegrationErrorCode; retryable: boolean }>;
}
interface ImageProvider { generate(prompt: MarketingPrompt): Promise<GeneratedImage> }  // replaceable
interface TextProvider  { draft(brief: MarketingBrief): Promise<DraftCaption> }          // via external-call.ts
```

Meta realities to design for (**verify** current values before building):
- **Instagram needs public media.** Instagram publishing creates a media container from a
  **publicly reachable media URL**, then publishes it. So the gateway, not the clinic, must
  host approved media temporarily, signed and short-lived.
- **Per-account limits.** Instagram has a 24-hour publishing limit per account. Carousel item
  limits apply.
- **Facebook Pages publish via the Graph API with a page token.** Tokens live in the gateway
  env only.

## 5. Brand configuration / asset library

**Inventory of what exists (verified).** Nothing new is invented:

| Asset | Path |
|---|---|
| Logo mark (vector) | `docs/Mindcare mark.svg` (used by `src/components/ui/Icones.tsx`) |
| Certificate mark | `public/marque-certificat.svg` |
| Raster logo | `resources/branding/logo.jpg` |
| App icon | `build-ressources/icon.ico`, `docs/electron.icon.svg` |
| Colour tokens | `src/styles/tokens.css` (`--brand-*`, `--primary`, families documented in `docs/design-system/DESIGN_TOKENS.md`) |
| Typography | Montserrat (UI), Merriweather (display), IBM Plex Sans Arabic (Arabic), Source Code Pro (numbers), Inter — `src/app/layout.tsx` |
| Visual rules | `docs/design-system/VISUAL_LANGUAGE.md`, ADR-022/025 palettes |

**Proposed library (with the social schema).** A versioned, committed `brand/brand.v1.json`
generated from `tokens.css` and the files above. It holds:
- the logo variants (path + sha256);
- the colours;
- the font families;
- per-platform presets (1080×1080 post, 1080×1350 portrait, 1080×1920 story/reel, safe margins);
- layout templates.

A new version is a new file, and old versions stay for reproducibility.

**Text is never drawn by the image model.** Exact Arabic and French typography (RTL shaping,
diacritics) is composed **deterministically** over the generated background:
1. the image model produces a text-free visual;
2. a layout step renders the caption text with the brand fonts (an HTML/SVG template rendered
   by the existing headless browser tooling, or a canvas library);
3. the result is hashed and stored as an asset.

This keeps the model replaceable, and keeps the words exactly the ones the doctor approved.
