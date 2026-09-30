"""Pre-M08 probe 4: compact re-run of missing sections."""
import json, pathlib, collections, re
vd = pathlib.Path('knowledge/canonical-v2/stahl-prescribers-guide-7e-cup/sha256-cf23ef7b70e7c6e099a5a43d994adb2f34ef06718643932611f5e91eeba180e3')

def load(n):
    rows = []
    with open(vd / n, encoding='utf-8') as f:
        for l in f:
            if l.strip():
                rows.append(json.loads(l))
    return rows

units = []
for p in sorted(vd.glob('units-*.jsonl')):
    units.extend(load(p.name))
content = [u for u in units if u['content_type'] != 'index-entry']
idx = [u for u in units if u['content_type'] == 'index-entry']

print('confidence:', dict(collections.Counter(u['confidence'] for u in units)))
print('extraction_status:', dict(collections.Counter(u['extraction_status'] for u in units)))
print('validation_status:', dict(collections.Counter(u['validation_status'] for u in units)))
print('page_mapping_status:', dict(collections.Counter(u['page_mapping_status'] for u in units)))
print('parent_unit non-null:', sum(1 for u in units if u.get('parent_unit')))
print('related_units non-empty:', sum(1 for u in units if u.get('related_units')))
print('table_figure_ids non-empty:', sum(1 for u in units if u.get('table_figure_ids')))
print('evidence newline:', sum(1 for u in units if '\n' in (u.get('evidence_wording') or '')))
print('evidence tab:', sum(1 for u in units if '\t' in (u.get('evidence_wording') or '')))
print('page_start != page_end:', sum(1 for u in units if u['page_start'] != u['page_end']))
print('ev_len < 40:', sum(1 for u in units if len((u.get('evidence_wording') or '')) < 40))
print('idx folio pattern count:', sum(1 for u in idx if re.search(r',\s*\d{1,4}$', u['evidence_wording'])))
print('ev len stats: min', min(len(u['evidence_wording']) for u in units), 'max', max(len(u['evidence_wording']) for u in units))

print('--- dose samples (short) ---')
dose = [u for u in content if u['semantic_domain'] == 'dosing']
for u in dose[:2]:
    print(u['id'], u['structural_path'], '|', repr(u['evidence_wording'][:260]))
print('--- dose units with newline:', sum(1 for u in dose if '\n' in u['evidence_wording']), '/', len(dose))

print('--- see Table units ---')
for uid in ('stahl7-u-1771-009', 'stahl7-u-1108-030'):
    u = next(x for x in units if x['id'] == uid)
    print(u['id'], u['structural_path'])
    print(' ev:', repr(u['evidence_wording'][:400]))

print('--- units whose evidence contains a Table caption ---')
cap = [u for u in content if re.search(r'\bTable \d+\.', u['evidence_wording'])]
print('count:', len(cap))
print('sample paths:', [u['structural_path'] for u in cap[:5]])

print('--- short evidence (<40) by domain ---')
short = [u for u in units if len((u.get('evidence_wording') or '')) < 40]
print(dict(collections.Counter(u['semantic_domain'] for u in short)))

print('--- how_to_dose med sample ---')
m = load('meds-A.jsonl')[0]
print(json.dumps({k: m[k] for k in ('med_id', 'drug_name', 'usual_dosage_range', 'how_to_dose', 'page_start', 'page_end', 'unit_ids')}, ensure_ascii=False, indent=1)[:900])
