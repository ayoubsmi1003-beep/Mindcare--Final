BEGIN;
CREATE OR REPLACE FUNCTION app.document_template_json(p_html text) RETURNS jsonb LANGUAGE plpgsql IMMUTABLE SET search_path=app,pg_catalog AS $$
DECLARE part text[]; outnodes jsonb:='[]'; pending_list jsonb:='[]'; paragraph jsonb; textvalue text;
BEGIN
 FOR part IN SELECT regexp_matches(p_html,'<(p|li)>([^<]*)</(p|li)>','gs') LOOP
  textvalue:=part[2];
  IF textvalue~'<[^>]+>' THEN RAISE EXCEPTION 'TemplateStructureRequiresReview'; END IF;
  textvalue:=replace(replace(replace(replace(replace(textvalue,'&amp;','&'),'&lt;','<'),'&gt;','>'),'&quot;','"'),'&#39;',chr(39));
  paragraph:=jsonb_build_object('type','paragraph','content',app.document_text_nodes(textvalue));
  IF part[1]='li' THEN pending_list:=pending_list||jsonb_build_array(jsonb_build_object('type','listItem','content',jsonb_build_array(paragraph)));
  ELSE
   IF jsonb_array_length(pending_list)>0 THEN outnodes:=outnodes||jsonb_build_array(jsonb_build_object('type','bulletList','content',pending_list));pending_list:='[]'; END IF;
   outnodes:=outnodes||jsonb_build_array(paragraph);
  END IF;
 END LOOP;
 IF jsonb_array_length(pending_list)>0 THEN outnodes:=outnodes||jsonb_build_array(jsonb_build_object('type','bulletList','content',pending_list)); END IF;
 IF jsonb_array_length(outnodes)=0 THEN RAISE EXCEPTION 'TemplateStructureRequiresReview'; END IF;
 RETURN jsonb_build_object('type','doc','content',outnodes);
END $$;

INSERT INTO app.schema_migrations(version) VALUES ('136_document_editor_template_compatibility') ON CONFLICT DO NOTHING;
COMMIT;
