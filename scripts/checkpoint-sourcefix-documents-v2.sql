SELECT app.create_editable_document_draft('d2000000-0000-4000-8000-000000000001','justification','{"date_consultation":"07/10/2026"}') AS created \gset
SELECT pg_temp.check_doc(:'created'::jsonb->>'rendererVersion'='v2','new draft renderer v2');
SELECT app.preview_editable_document_draft((:'created'::jsonb->>'id')::uuid,1) AS preview \gset
SELECT pg_temp.check_doc(position('N° d’Ordre : TEST-01' IN (:'preview'::jsonb->>'html'))>0,'professional order number before issuance');
RESET ROLE;
SELECT jsonb_build_object('contentHash',:'preview'::jsonb->>'contentHash','rendererVersion',:'preview'::jsonb->>'rendererVersion','pages',jsonb_build_array(jsonb_build_array(jsonb_build_object('path',jsonb_build_array(0),'from',0,'to',char_length(app.document_node_text(:'preview'::jsonb#>'{content,content,0}')))))) AS manifest \gset
SET LOCAL ROLE authenticated;
SELECT app.issue_editable_document_draft((:'created'::jsonb->>'id')::uuid,1,:'preview'::jsonb->>'contentHash',:'preview'::jsonb->>'identityVersion',:'manifest') AS issued \gset
SELECT pg_temp.check_doc(:'issued'::jsonb->>'documentId' IS NOT NULL,'v2 issuance persisted');
SELECT pg_temp.check_doc(position('N° d’Ordre : TEST-01' IN (:'issued'::jsonb->>'html'))>0,'professional number retained');
SELECT pg_temp.check_doc(position(:'issued'::jsonb->>'docNumber' IN (:'issued'::jsonb->>'html'))>0,'serial separately traceable');
SELECT pg_temp.check_doc(position('/documents/v2/watermark.svg' IN (:'issued'::jsonb->>'html'))>0 AND position('doc2-letter-footer' IN (:'issued'::jsonb->>'html'))>0,'v2 decoration persisted');
SELECT pg_temp.check_doc(position('Rue frères Merzoug N° 36 Mahelma Zeralda' IN (:'issued'::jsonb->>'html'))>0 AND position('Dr Larbi Psychiatre' IN (:'issued'::jsonb->>'html'))>0 AND position('/documents/v2/social.svg' IN (:'issued'::jsonb->>'html'))>0,'approved footer emitted even without profile social configuration');
SELECT pg_temp.check_doc(position('Signature et cachet' IN (:'issued'::jsonb->>'html'))=0,'no printed signature label');
SELECT pg_temp.check_doc(app.issue_editable_document_draft((:'created'::jsonb->>'id')::uuid,1,:'preview'::jsonb->>'contentHash',:'preview'::jsonb->>'identityVersion',:'manifest')->>'documentId'=:'issued'::jsonb->>'documentId','v2 retry idempotent');
RESET ROLE;
SELECT set_config('task.issued_snapshot',:'issued'::jsonb->>'documentId',true);
DO $$ BEGIN
 BEGIN
  UPDATE app.documents SET renderer_version='v1' WHERE id=current_setting('task.issued_snapshot')::uuid;
  RAISE EXCEPTION 'SnapshotMutationAccepted';
 EXCEPTION WHEN raise_exception THEN IF SQLERRM='SnapshotMutationAccepted' THEN RAISE;END IF;
 END;
END $$;
SELECT pg_temp.check_doc((SELECT renderer_version='v2' AND rendered_html=(:'issued'::jsonb->>'html') FROM app.documents WHERE id=current_setting('task.issued_snapshot')::uuid),'snapshot unchanged after refused mutation');
SELECT pg_temp.check_doc(app.document_repeats_strength('Produit synthétique 7,5 mg cp','7.5 mg'),'decimal separator and form');
SELECT pg_temp.check_doc(NOT app.document_repeats_strength('Produit synthétique 125 mg','25 mg'),'no partial numeric match');
SELECT pg_temp.check_doc(NOT app.document_repeats_strength('Produit synthétique 25 mg','['),'malformed strength cannot become regex');
SET LOCAL ROLE authenticated;
SELECT app.create_editable_document_draft('d2000000-0000-4000-8000-000000000001','ordonnance','{}') AS prescription \gset
RESET ROLE;
SELECT jsonb_build_object('type','doc','content',jsonb_agg(jsonb_build_object('type','medication','attrs',jsonb_build_object(
 'rowId',key,'medicationId',NULL,'source','free-text','designation',name,'strength',strength,'posology','2 fois par jour','quantity','','frequency','','duration','','administration','','instructions',instructions)) ORDER BY key)) AS prescription_content
FROM (VALUES
 ('1','Produit synthétique 7,5 mg cp','7.5 mg',E'Dose prescrite : 7.5 mg\nAvec le repas'),
 ('2','Produit synthétique 25 mg gél','25 mg','Dose prescrite : 25 mg'),
 ('3','Produit synthétique 50 mg cp','50 mg',E'Dose prescrite : 0,5 comprimé\nLe soir'),
 ('4','Solution synthétique 10 mg/ml','10 mg/ml','Dose prescrite : 10 mg'),
 ('5','Association synthétique 50 mg / 2 mg','50 mg','Dose prescrite : 50 mg'),
 ('6','Produit synthétique 125 mg','25 mg','Dose prescrite : 25 mg')
) AS cases(key,name,strength,instructions) \gset
SET LOCAL ROLE authenticated;
SELECT app.save_editable_document_draft((:'prescription'::jsonb->>'id')::uuid,1,:'prescription_content','{}','2026-11-16') AS saved_prescription \gset
SELECT app.preview_editable_document_draft((:'prescription'::jsonb->>'id')::uuid,2) AS prescription_preview \gset
SELECT 'PRESCRIPTION_PREVIEW:'||:'prescription_preview';
SELECT pg_temp.check_doc(:'prescription_preview'::jsonb#>>'{content,content,0,attrs,strength}'='' AND :'prescription_preview'::jsonb#>>'{content,content,0,attrs,instructions}'='Avec le repas','old draft duplicate strength and dose removed only for print');
SELECT pg_temp.check_doc(:'prescription_preview'::jsonb#>>'{content,content,1,attrs,instructions}'='','second redundant dose removed');
SELECT pg_temp.check_doc(:'prescription_preview'::jsonb#>>'{content,content,2,attrs,instructions}'=E'Dose prescrite : 0,5 comprimé\nLe soir','distinct quantity retained');
SELECT pg_temp.check_doc(:'prescription_preview'::jsonb#>>'{content,content,3,attrs,instructions}'='Dose prescrite : 10 mg' AND :'prescription_preview'::jsonb#>>'{content,content,4,attrs,instructions}'='Dose prescrite : 50 mg','concentrations and associations retain dose');
SELECT pg_temp.check_doc(:'prescription_preview'::jsonb#>>'{content,content,5,attrs,strength}'='25 mg' AND :'prescription_preview'::jsonb#>>'{content,content,5,attrs,instructions}'='Dose prescrite : 25 mg','different dose and strength retained');
SELECT pg_temp.check_doc(app.get_editable_document_draft((:'prescription'::jsonb->>'id')::uuid)->'content'=:'prescription_content'::jsonb,'original editable dose data untouched');
RESET ROLE;
SELECT jsonb_build_object('contentHash',:'prescription_preview'::jsonb->>'contentHash','rendererVersion','v2','pages',jsonb_build_array(jsonb_agg(jsonb_build_object('path',jsonb_build_array(position-1),'from',0,'to',char_length(app.document_node_text(node))) ORDER BY position))) AS prescription_manifest
FROM jsonb_array_elements(:'prescription_preview'::jsonb#>'{content,content}') WITH ORDINALITY AS nodes(node,position) \gset
SET LOCAL ROLE authenticated;
SELECT app.issue_editable_document_draft((:'prescription'::jsonb->>'id')::uuid,2,:'prescription_preview'::jsonb->>'contentHash',:'prescription_preview'::jsonb->>'identityVersion',:'prescription_manifest') AS issued_prescription \gset
SELECT pg_temp.check_doc(:'issued_prescription'::jsonb->>'documentId' IS NOT NULL,'normalized preview manifest accepted for prescription issuance');
SELECT pg_temp.check_doc(position('Dose prescrite : 7.5 mg' IN (:'issued_prescription'::jsonb->>'html'))=0 AND position('Dose prescrite : 0,5 comprimé' IN (:'issued_prescription'::jsonb->>'html'))>0,'issued HTML preserves only distinct dose');
SELECT pg_temp.check_doc(app.get_editable_document_snapshot((:'issued_prescription'::jsonb->>'documentId')::uuid)->>'html'=:'issued_prescription'::jsonb->>'html','reopen uses immutable emitted HTML');
ROLLBACK;
