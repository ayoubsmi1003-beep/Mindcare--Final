BEGIN;
CREATE OR REPLACE FUNCTION app.render_document_node(n jsonb,p_path integer[] DEFAULT '{}',p_from integer DEFAULT 0,p_to integer DEFAULT 2147483647) RETURNS text LANGUAGE plpgsql IMMUTABLE SET search_path=app,pg_catalog AS $$
DECLARE t text:=n->>'type'; out_html text:=''; child jsonb; child_html text; pos integer:=0; len integer; ix integer:=0; contenttext text; mark jsonb; wrapper text; k text; attr text:=''; startvalue integer:=1;
BEGIN
 len:=char_length(app.document_node_text(n));
 IF len>0 AND (p_from>=len OR p_to<=0) THEN RETURN '';END IF;
 IF t IN ('text','field') THEN
  contenttext:=substring(app.document_node_text(n) FROM greatest(p_from,0)+1 FOR greatest(least(p_to,len)-greatest(p_from,0),0));out_html:=app.html_escape(contenttext);
  IF t='text' THEN FOR mark IN SELECT value FROM jsonb_array_elements(COALESCE(n->'marks','[]')) LOOP wrapper:=CASE mark->>'type' WHEN 'bold' THEN 'strong' WHEN 'italic' THEN 'em' ELSE 'u' END;out_html:='<'||wrapper||'>'||out_html||'</'||wrapper||'>';END LOOP;
  ELSE out_html:='<span data-field="'||app.html_escape(n#>>'{attrs,name}')||'">'||out_html||'</span>';END IF;RETURN out_html;
 ELSIF t='hardBreak' THEN RETURN '<br>';ELSIF t='pageBreak' THEN RETURN '';
 ELSIF t='medication' THEN
  -- Split a medication's printed text with the same codepoint offsets as its source attributes.
  contenttext:=substring(app.document_node_text(n) FROM greatest(p_from,0)+1 FOR greatest(least(p_to,len)-greatest(p_from,0),0));
  RETURN '<div class="doc2-medication" data-path="'||array_to_string(p_path,'.')||'" data-length="'||len||'">'||replace(app.html_escape(contenttext),E'\n','<br>')||'</div>';
 END IF;
 FOR child IN SELECT value FROM jsonb_array_elements(COALESCE(n->'content','[]')) LOOP
  len:=char_length(app.document_node_text(child));
  child_html:=app.render_document_node(child,p_path||ix,greatest(p_from-pos,0),least(p_to-pos,len));
  IF len=0 AND (pos<p_from OR pos>p_to) THEN child_html:='';END IF;
  IF t='orderedList' AND child_html='' AND pos+len<=p_from THEN startvalue:=startvalue+1;END IF;
  out_html:=out_html||child_html;pos:=pos+len;ix:=ix+1;
 END LOOP;
 IF t='doc' THEN RETURN out_html;ELSIF t='paragraph' THEN
  attr:=' data-path="'||array_to_string(p_path,'.')||'" data-length="'||char_length(app.document_node_text(n))||'" dir="'||COALESCE(n#>>'{attrs,dir}','auto')||'" style="text-align:'||COALESCE(n#>>'{attrs,textAlign}','justify')||'"';
  RETURN '<p'||attr||'>'||CASE WHEN out_html='' THEN '<br>' ELSE out_html END||'</p>';
 ELSIF t='listItem' THEN IF btrim(regexp_replace(out_html,'<[^>]+>','','g'))='' THEN RETURN '';END IF;RETURN '<li>'||out_html||'</li>';
 ELSIF t='bulletList' THEN RETURN '<ul data-path="'||array_to_string(p_path,'.')||'" data-length="'||char_length(app.document_node_text(n))||'">'||out_html||'</ul>';
 ELSIF t='orderedList' THEN RETURN '<ol start="'||(COALESCE((n#>>'{attrs,start}')::integer,1)+startvalue-1)||'" data-path="'||array_to_string(p_path,'.')||'" data-length="'||char_length(app.document_node_text(n))||'">'||out_html||'</ol>';
 END IF;RETURN '';
END $$;

INSERT INTO app.schema_migrations(version) VALUES ('139_document_editor_list_fragments') ON CONFLICT DO NOTHING;
COMMIT;
