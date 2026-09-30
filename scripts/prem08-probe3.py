"""Pre-M08 probe 3: L3 taxonomy, evidence structure for dose/table units, field distributions."""
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

print('=== L3 (path[2]) counts, top 70 ===')
for k, v in collections.Counter(u['structural_path'][2] for u in content if len(u['structural_path']) > 2).most_common(70):
    print(f'  {v:5d}  {k}')

print('=== L3 for Special Populations / Side Effects ===')
for l2 in ('Special Populations', 'Side Effects', 'Dosing and Use'):
    c = collections.Counter(u['structural_path'][2] for u in content if len(u['structural_path']) > 2 and u['structural_path'][1] == l2)
    print(l2, '->', dict(c.most_common(30)))

print('=== field distributions ===')
print('confidence:', dict(collections.Counter(u['confidence'] for u in units)))
print('extraction_status:', dict(collections.Counter(u['extraction_status'] for u in units)))
print('validation_status:', dict(collections.Counter(u['validation_status'] for u in units)))
print('page_mapping_status:', dict(collections.Counter(u['page_mapping_status'] for u in units)))
print('parent_unit non-null:', sum(1 for u in units if u.get('parent_unit')))
print('related_units non-empty:', sum(1 for u in units if u.get('related_units')))
print('table_figure_ids non-empty:', sum(1 for u in units if u.get('table_figure_ids')))
print('evidence with newline:', sum(1 for u in units if '\n' in (u.get('evidence_wording') or '')))
print('evidence with tab:', sum(1 for u in units if '\t' in (u.get('evidence_wording') or '')))
print('page_start != page_end:', sum(1 for u in units if u['page_start'] != u['page_end']))
print('idx units evidence ending in folio pattern:', sum(1 for u in idx if re.search(r',\s*\d{1,4}$', u['evidence_wording'])))
print('idx folio example:', [u['evidence_wording'] for u in idx if re.search(r',\s*\d{1,4}$', u['evidence_wording'])][:3])
print('idx units w/o folio:', [u['evidence_wording'] for u in idx if not re.search(r',\s*\d{1,4}$', u['evidence_wording'])][:5])

print('=== dose unit samples (semantic_domain=dosing) ===')
dose = [u for u in content if u['semantic_domain'] == 'dosing']
for u in dose[:3]:
    print(json.dumps({k: u[k] for k in ('id', 'structural_path', 'title', 'content_type', 'evidence_wording', 'page_start', 'page_end')}, ensure_ascii=False, indent=1))

print('=== see Table unit evidence ===')
for uid in ('stahl7-u-1771-009', 'stahl7-u-1108-030', 'stahl7-u-1654-058'):
    u = next(x for x in units if x['id'] == uid)
    print(json.dumps({k: u[k] for k in ('id', 'structural_path', 'title', 'evidence_wording')}, ensure_ascii=False, indent=1))
