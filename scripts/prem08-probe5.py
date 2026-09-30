"""Pre-M08 probe 5: index folio refs + re-derive 24 unresolved xref classes."""
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
by_id = {u['id']: u for u in units}
content = [u for u in units if u['content_type'] != 'index-entry']
idx = [u for u in units if u['content_type'] == 'index-entry']

print('=== IDX structural_path[1] distribution ===')
print(dict(collections.Counter(u['structural_path'][1] for u in idx)))
print('=== IDX units whose evidence contains digits + trailing number lists ===')
with_digits = [u for u in idx if re.search(r'\d', u['evidence_wording'])]
print('idx with digits:', len(with_digits), '/', len(idx))
for u in with_digits[:8]:
    print(' ', u['structural_path'], '->', repr(u['evidence_wording'][:200]))
print('=== Adderrall / Adderall mentions ===')
for u in units:
    if 'adderall' in u['evidence_wording'].lower() or 'adderrall' in (u['title'] or '').lower():
        print(' ', u['id'], u['structural_path'], repr(u['evidence_wording'][:160]))
print('=== monograph page ranges for a few drugs ===')
for drug in ('Acamprosate', 'Agomelatine', 'Alprazolam', 'Oxazepam', 'Phenelzine'):
    us = [u for u in content if u['structural_path'][0] == drug]
    if us:
        print(f'  {drug}: pdf {min(u["page_start"] for u in us)}..{max(u["page_end"] for u in us)} ({len(us)} units)')

print('=== re-derive classes for the 24 unresolved ===')
xr = load('xrefs.jsonl')
unres = [r for r in xr if r.get('status') != 'resolved']
mono_sections = collections.defaultdict(set)
for u in content:
    if len(u['structural_path']) >= 2:
        mono_sections[(u['structural_path'][0], u['structural_path'][1])].add(u['structural_path'][2] if len(u['structural_path']) > 2 else None)

tally = collections.Counter()
for r in unres:
    u = by_id.get(r['from_unit'])
    path = u['structural_path']
    mono, l2, l3 = (path + [None, None, None])[:3]
    tt = r['target_text']
    if tt == 'see Table':
        has_cap = bool(re.search(r'\bTable \d+\.', u['evidence_wording']))
        cls = 'TABLE_CAPTION_WITHIN_UNIT' if has_cap else 'UNRESOLVED'
    else:
        # target section name from pointer text
        key = tt.replace('see ', '').replace(' below', '').strip()
        # does target L2/L3 exist elsewhere in same monograph?
        l2s = {p[1] for p in (x['structural_path'] for x in content) if p[0] == mono and len(p) >= 2}
        target_l2 = next((s for s in l2s if s.lower().startswith(key.lower())), None)
        in_self = l2 and key and l2.lower().startswith(key.lower())
        if in_self:
            cls = 'POINTER_WITHIN_UNIT'
        elif target_l2 is None:
            cls = 'TARGET_NOT_ATOMIZED'
        else:
            cls = 'SHOULD_HAVE_RESOLVED'
    tally[cls] += 1
    print(f'  {r["from_unit"]:<22} {tt:<22} {mono:<22} L2={l2} L3={l3} -> {cls}')
print('tally:', dict(tally))
