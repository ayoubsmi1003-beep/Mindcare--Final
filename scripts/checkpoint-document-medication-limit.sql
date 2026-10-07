\set ON_ERROR_STOP on
BEGIN;
SELECT app.validate_document_content(jsonb_build_object('type','doc','content',(SELECT jsonb_agg(jsonb_build_object('type','medication','attrs',jsonb_build_object('rowId',i::text,'medicationId',null,'source','free-text','designation','Test','strength','','posology','Prescribed by doctor','quantity','','frequency','','duration','','administration','','instructions',''))) FROM generate_series(1,50) i)));
ROLLBACK;
\echo DOCUMENT FIFTY MEDICATIONS PASS
