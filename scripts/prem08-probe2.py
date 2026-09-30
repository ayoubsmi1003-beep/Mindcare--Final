"""Pre-M08 probe 2: xref statuses, section taxonomy, evidence characteristics, page map."""
import json, pathlib, collections, re
vd = pathlib.Path('knowledge/canonical-v2/stahl-prescribers-guide-7e-cup/sha256-cf23ef7b70e7c6e099a5a43d994adb2f34ef06718643932611f5e91eeba180e3')

def load(n):
    rows = []
    with open(vd / n, encoding='utf-8') as f:
        for l in f:
            if l.strip():
                rows.append(json.loads(l))
    return rows

print('=== pages.map.json full ===')
print(json.dumps(json.load(open(vd / 'pages.map.json', encoding='utf-8')), ensure_ascii=False, indent=1))

print('=== xrefs: status counts + non-resolved rows ===')
xr = load('xrefs.jsonl')
c = collections.Counter(r.get('status') for r in xr)
print('total:', len(xr), 'statuses:', dict(c))
nr = [r for r in xr if r.get('status') != 'resolved']
print('non-resolved:', len(nr))
for r in nr:
    print(json.dumps(r, ensure_ascii=False))

print('=== content units: L2 section (path[1]) counts ===')
units = []
for p in sorted(vd.glob('units-*.jsonl')):
    units.extend(load(p.name))
print('units loaded:', len(units))
c2 = collections.Counter(tuple(u['structural_path'][:2]) if len(u['structural_path']) >= 2 else tuple(u['structural_path']) for u in units if u['content_type'] != 'index-entry')
# aggregate on path[1]
c3 = collections.Counter(u['structural_path'][1] for u in units if u['content_type'] != 'index-entry' and len(u['structural_path']) > 1)
for k, v in c3.most_common(40):
    print(f'  {v:5d}  {k}')
print('content_type counts:', dict(collections.Counter(u['content_type'] for u in units)))
print('semantic_domain counts:', dict(collections.Counter(u['semantic_domain'] for u in units)))
print('predicates (top30):', collections.Counter(u['predicate'] for u in units).most_common(30))
