"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Bouton, ChampSelection, ChampTexte, ChampZoneTexte } from "@/components/ui";
import { aftercare as t } from "@/i18n/aftercare";
import { listAftercareBindings, listAftercareClinicalSources, listAftercareObjects, publishAftercareClinicalSnapshot, publishAftercareObject, readAftercareObject, revokeAftercareBinding, verifyAftercareBinding, type AftercareClinicalSource } from "@/services/aftercare";
import { gererSoutienAftercare, lireMediaAftercare, lireSourceAftercare, synchroniserAftercare, transmettreAftercare, type AftercareSupportRelationship } from "@/services/db/http";
import { AftercareSubmissionSchema, type AftercareBinding, type AftercareObject, type AftercarePublication } from "@/services/aftercare-contracts";
import { editableAftercarePublication, selectedAftercareSources, withdrawAftercarePublication } from "@/services/aftercare-editor";

const kindLabel = (kind: string): string => t.kinds[kind as keyof typeof t.kinds] ?? t.sharedObject;

function AftercareContent({ body }: { body: Record<string, unknown> }): React.JSX.Element {
  return <dl className="flex flex-col gap-3">{Object.entries(t.fields).flatMap(([field, label]) => {
    const value = body[field];
    if (value === undefined || value === null || value === "") return [];
    const display = (item: unknown): React.ReactNode => typeof item === "boolean" ? item ? t.yes : t.no : typeof item === "string" ? t.values[item as keyof typeof t.values] ?? item : typeof item === "number" ? item : typeof item === "object" && item ? <AftercareContent body={item as Record<string, unknown>} /> : null;
    return <div key={field}><dt className="font-semibold text-ink-500">{label}</dt><dd className="m-0 whitespace-pre-wrap break-words">{Array.isArray(value) ? value.map((item, index) => <div key={index}>{display(item)}</div>) : display(value)}</dd></div>;
  })}</dl>;
}

export function AftercareWorkspace({ patientId }: { patientId: string }): React.JSX.Element {
  const scope = useRef(patientId); scope.current = patientId;
  const publicationAttempt = useRef<{ draft: string; objectId: string; requestId: string } | null>(null);
  const bindingAttempt = useRef<{ draft: string; id: string } | null>(null);
  const snapshotAttempt = useRef<{ draft: string; requestId: string } | null>(null);
  const supportAttempt = useRef<{ draft: string; requestId: string } | null>(null);
  const [relationships, setRelationships] = useState<AftercareSupportRelationship[]>([]);
  const [recipientId, setRecipientId] = useState("");
  const [supportEvidence, setSupportEvidence] = useState("");
  const [supportScopes, setSupportScopes] = useState<string[]>([]);
  const [supportConfirmed, setSupportConfirmed] = useState(false);
  const [attachment, setAttachment] = useState<{ url: string; type: string } | null>(null);
  useEffect(() => () => { if (attachment) URL.revokeObjectURL(attachment.url); }, [attachment]);
  const [clinicalSources, setClinicalSources] = useState<AftercareClinicalSource[]>([]);
  const [snapshotId, setSnapshotId] = useState("");
  const [schedule, setSchedule] = useState("");
  const [asNeeded, setAsNeeded] = useState(false);
  const [snapshotConfirmed, setSnapshotConfirmed] = useState(false);
  const [bindings, setBindings] = useState<AftercareBinding[]>([]);
  const [objects, setObjects] = useState<AftercareObject[]>([]);
  const [opened, setOpened] = useState<AftercareObject | null>(null);
  const [source, setSource] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState("");
  const [portal, setPortal] = useState("");
  const [relationship, setRelationship] = useState<"self" | "guardian">("self");
  const [evidence, setEvidence] = useState("");
  const [consent, setConsent] = useState("1");
  const [confirmed, setConfirmed] = useState(false);
  const [bindingId, setBindingId] = useState("");
  const [kind, setKind] = useState<"mission" | "carePlan" | "doctorNote" | "personalEvent">("mission");
  const [editing, setEditing] = useState<{ object: AftercareObject; publication: AftercarePublication } | null>(null);
  const [publicationStatus, setPublicationStatus] = useState<"published" | "withdrawn">("published");
  const [milestoneDate, setMilestoneDate] = useState("");
  const [milestoneCategory, setMilestoneCategory] = useState<"work" | "study" | "family" | "relationship" | "routine" | "challenge" | "achievement" | "other">("other");
  const editorHeading = useRef<HTMLHeadingElement>(null);
  const [title, setTitle] = useState("");
  const [purpose, setPurpose] = useState("");
  const [text, setText] = useState("");
  const [publicationConfirmed, setPublicationConfirmed] = useState(false);
  const [reply, setReply] = useState("");
  const [reviewConfirmed, setReviewConfirmed] = useState(false);
  const [offset, setOffset] = useState(0);
  const load = useCallback(async (page = 0): Promise<void> => {
    const [b, o, c] = await Promise.all([listAftercareBindings(patientId), listAftercareObjects(patientId, 25, page), listAftercareClinicalSources(patientId)]);
    if (scope.current !== patientId) return;
    setLoading(false);
    if (!b.ok || !o.ok) { setMessage(t.error); return; }
    setBindings(b.data); setObjects(o.data);
    setOpened(current => current && o.data.some(row => row.source === "sanad" && row.object_id === current.object_id && row.binding_id === current.binding_id && row.version === current.version && row.share_state === "shared") ? current : null);
    setSource(null); setAttachment(null);
    if (c.ok) setClinicalSources(c.data); else setMessage(t.error);
    setBindingId(current => b.data.some(row => row.id === current && !row.revoked_at) ? current : b.data.find(row => !row.revoked_at)?.id ?? "");
  }, [patientId]);
  useEffect(() => { scope.current = patientId; void load(); return () => { scope.current = ""; }; }, [patientId, load]);
  useEffect(() => { setRelationships([]); setRecipientId(""); setSupportConfirmed(false); setPublicationConfirmed(false); setSnapshotConfirmed(false); }, [bindingId]);
  async function run(action: () => Promise<void>): Promise<void> {
    setBusy(true); setMessage("");
    try { await action(); } catch { if (scope.current === patientId) setMessage(t.error); }
    finally { if (scope.current === patientId) setBusy(false); }
  }
  async function publish(publication: AftercarePublication, target?: AftercareObject): Promise<void> {
    const selectedBinding = target?.binding_id ?? bindingId;
    const expectedVersion = target?.version ?? 0;
    const draft = JSON.stringify({ bindingId: selectedBinding, publication, objectId: target?.object_id, expectedVersion });
    if (publicationAttempt.current?.draft !== draft) publicationAttempt.current = { draft, objectId: target?.object_id ?? crypto.randomUUID(), requestId: crypto.randomUUID() };
    const result = await publishAftercareObject({ bindingId: selectedBinding, objectId: publicationAttempt.current.objectId, expectedVersion, requestId: publicationAttempt.current.requestId, confirmed: true, publication });
    if (scope.current !== patientId) return;
    if (!result.ok) { setMessage(t.error); return; }
    publicationAttempt.current = null;
    setMessage(publication.kind === "review" ? t.reviewed : t.queued);
    setReviewConfirmed(false); setReply("");
    if (publication.kind !== "review") { setPublicationConfirmed(false); setEditing(null); setPublicationStatus("published"); setTitle(""); setPurpose(""); setText(""); }
    await load();
  }
  function beginEdit(object: AftercareObject, withdraw = false): void {
    let publication = editableAftercarePublication(object);
    if (!publication) return;
    if (withdraw) publication = withdrawAftercarePublication(publication);
    if (!publication || publication.kind === "review") return;
    setEditing({ object, publication }); setBindingId(object.binding_id); setKind(publication.kind);
    setPublicationStatus(withdraw ? "withdrawn" : "published"); setPublicationConfirmed(false);
    setTitle("title" in publication.body ? publication.body.title : "");
    setPurpose(publication.kind === "mission" ? publication.body.purpose : "");
    setText(publication.kind === "mission" ? publication.body.instructions : publication.kind === "personalEvent" ? publication.body.detail : publication.body.text);
    if (publication.kind === "personalEvent") { setMilestoneDate(publication.body.happenedOn); setMilestoneCategory(publication.body.category); }
    editorHeading.current?.focus(); editorHeading.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }
  function editorPublication(): AftercarePublication {
    if (kind === "mission") return { kind, body: { ...(editing?.publication.kind === kind ? editing.publication.body : {}), title, purpose, instructions: text, status: publicationStatus } };
    if (kind === "carePlan") return { kind, body: { title, text, status: publicationStatus } };
    if (kind === "doctorNote") return { kind, body: { text, status: publicationStatus } };
    return { kind, body: { type: "milestone", title, detail: text, happenedOn: milestoneDate, category: milestoneCategory, tags: editing?.publication.kind === kind ? editing.publication.body.tags : [] } };
  }
  async function loadSupport(): Promise<void> {
    setRelationships([]);
    const result = await gererSoutienAftercare({ patientId, bindingId, action: "list" });
    if (scope.current !== patientId) return;
    if (result.ok && result.data.relationships) setRelationships(result.data.relationships); else setMessage(t.error);
  }
  const report = opened ? AftercareSubmissionSchema.safeParse({ kind: opened.kind, body: opened.body }) : null;
  const selectedSources = opened ? selectedAftercareSources(opened) : [];
  const snapshot = clinicalSources.find(s => s.id === snapshotId);
  const panel = "flex flex-col gap-4 rounded-3xl border border-rule bg-card p-5";
  return <section className="flex flex-col gap-5" aria-label={t.title}>
    <header><h2 className="font-ui text-title font-bold text-ink-900">{t.title}</h2><p>{t.subtitle}</p><p className="text-ink-500">{t.separate}</p></header>
    <div role="status" aria-live="polite">{loading ? t.loading : message}</div>
    <div className="flex flex-wrap gap-3"><Bouton rang="secondaire" disabled={busy} onClick={() => void run(() => load())}>{t.refresh}</Bouton><Bouton rang="secondaire" disabled={busy} onClick={() => void run(async () => { const result = await transmettreAftercare(patientId); if (scope.current === patientId) setMessage(result.ok && result.data.delivered > 0 && result.data.pending === 0 ? t.received : t.pending); })}>{t.send}</Bouton></div>
    <details className={panel}><summary>{t.binding}</summary>
      <ChampTexte libelle={t.portalId} valeur={portal} onChange={v => { setPortal(v); setConfirmed(false); }} requis />
      <ChampSelection libelle={t.relationship} valeur={relationship} onChange={v => { setRelationship(v as "self" | "guardian"); setConfirmed(false); }} options={[{ valeur: "self", libelle: t.self }, { valeur: "guardian", libelle: t.guardian }]} />
      <p>{t.guardianWarning}</p><ChampZoneTexte libelle={t.evidence} valeur={evidence} onChange={v => { setEvidence(v); setConfirmed(false); }} requis />
      <ChampTexte libelle={t.consent} type="number" valeur={consent} onChange={v => { setConsent(v); setConfirmed(false); }} requis />
      <label><input type="checkbox" checked={confirmed} onChange={e => setConfirmed(e.target.checked)} /> {t.confirm}</label>
      <Bouton disabled={busy || !confirmed} onClick={() => void run(async () => { const draft = JSON.stringify({ portal, relationship, evidence, consent }); if (bindingAttempt.current?.draft !== draft) bindingAttempt.current = { draft, id: crypto.randomUUID() }; const result = await verifyAftercareBinding({ bindingId: bindingAttempt.current.id, patientId, portalPatientId: portal, relationship, evidence, consentVersion: Number(consent), confirmed: true }); if (scope.current !== patientId) return; if (!result.ok) { setMessage(t.error); return; } bindingAttempt.current = null; setConfirmed(false); const sync = await synchroniserAftercare({ patientId, bindingId: result.data[0]!.id }); if (scope.current !== patientId) return; setMessage(sync.ok ? t.active : t.controlPending); await load(); })}>{t.verify}</Bouton>
    </details>
    {bindings.map(binding => <div className={panel} key={binding.id}><p>{binding.relationship === "guardian" ? t.guardian : t.self} · {binding.revoked_at ? t.revoked : t.active} · {t.consent} {binding.consent_version}</p><p>{binding.verification_evidence}</p>{!binding.revoked_at ? <Bouton retrait rang="secondaire" disabled={busy} onClick={() => void run(async () => { const result = await revokeAftercareBinding(binding.id, true); if (scope.current !== patientId) return; setOpened(null); setSource(null); if (!result.ok) setMessage(t.error); else { const sync = await synchroniserAftercare({ patientId, bindingId: binding.id }); if (scope.current !== patientId) return; if (!sync.ok) setMessage(t.controlPending); await load(); } })}>{t.revoke}</Bouton> : null}</div>)}
    {bindings.map(binding => <Bouton key={`sync-${binding.id}`} rang="discret" disabled={busy} onClick={() => void run(async () => { const result = await synchroniserAftercare({ patientId, bindingId: binding.id }); if (scope.current === patientId) setMessage(result.ok ? t.active : t.controlPending); })}>{t.sync} · {binding.consent_version}</Bouton>)}
    <section className={panel}><h3 ref={editorHeading} tabIndex={-1}>{publicationStatus === "withdrawn" ? t.withdrawal : t.publication}</h3>
      {editing ? <><p>{kindLabel(editing.object.kind)} · {t.editing} {editing.object.version}</p><Bouton rang="discret" disabled={busy} onClick={() => { setEditing(null); setPublicationStatus("published"); setPublicationConfirmed(false); setTitle(""); setPurpose(""); setText(""); }}>{t.cancelEdit}</Bouton></> : <p>{t.createPublication}</p>}
      {!bindingId ? <p>{t.none}</p> : <><ChampSelection libelle={t.bindingLabel} valeur={bindingId} onChange={setBindingId} options={bindings.filter(b => !b.revoked_at).map(b => ({ valeur: b.id, libelle: `${b.relationship === "guardian" ? t.guardian : t.self} · ${t.consent} ${b.consent_version}` }))} />
      <ChampSelection libelle={t.kind} valeur={kind} disabled={editing !== null} onChange={v => { setKind(v as typeof kind); setPublicationConfirmed(false); }} options={["mission", "carePlan", "doctorNote", "personalEvent"].map(k => ({ valeur: k, libelle: kindLabel(k) }))} />
      {kind !== "doctorNote" ? <ChampTexte libelle={t.heading} valeur={title} onChange={v => { setTitle(v); setPublicationConfirmed(false); }} requis /> : null}
      {kind === "mission" ? <ChampZoneTexte libelle={t.purpose} valeur={purpose} onChange={v => { setPurpose(v); setPublicationConfirmed(false); }} requis /> : null}
      {kind === "personalEvent" ? <><ChampTexte libelle={t.milestoneDate} type="date" valeur={milestoneDate} onChange={v => { setMilestoneDate(v); setPublicationConfirmed(false); }} requis /><ChampSelection libelle={t.milestoneCategory} valeur={milestoneCategory} onChange={v => { setMilestoneCategory(v as typeof milestoneCategory); setPublicationConfirmed(false); }} options={Object.entries(t.categories).map(([value, label]) => ({ valeur: value, libelle: label }))} /></> : null}
      <ChampZoneTexte libelle={kind === "mission" ? t.instructions : t.text} valeur={text} onChange={v => { setText(v); setPublicationConfirmed(false); }} requis />
      <label><input type="checkbox" checked={publicationConfirmed} onChange={e => setPublicationConfirmed(e.target.checked)} /> {publicationStatus === "withdrawn" ? t.withdrawConfirm : t.publishConfirm}</label>
      <Bouton disabled={busy || !publicationConfirmed || (editing !== null && editing.object.binding_id !== bindingId)} onClick={() => void run(() => publish(editorPublication(), editing?.object))}>{publicationStatus === "withdrawn" ? t.withdraw : editing ? t.update : t.publish}</Bouton></>}
    </section>
    <details className={panel}><summary>{t.support}</summary>
      <p>{t.guardianWarning}</p><Bouton rang="secondaire" disabled={busy || !bindingId} onClick={() => void run(loadSupport)}>{t.listSupport}</Bouton>
      {relationships.map(relation => <p key={relation.id}>{relation.recipientName} · {relation.relationship} · {relation.acceptedAt ? t.accepted : t.waitingAcceptance} · {relation.verifiedAt ?? ""} · {relation.verifiedScopes.join(", ")}</p>)}
      <ChampSelection libelle={t.recipient} valeur={recipientId} onChange={v => { setRecipientId(v); setSupportConfirmed(false); }} options={[{ valeur: "", libelle: t.none }, ...relationships.filter(r => r.acceptedAt).map(r => ({ valeur: r.id, libelle: `${r.recipientName} · ${r.relationship}` }))]} />
      <ChampTexte libelle={t.supportEvidence} valeur={supportEvidence} onChange={v => { setSupportEvidence(v); setSupportConfirmed(false); }} />
      {([["emotional-support", t.emotionalSupport], ["care-coordination", t.careCoordination], ["legal-representation", t.legalRepresentation]] as const).map(([value, label]) => <label key={value}><input type="checkbox" checked={supportScopes.includes(value)} onChange={e => { setSupportScopes(current => e.target.checked ? [...current, value] : current.filter(item => item !== value)); setSupportConfirmed(false); }} /> {label}</label>)}
      <label><input type="checkbox" checked={supportConfirmed} onChange={e => setSupportConfirmed(e.target.checked)} /> {t.supportConfirm}</label>
      <Bouton disabled={busy || !recipientId || !bindingId || !supportConfirmed || !supportScopes.length} onClick={() => void run(async () => {
        const input = { patientId, bindingId, action: "verify" as const, relationshipId: recipientId, evidenceRef: supportEvidence, scopes: supportScopes, confirmed: true as const };
        const draft = JSON.stringify(input); if (supportAttempt.current?.draft !== draft) supportAttempt.current = { draft, requestId: crypto.randomUUID() };
        const result = await gererSoutienAftercare({ ...input, requestId: supportAttempt.current.requestId }); if (scope.current !== patientId) return;
        if (!result.ok) { setMessage(t.controlPending); return; } supportAttempt.current = null; setSupportConfirmed(false); await loadSupport(); setMessage(t.supportVerified);
      })}>{t.supportVerify}</Bouton>
    </details>
    <section className={panel}><h3>{t.snapshots}</h3>
      <ChampSelection libelle={t.kind} valeur={snapshotId} onChange={v => { setSnapshotId(v); setSnapshotConfirmed(false); setSchedule(""); setAsNeeded(false); }} options={[{ valeur: "", libelle: t.none }, ...clinicalSources.map(s => ({ valeur: s.id, libelle: `${s.kind === "treatment" ? t.treatment : t.appointment} · ${String(s.body.name ?? s.body.startsAt ?? "")} · ${t.sourceVersion} ${s.sourceVersion}` }))]} />
      {snapshot ? <><AftercareContent body={snapshot.body} />
        {snapshot.kind === "treatment" ? <><ChampTexte libelle={t.schedule} valeur={schedule} onChange={v => { setSchedule(v); setSnapshotConfirmed(false); }} /><label><input type="checkbox" checked={asNeeded} onChange={e => { setAsNeeded(e.target.checked); setSnapshotConfirmed(false); }} /> {t.asNeeded}</label></> : null}
        <label><input type="checkbox" checked={snapshotConfirmed} onChange={e => setSnapshotConfirmed(e.target.checked)} /> {t.snapshotConfirm}</label>
        <Bouton disabled={busy || !snapshotConfirmed || !bindingId} onClick={() => void run(async () => {
          const publication = { bindingId, kind: snapshot.kind, sourceId: snapshot.id, sourceVersion: snapshot.sourceVersion, expectedVersion: snapshot.publicationVersion, schedule: schedule.trim() ? schedule.split(",").map(s => s.trim()) : [], asNeeded, confirmed: true as const };
          const draft = JSON.stringify(publication); if (snapshotAttempt.current?.draft !== draft) snapshotAttempt.current = { draft, requestId: crypto.randomUUID() };
          const result = await publishAftercareClinicalSnapshot({ ...publication, requestId: snapshotAttempt.current.requestId });
          if (scope.current !== patientId) return; if (!result.ok) { setMessage(t.error); return; } snapshotAttempt.current = null; setSnapshotConfirmed(false); setMessage(t.queued); await load();
        })}>{t.publish}</Bouton></> : null}
    </section>
    <section className={panel}><h3>{t.submissions}</h3>{!objects.length && !loading ? <p>{t.empty}</p> : null}
      {objects.map(object => <article key={object.id} className="border-b border-rule py-3"><p>{kindLabel(object.kind)} · {t.version} {object.version} · {object.source === "sanad" ? object.read_at ? t.read : t.notRead : t.published}</p>{object.source === "sanad" ? <Bouton rang="secondaire" disabled={busy} onClick={() => void run(async () => { setOpened(null); setSource(null); setReply(""); setReviewConfirmed(false); const result = await readAftercareObject(object.binding_id, object.object_id, object.version); if (scope.current !== patientId) return; if (!result.ok || !result.data[0]) { setMessage(t.error); return; } setOpened(result.data[0]); setBindingId(object.binding_id); const sync = await synchroniserAftercare({ patientId, bindingId: object.binding_id, objectId: object.object_id, version: object.version }); if (scope.current !== patientId) return; if (!sync.ok) setMessage(t.controlPending); await load(); })}>{t.open}</Bouton> : <AftercareContent body={object.body} />}{editableAftercarePublication(object) ? <div className="flex flex-wrap gap-3"><Bouton rang="secondaire" disabled={busy} onClick={() => beginEdit(object)}>{t.edit}</Bouton>{object.body.status !== "withdrawn" && ["mission", "carePlan", "doctorNote"].includes(object.kind) ? <Bouton rang="secondaire" retrait disabled={busy} onClick={() => beginEdit(object, true)}>{t.withdraw}</Bouton> : null}</div> : null}</article>)}
      <div className="flex gap-3"><Bouton rang="secondaire" disabled={busy || offset === 0} onClick={() => { const next = Math.max(0, offset - 25); setOffset(next); void run(() => load(next)); }}>{t.previous}</Bouton><Bouton rang="secondaire" disabled={busy || objects.length < 25} onClick={() => { const next = offset + 25; setOffset(next); void run(() => load(next)); }}>{t.next}</Bouton></div>
    </section>
    {opened ? <section className={panel}><h3>{kindLabel(opened.kind)} · {t.version} {opened.version}</h3><p>{t.read}</p><AftercareContent body={opened.body} />
      {report?.success && "mediaIds" in report.data.body ? report.data.body.mediaIds?.map(mediaId => <Bouton key={mediaId} rang="secondaire" disabled={busy} onClick={() => void run(async () => { setAttachment(null); const result = await lireMediaAftercare({ bindingId: opened.binding_id, objectId: opened.object_id, version: opened.version, mediaId }); if (scope.current !== patientId) return; if (!result.ok) { setMessage(t.mediaUnavailable); return; } setAttachment({ url: URL.createObjectURL(result.data), type: result.data.type }); })}>{t.media}</Bouton>) : null}
      {attachment ? <div>{attachment.type.startsWith("audio/") ? <audio controls src={attachment.url} /> : <a href={attachment.url} download>{t.download}</a>}</div> : null}
      {selectedSources.length ? <div><h4>{t.sources}</h4>{selectedSources.map((ref, index) => <div key={`${ref.recordId}-${ref.version}`} className="border-b border-rule py-3"><span>{t.sourceNumber} {index + 1} · {t.version} {ref.version}</span><details><summary>{t.reference}</summary><p>{ref.recordId}</p></details><Bouton rang="discret" disabled={busy} onClick={() => void run(async () => { setSource(null); const result = await lireSourceAftercare({ bindingId: opened.binding_id, reportId: opened.object_id, reportVersion: opened.version, ...ref }); if (scope.current === patientId) { if (result.ok) setSource(result.data); else setMessage(t.sourceUnavailable); } })}>{t.source}</Bouton></div>)}{source ? <div><h4>{t.sourceContent} · {kindLabel((source as { kind: string }).kind)} · {t.version} {(source as { version: number }).version}</h4><AftercareContent body={(source as { body: Record<string, unknown> }).body} /></div> : null}</div> : null}
      <ChampZoneTexte libelle={t.reply} valeur={reply} onChange={v => { setReply(v); setReviewConfirmed(false); }} />
      <label><input type="checkbox" checked={reviewConfirmed} onChange={e => setReviewConfirmed(e.target.checked)} /> {t.reviewConfirm}</label>
      <Bouton disabled={busy || !reviewConfirmed || bindingId !== opened.binding_id} onClick={() => void run(() => publish({ kind: "review", body: { sourceId: opened.object_id, sourceVersion: opened.version, status: "reviewed", ...(reply.trim() ? { text: reply } : {}) } }))}>{t.review}</Bouton>
      <Bouton rang="discret" onClick={() => { setOpened(null); setSource(null); }}>{t.close}</Bouton>
    </section> : null}
  </section>;
}
