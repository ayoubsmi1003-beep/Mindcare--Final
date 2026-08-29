"use client";

import { useEffect, useState } from "react";

import { AppShell } from "@/components/AppShell";
import { useSessionEcran } from "@/components/useSessionEcran";
import { BandeauHorsLigne, BlocErreur, Bouton, EnTeteEcran, Squelette } from "@/components/ui";
import { Carte } from "@/components/ui/Surfaces";
import { ChampTexte } from "@/components/ui/Champs";
import { LienBouton } from "@/components/ui/Bouton";
import { fr } from "@/i18n/fr";
import { getCabinet, getProfil, updateCabinet, updateProfil } from "@/services/cabinet";
import { getDocumentReadiness, type DocumentReadiness } from "@/services/documents";

export default function ParametresDocumentsPage(): React.JSX.Element {
  const { utilisateur, horsLigne: horsLigneSession, deconnecter } = useSessionEcran();
  const [cabinet, setCabinet] = useState<{ name: string; address: string; phone: string } | null>(null);
  const [profil, setProfil] = useState<{
    fullName: string;
    title: string;
    specialityFr: string;
    specialityAr: string;
    orderNumber: string;
    phone: string;
    fullNameAr: string;
  } | null>(null);
  const [readiness, setReadiness] = useState<DocumentReadiness | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    void getCabinet().then((r) => {
      if (r.ok && r.data) setCabinet({ name: r.data.name, address: r.data.address ?? "", phone: r.data.phone ?? "" });
    });
    void getProfil().then((r) => {
      if (r.ok && r.data) setProfil({
        fullName: r.data.fullName,
        title: r.data.title ?? "",
        specialityFr: r.data.specialityFr ?? "",
        specialityAr: r.data.specialityAr ?? "",
        orderNumber: r.data.orderNumber ?? "",
        phone: r.data.phone ?? "",
        fullNameAr: r.data.fullNameAr ?? "",
      });
    });
    void getDocumentReadiness().then((r) => { if (r.ok) setReadiness(r.data); });
  }, []);

  const saveCabinet = async (): Promise<void> => {
    if (!cabinet) return;
    setSaving(true); setErr(null); setMsg(null);
    const r = await updateCabinet({ name: cabinet.name, address: cabinet.address || null, phone: cabinet.phone || null });
    setSaving(false);
    if (!r.ok) setErr(r.error.message); else { setMsg("Cabinet enregistré."); void getDocumentReadiness().then((x)=>x.ok&&setReadiness(x.data)); }
  };
  const saveProfil = async (): Promise<void> => {
    if (!profil) return;
    setSaving(true); setErr(null); setMsg(null);
    const r = await updateProfil({
      fullName: profil.fullName,
      title: profil.title || null,
      specialityFr: profil.specialityFr || null,
      specialityAr: profil.specialityAr || null,
      orderNumber: profil.orderNumber || null,
      phone: profil.phone || null,
      fullNameAr: profil.fullNameAr || null,
    });
    setSaving(false);
    if (!r.ok) setErr(r.error.message); else { setMsg("Praticienne enregistrée."); void getDocumentReadiness().then((x)=>x.ok&&setReadiness(x.data)); }
  };

  if (utilisateur === undefined) return <main className="p-8"><Squelette lignes={4} /></main>;
  if (utilisateur === null) {
    return <main className="p-8"><BlocErreur message={fr.erreurs["non-authentifie"]} action={<LienBouton href="/connexion">{fr.actions.seConnecter}</LienBouton>} /></main>;
  }

  const horsLigne = horsLigneSession;

  return (
    <AppShell role={utilisateur.role} nomComplet={utilisateur.fullName} onDeconnexion={deconnecter}>
      <div className="flex flex-col gap-6">
        {horsLigne ? <BandeauHorsLigne /> : null}
        <EnTeteEcran icone="parametres" titre="Paramètres · Documents" sousTitre="Informations utilisées dans l'en-tête de chaque certificat" />

        {readiness && !readiness.canIssue ? (
          <div className="rounded-lg border border-attention bg-attention-bg p-4">
            <p className="font-ui text-label font-semibold uppercase tracking-label text-attention-ink">En-tête incomplet</p>
            <p className="font-ui text-body text-ink-700">{readiness.missing.map((m)=>m.label).join(" · ")}</p>
            <p className="font-ui text-label text-ink-500">Ces informations sont requises pour émettre un certificat. L&apos;impression est bloquée, la consultation du dossier reste possible.</p>
          </div>
        ) : readiness?.canIssue ? (
          <div className="rounded-lg border border-positive bg-positive-bg px-4 py-3 font-ui text-body text-positive">✓ Prêt à émettre — cabinet configuré</div>
        ) : null}

        {msg ? <div className="rounded-md border border-positive bg-positive-bg px-4 py-3 font-ui text-body text-positive">{msg}</div> : null}
        {err ? <BlocErreur message={err} /> : null}

        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          <Carte niveau="primaire">
            <div className="flex flex-col gap-4 p-6">
              <h2 className="font-ui text-heading font-semibold text-ink-900">Informations du cabinet</h2>
              {cabinet === null ? <Squelette lignes={3} /> : (
                <>
                  <ChampTexte libelle="Nom du cabinet" valeur={cabinet.name} onChange={(v)=>setCabinet({ ...cabinet, name: v })} requis />
                  <ChampTexte libelle="Adresse" valeur={cabinet.address} onChange={(v)=>setCabinet({ ...cabinet, address: v })} indication="Adresse postale complète" />
                  <ChampTexte libelle="Téléphone" valeur={cabinet.phone} onChange={(v)=>setCabinet({ ...cabinet, phone: v })} />
                  <Bouton rang="principal" onClick={() => void saveCabinet()} disabled={saving}>Enregistrer</Bouton>
                </>
              )}
            </div>
          </Carte>

          <Carte niveau="primaire">
            <div className="flex flex-col gap-4 p-6">
              <h2 className="font-ui text-heading font-semibold text-ink-900">Informations de la praticienne</h2>
              {profil === null ? <Squelette lignes={5} /> : (
                <>
                  <ChampTexte libelle="Nom" valeur={profil.fullName} onChange={(v)=>setProfil({ ...profil, fullName: v })} requis />
                  <ChampTexte libelle="Titre" valeur={profil.title} onChange={(v)=>setProfil({ ...profil, title: v })} placeholder="Dr." />
                  <ChampTexte libelle="Spécialité FR" valeur={profil.specialityFr} onChange={(v)=>setProfil({ ...profil, specialityFr: v })} />
                  <ChampTexte libelle="Spécialité AR" valeur={profil.specialityAr} onChange={(v)=>setProfil({ ...profil, specialityAr: v })} />
                  <ChampTexte libelle="N° d'Ordre" valeur={profil.orderNumber} onChange={(v)=>setProfil({ ...profil, orderNumber: v })} indication="Requis pour l'en-tête" />
                  <ChampTexte libelle="Téléphone" valeur={profil.phone} onChange={(v)=>setProfil({ ...profil, phone: v })} />
                  <ChampTexte libelle="Nom arabe" valeur={profil.fullNameAr} onChange={(v)=>setProfil({ ...profil, fullNameAr: v })} indication="Requis pour l'en-tête arabe" />
                  <Bouton rang="principal" onClick={() => void saveProfil()} disabled={saving}>Enregistrer</Bouton>
                </>
              )}
            </div>
          </Carte>
        </div>

        <Carte niveau="secondaire">
          <div className="p-4 font-ui text-body text-ink-500">
            <p>Les modifications n&apos;affectent que les <strong className="text-ink-900">nouveaux</strong> documents. Les certificats déjà émis gardent leur en-tête figé (hash + snapshot).</p>
            <p className="mt-2"><LienBouton href="/documents" rang="secondaire">Retour aux Documents</LienBouton></p>
          </div>
        </Carte>
      </div>
    </AppShell>
  );
}
