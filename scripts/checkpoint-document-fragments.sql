\set ON_ERROR_STOP on
DO $$ DECLARE node jsonb:='{"type":"orderedList","attrs":{"start":4},"content":[{"type":"listItem","content":[{"type":"paragraph","content":[{"type":"text","text":"one"}]}]},{"type":"listItem","content":[{"type":"paragraph","content":[{"type":"text","text":"two"}]}]},{"type":"listItem","content":[{"type":"paragraph","content":[{"type":"text","text":"three"}]}]}]}';BEGIN
 IF app.render_document_node(node,ARRAY[0],0,3) NOT LIKE '<ol start="4"%' THEN RAISE EXCEPTION 'OrderedListTailChangedNumber';END IF;
 IF app.render_document_node(node,ARRAY[0],3,6) NOT LIKE '<ol start="5"%' THEN RAISE EXCEPTION 'OrderedListPrefixNumberWrong';END IF;
END $$;
\echo DOCUMENT FRAGMENT CHECKPOINT PASS
