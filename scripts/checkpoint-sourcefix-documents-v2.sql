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
ROLLBACK;
