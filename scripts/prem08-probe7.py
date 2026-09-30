"""Pre-M08 probe 7: folio-conflict evidence, structure sections, gap classification, duplicates."""
import json, pathlib, collections, hashlib
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

print('=== monograph covering pdf 255 + nalmefene/naltrexone positions ===')
for u in content:
    if u['page_start'] <= 255 <= u['page_end']:
        print('  at255:', u['id'], u['structural_path'], u['page_start'], u['page_end'])
        break
for drug in ('Naltrexone', 'Nalmefene'):
    us = [u for u in content if u['structural_path'][0] == drug]
    print(f'  {drug}: ', (min(u["page_start"] for u in us), max(u["page_end"] for u in us)) if us else 'NO MONOGRAPH')

print('=== structure.json sections/unlocated ===')
st = json.load(open(vd / 'structure.json', encoding='utf-8'))
sec = st['sections']
print('sections type:', type(sec).__name__, 'len:', len(sec))
print('sample:', json.dumps(sec[:3] if isinstance(sec, list) else dict(list(sec.items())[:3]), ensure_ascii=False)[:600])
print('unlocated_sections:', json.dumps(st['unlocated_sections'], ensure_ascii=False)[:300])

print('=== gap classification ===')
covered = set()
for u in units:
    covered.update(range(u['page_start'], u['page_end'] + 1))
gaps = [p for p in range(13, 2683) if p not in covered]
mono_span = collections.defaultdict(lambda: [10**9, -1])
for u in content:
    sp = mono_span[u['structural_path'][0]]
    sp[0] = min(sp[0], u['page_start'])
    sp[1] = max(sp[1], u['page_end'])
inside, between = [], []
back = [p for p in gaps if 2568 <= p <= 2627]
other = [p for p in gaps if not (2568 <= p <= 2627)]
for p in other:
    if any(lo <= p <= hi for lo, hi in mono_span.values()):
        inside.append(p)
    else:
        between.append(p)
print('gaps total:', len(gaps), 'back-matter(2568-2627):', len(back), 'inside-monograph:', len(inside), 'between-monograph:', len(between))
print('between pages:', between)
print('inside pages (first 30):', inside[:30])

print('=== duplicate evidence groups ===')
c1 = collections.Counter(u['evidence_wording'] for u in content)
g1 = [k for k, v in c1.items() if v > 1]
print('content-only: groups:', len(g1), 'rows:', sum(c1[k] for k in g1))
c2 = collections.Counter(u['evidence_wording'] for u in units)
g2 = [k for k, v in c2.items() if v > 1]
print('all units: groups:', len(g2), 'rows:', sum(c2[k] for k in g2))

print('=== lowercase see units ===')
import re
low = [u for u in units if re.search(r'\(see ', u['evidence_wording']) or re.search(r'\bsee [a-z]', u['evidence_wording'])]
print('units with (see / see lowercase:', len(low))
boiler = [u for u in units if 'see index for additional brand' in u['evidence_wording']]
print('boilerplate see-index:', len(boiler))

print('=== review-queue-audit.json ===')
print(open(vd / 'review-queue-audit.json', encoding='utf-8').read())
