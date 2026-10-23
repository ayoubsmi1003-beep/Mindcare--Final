BEGIN;
-- 176 - contexte d'auto-remplissage et en-tete sans faux numero.
--
-- 1. Le certificat medical affiche la date de naissance editable du brouillon
--    quand elle est valide.
-- 2. En toutes lettres est une valeur que la praticienne peut corriger : on ne
--    l'ecrase plus quand elle est renseignee, on la calcule seulement si vide.
-- 3. Le No d'Ordre n'existe qu'a l'emission. Le contexte d'un brouillon n'a pas
--    de document_number : la ligne est OMISE, jamais remplacee par un tiret.
--    Le compteur transactionnel et le format DOC-YYYY-NNNNN restent inchanges.

CREATE OR REPLACE FUNCTION app.document_context(d app.document_drafts) RETURNS jsonb LANGUAGE plpgsql STABLE SET search_path=app,pg_catalog AS $$
DECLARE p app.patients%ROWTYPE; pr app.profiles%ROWTYPE; cb app.cabinets%ROWTYPE; ctx jsonb; k text; v jsonb; v_date date; v_birth_fr text; v_age text; v_written text;
BEGIN
 SELECT * INTO p FROM app.patients WHERE id=d.patient_id;SELECT * INTO pr FROM app.profiles WHERE id=d.practitioner_id;SELECT * INTO cb FROM app.cabinets WHERE id=d.cabinet_id;
 ctx:=jsonb_build_object('patient_first_name',p.first_name,'patient_last_name',p.last_name,'patient_record_number',p.record_number,'patient_birth_date',p.birth_date::text,'patient_birth_date_fr',to_char(p.birth_date,'DD/MM/YYYY'),'patient_age',extract(year FROM age(d.document_date,p.birth_date))::integer::text,'patient_civilite',app.civilite(p.sex,p.marital_status),'patient_id_document_number',p.id_document_number,'praticien_full_name',pr.full_name,'praticien_title',pr.title,'praticien_speciality_fr',pr.speciality_fr,'praticien_speciality_ar',pr.speciality_ar,'praticien_order_number',pr.order_number,'praticien_phone',pr.phone,'praticien_full_name_ar',pr.signature_block->>'full_name_ar','cabinet_name',cb.name,'cabinet_address',cb.address,'cabinet_phone',cb.phone);
 FOR k,v IN SELECT key,value FROM jsonb_each(d.variables) LOOP ctx:=ctx||jsonb_build_object('vars_'||k,v);END LOOP;
 ctx:=ctx||jsonb_build_object('vars_date_affichee',CASE WHEN d.doc_type='justification' THEN d.variables->>'date_consultation' ELSE to_char(d.document_date,'DD/MM/YYYY') END);
 -- Certificat medical : la date corrigee dans le panneau est celle qui s'imprime,
-- et l'age du bandeau reste coherent avec elle. Une valeur invalide est ignoree
-- sans faire echouer l'apercu ; le formulaire signale deja le format attendu.
IF d.doc_type='certificat_medical' AND btrim(COALESCE(d.variables->>'date_naissance',''))<>'' THEN
 BEGIN
  BEGIN
   v_date:=to_date(d.variables->>'date_naissance','DD/MM/YYYY');
   v_birth_fr:=to_char(v_date,'DD/MM/YYYY');
   v_age:=extract(year FROM age(d.document_date,v_date))::integer::text;
   ctx:=jsonb_set(ctx,'{patient_birth_date_fr}',to_jsonb(v_birth_fr));
   ctx:=jsonb_set(ctx,'{patient_age}',to_jsonb(v_age));
  EXCEPTION WHEN others THEN NULL;
  END;
 END;
END IF;
IF d.doc_type='suivi_medical' AND COALESCE(d.variables->>'jours','')~'^[0-9]{1,3}$' AND (d.variables->>'jours')::integer BETWEEN 1 AND 365 THEN
 IF btrim(COALESCE(d.variables->>'jours_lettres',''))='' THEN
  v_written:=app.nombre_en_lettres((d.variables->>'jours')::integer);
 ELSE
  v_written:=d.variables->>'jours_lettres';
 END IF;
 ctx:=ctx||jsonb_build_object('vars_jours_lettres',v_written,'vars_jours',(d.variables->>'jours')||' ('||v_written||')');
END IF;
 RETURN ctx;
END $$;;

ALTER FUNCTION app.document_context(app.document_drafts) OWNER TO app_gatekeeper;
REVOKE ALL ON FUNCTION app.document_context(app.document_drafts) FROM PUBLIC;

CREATE OR REPLACE FUNCTION app.document_header_html(ctx jsonb) RETURNS text LANGUAGE sql IMMUTABLE SET search_path=app,pg_catalog AS $$
 SELECT '<header class="doc2-header"><div class="doc2-identity"><p class="doc2-doctor">'||app.html_escape(COALESCE(ctx->>'praticien_title',''))||' '||app.html_escape(COALESCE(ctx->>'praticien_full_name',''))||'</p><p>'||app.html_escape(COALESCE(ctx->>'praticien_speciality_fr',''))||'</p><hr><div dir="rtl" class="doc2-ar"><p class="doc2-doctor">'||app.html_escape(COALESCE(ctx->>'praticien_full_name_ar',''))||'</p><p>'||app.html_escape(COALESCE(ctx->>'praticien_speciality_ar',''))||'</p></div><hr>'||CASE WHEN COALESCE(ctx->>'document_number','')<>'' THEN '<p>N° d’Ordre : '||app.html_escape(ctx->>'document_number')||'</p>' ELSE '' END||'<p>Tél. : '||app.html_escape(COALESCE(ctx->>'praticien_phone',''))||'</p></div><div class="doc2-mark" aria-hidden="true"><svg viewBox="0 0 48 48" fill="none"><path d="M23 9C17 3 9 8 10 15C3 18 5 27 10 29C7 37 17 43 23 37V9ZM25 9C31 3 39 8 38 15C45 18 43 27 38 29C41 37 31 43 25 37V9ZM12 17C18 15 20 21 16 24M11 31C16 28 20 31 19 36M36 17C30 15 28 21 32 24M37 31C32 28 28 31 29 36"/></svg></div><div class="doc2-patient"><p><b>Date :</b> '||app.html_escape(COALESCE(ctx->>'vars_date_affichee',''))||'</p><p><b>Nom :</b> '||app.html_escape(COALESCE(ctx->>'patient_last_name',''))||'</p><p><b>Prénom :</b> '||app.html_escape(COALESCE(ctx->>'patient_first_name',''))||'</p><p><b>Âge :</b> '||app.html_escape(COALESCE(ctx->>'patient_age',''))||' ans</p></div></header>';
$$;;

ALTER FUNCTION app.document_header_html(jsonb) OWNER TO app_gatekeeper;
REVOKE ALL ON FUNCTION app.document_header_html(jsonb) FROM PUBLIC;

-- Le champ s'appelle « Mairie de délivrance » : la valeur saisie porte donc
-- souvent « Mairie d'Alger ». La phrase du modèle ne doit pas répéter
-- « la mairie de ». Les pièces déjà émises gardent leur HTML figé.
UPDATE app.document_templates
   SET body_html = replace(body_html, 'délivrée par la mairie de {{vars.mairie}}', 'délivrée par {{vars.mairie}}'),
       content_json = replace(content_json::text, 'délivrée par la mairie de ', 'délivrée par ')::jsonb
 WHERE doc_type='bonne_sante_mentale' AND is_active;
UPDATE app.document_drafts
   SET content_json = replace(content_json::text, 'délivrée par la mairie de ', 'délivrée par ')::jsonb
 WHERE doc_type='bonne_sante_mentale' AND issued_document_id IS NULL;

INSERT INTO app.schema_migrations(version) VALUES ('176_document_autofill_context') ON CONFLICT DO NOTHING;
COMMIT;
