const nativeMigrations=new Set(['159_alexa_turn_lifecycle','160_alexa_query_reads','161_alexa_editable_draft_action','162_alexa_note_pages','163_alexa_slow_turn_lease','164_alexa_missing_text','165_alexa_read_consistency','166_alexa_history_activity','169_alexa_office_reads','170_alexa_reminder_context']);
/** Disabled native orchestration cannot add a schema prerequisite to the legacy EMR. */
export function requiredAlexaMigrations(versions,nativeEnabled){return versions.filter(version=>nativeEnabled||!nativeMigrations.has(version.replace(/\.sql$/u,'')));}
