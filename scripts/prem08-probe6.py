"""Pre-M08 probe 6: verify 5 TARGET_NOT_ATOMIZED candidates, IDX page coverage, folio refs in xrefs, page gaps."""
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

print('=== L3 sets for the 5 suspect monographs ===')
for drug in ('Temazepam', 'Brexanolone', 'Carbamazepine', 'Gabapentin'):
    l3s = sorted({tuple(u['structural_path'][1:]) for u in content if u['structural_path'][0] == drug})
    print(drug, '->')
    for t in l3s:
        print('   ', t)

print('=== do those monographs contain units whose evidence mentions the target phrase? ===')
for drug, phrase in (('Temazepam', 'warning'), ('Brexanolone', 'how to'), ('Carbamazepine', 'children'), ('Gabapentin', 'children')):
    hits = [u['structural_path'][1:] for u in content if u['structural_path'][0] == drug and phrase in (u['title'] or '').lower()]
    print(drug, phrase, '->', hits)

print('=== IDX page coverage (all 99) ===')
idx_sorted = sorted(idx, key=lambda u: (u['page_start'], u['id']))
for u in idx_sorted:
    print(f"  {u['page_start']:>5}..{u['page_end']:<5} {u['structural_path'][1]:<16} {u['title'][:70]}")

print('=== xrefs target_text containing folio-like digits ===')
xr = load('xrefs.jsonl')
dig = [r for r in xr if re.search(r'\d', r.get('target_text') or '')]
print('count:', len(dig))
for r in dig[:15]:
    print('  ', json.dumps(r, ensure_ascii=False))

print('=== page coverage gaps (units vs pages 13..2682) ===')
covered = set()
for u in units:
    covered.update(range(u['page_start'], u['page_end'] + 1))
gaps = [p for p in range(13, 2683) if p not in covered]
print('covered pages:', len(covered), 'gaps in 13..2682:', len(gaps))
# compress gaps into ranges
rs = []
for p in gaps:
    if rs and p == rs[-1][1] + 1:
        rs[-1][1] = p
    else:
        rs.append([p, p])
print('gap ranges:', rs[:40])
print('max page covered:', max(covered), 'min:', min(covered))
