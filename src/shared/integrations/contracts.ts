/**
 * Integration contracts v1 — the shapes that cross the MindCare boundary.
 * Spec: docs/integrations/CONTRACTS.md. I/O-free so the website, a future gateway
 * and a future mobile app can mirror them byte for byte.
 *
 * Rule: no free text and no clinical field crosses here. Event and notification
 * payloads carry references only (opaque UUIDs, codes, small counters).
 */
import { z } from "zod";

export const INTEGRATION_CONTRACT_VERSION = 1 as const;

/** Same error vocabulary as the website relay (mindcare-website/lib/booking-protocol.ts). */
export const integrationErrorCode = z.enum(["INVALID_INPUT", "CONFLICT", "CAPACITY", "UNAVAILABLE", "NOT_FOUND", "EXPIRED", "REPLAY"]);
export type IntegrationErrorCode = z.infer<typeof integrationErrorCode>;

/** E.164; a 10-digit Algerian national number becomes +213. Mirrors the website's phoneCanonical. */
export function phoneCanonical(value: string): string {
  if (!/^[+0-9 ()-]{9,24}$/.test(value)) throw new Error("INVALID_INPUT");
  let digits = value.replace(/[ ()-]/g, "");
  if (/^0\d{9}$/.test(digits)) digits = "+213" + digits.slice(1);
  if (!/^\+[1-9]\d{8,14}$/.test(digits)) throw new Error("INVALID_INPUT");
  // One Algerian number, one form: +213 and 9 digits, never +2130… (the rate-limit key).
  if (digits.startsWith("+213") && !/^\+213[1-9]\d{8}$/.test(digits)) throw new Error("INVALID_INPUT");
  return digits;
}

export const civilDate = z.string().regex(/^20\d{2}-\d{2}-\d{2}$/).refine(value => {
  const parsed = new Date(value + "T00:00:00Z");
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
});
// No control, invisible or bidi-override character; no spreadsheet-formula prefix (same rule as gate 235).
const personName = z.string().trim().min(1).max(80).refine(value => !/[\u0000-\u001f\u007f​-‏‪-‮⁠-⁤﻿]/.test(value) && !/^[=+@]/.test(value));
const phone = z.string().refine(value => { try { phoneCanonical(value); return true; } catch { return false; } }).transform(phoneCanonical);
const sha256Hex = z.string().regex(/^[a-f0-9]{64}$/);

// ── Appointment request ─────────────────────────────────────────────────────
// Maps to app.appointments(status 'requested', source = channel) + app.pending_patients.
// The day window (today..today+60, Africa/Algiers) is enforced by the database gate.
export const appointmentChannel = z.enum(["web", "whatsapp"]);
export const requestLocale = z.enum(["fr", "ar", "darija"]);
export const preferredPeriod = z.enum(["morning", "afternoon"]);
export const preferredTime = z.string().regex(/^(?:0[89]|1[0-5]):[0-5][0-9]$/).refine(value => value >= "08:30" && value <= "15:30");

export const appointmentRequestV1 = z.object({
  schemaVersion: z.literal(1),
  submissionId: z.uuid(),
  channel: appointmentChannel,
  firstName: personName,
  lastName: personName,
  phone,
  locale: requestLocale,
  preferredDay: civilDate,
  preferredPeriod,
  preferredTime: preferredTime.optional(),
  consent: z.object({ contact: z.literal(true), whatsapp: z.boolean(), policyVersion: z.number().int().positive().max(10_000) }).strict(),
}).strict().refine(input => input.preferredTime === undefined || (input.preferredTime < "12:00" ? "morning" : "afternoon") === input.preferredPeriod, { message: "PERIOD_MISMATCH" });
export type AppointmentRequestV1 = z.infer<typeof appointmentRequestV1>;

/**
 * What an intake caller gets back: the clinic committed the request ("RECEIVED", the
 * website relay's delivery state). The external reference is the caller's own
 * submissionId; no internal row id leaves. Review status is a separate, later query.
 */
export const appointmentRequestReceiptV1 = z.object({
  submissionId: z.uuid(),
  delivery: z.literal("RECEIVED"),
  duplicate: z.boolean(),
}).strict();
export type AppointmentRequestReceiptV1 = z.infer<typeof appointmentRequestReceiptV1>;

// ── Events and notifications (references only) ──────────────────────────────
const refValue = z.union([z.uuid(), z.string().regex(/^[A-Z][A-Z0-9_]{0,39}$/), z.number().int().min(0).max(100_000), z.boolean(), z.null()]);
export const refsPayload = z.record(z.string().regex(/^[a-z][A-Za-z0-9]{0,39}$/), refValue).refine(value => Object.keys(value).length <= 16);

export const integrationEventType = z.enum([
  "AppointmentRequestCreated", "AppointmentRequestReviewed", "AppointmentConfirmed",
  "IntegrationWebhookReceived", "WhatsAppMessageReceived", "WhatsAppMessageDeliveryUpdated",
  "SocialContentDraftCreated", "SocialContentApprovalRequested", "SocialContentApproved",
  "SocialContentApprovalRevoked", "SocialContentScheduled", "SocialContentPublished",
  "SocialContentPublishFailed", "IntegrationHealthChanged",
]);
export const integrationProducer = z.enum(["mindcare-core", "gateway", "website", "aftercare", "n8n"]);
export const integrationEventV1 = z.object({
  eventId: z.uuid(),
  type: integrationEventType,
  schemaVersion: z.literal(1),
  occurredAt: z.iso.datetime({ offset: true }),
  producer: integrationProducer,
  correlationId: z.uuid(),
  cabinetRef: z.uuid(),
  payload: refsPayload,
}).strict();
export type IntegrationEventV1 = z.infer<typeof integrationEventV1>;

/** `kind` values are the free-text app.notifications.kind (011); payload stays refs-only. */
export const notificationKind = z.enum([
  "appointment_request", "crisis_escalation", "social_approval_requested", "social_published",
  "social_publish_failed", "integration_disconnected", "workflow_failed", "sync_event",
]);
export const notificationEventV1 = z.object({
  notificationId: z.uuid(),
  kind: notificationKind,
  recipientRole: z.enum(["owner", "practitioner", "assistant"]),
  createdAt: z.iso.datetime({ offset: true }),
  payload: refsPayload,
}).strict();
export type NotificationEventV1 = z.infer<typeof notificationEventV1>;

export const workflowResultV1 = z.object({
  executionId: z.uuid(),
  workflow: z.string().regex(/^[a-z][a-z0-9-]{1,63}$/),
  correlationId: z.uuid(),
  outcome: z.enum(["succeeded", "failed", "retrying", "dead_lettered"]),
  attempt: z.number().int().min(1).max(20),
  errorCode: integrationErrorCode.optional(),
  finishedAt: z.iso.datetime({ offset: true }),
}).strict().refine(value => value.outcome === "succeeded" ? value.errorCode === undefined : value.errorCode !== undefined);
export type WorkflowResultV1 = z.infer<typeof workflowResultV1>;

// ── Social content (contract only — no schema yet, see SOCIAL-CONTENT.md) ───
export const socialPlatform = z.enum(["facebook", "instagram"]);
export const socialFormat = z.enum(["image", "carousel", "story", "reel"]);
export const socialStatus = z.enum(["DRAFT", "GENERATING", "AWAITING_APPROVAL", "APPROVED", "SCHEDULED", "PUBLISHING", "PUBLISHED", "REJECTED", "FAILED", "CANCELLED", "ARCHIVED"]);
export const socialSlideV1 = z.object({
  position: z.number().int().min(1).max(20),
  assetSha256: sha256Hex,
  mimeType: z.enum(["image/png", "image/jpeg", "video/mp4"]),
  altText: z.string().trim().min(1).max(1000),
}).strict();
export const socialContentVersionV1 = z.object({
  contentId: z.uuid(),
  version: z.number().int().positive(),
  platform: socialPlatform,
  format: socialFormat,
  caption: z.string().max(2200),
  hashtags: z.array(z.string().regex(/^#[\p{L}\p{N}_]{1,100}$/u)).max(30),
  slides: z.array(socialSlideV1).min(1).max(20),
  contentHash: sha256Hex,
}).strict().refine(value => value.slides.every((slide, index) => slide.position === index + 1), { message: "SLIDE_ORDER" })
  .refine(value => value.format === "carousel" ? value.slides.length >= 2 : value.slides.length === 1, { message: "SLIDE_COUNT" });
export type SocialContentVersionV1 = z.infer<typeof socialContentVersionV1>;
export const socialApprovalV1 = z.object({
  approvalId: z.uuid(),
  contentId: z.uuid(),
  version: z.number().int().positive(),
  contentHash: sha256Hex,
  approvedBy: z.uuid(),
  approvedAt: z.iso.datetime({ offset: true }),
  revokedAt: z.iso.datetime({ offset: true }).nullable(),
}).strict();
export const socialPublishJobV1 = z.object({
  jobId: z.uuid(),
  contentId: z.uuid(),
  version: z.number().int().positive(),
  platform: socialPlatform,
  approvalId: z.uuid(),
  scheduledAt: z.iso.datetime({ offset: true }).nullable(),
  status: z.enum(["SCHEDULED", "PUBLISHING", "PUBLISHED", "FAILED", "CANCELLED"]),
  providerPostId: z.string().max(128).nullable(),
  providerUrl: z.url().nullable(),
  attempts: z.number().int().min(0).max(20),
  lastErrorCode: integrationErrorCode.nullable(),
}).strict();
