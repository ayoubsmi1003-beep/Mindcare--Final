"""Pre-M08 probe 10: lone-U+00CE contexts + refined runon signal distribution."""
import json, pathlib, re, collections, sys
sys.stdout.reconfigure(encoding='utf-8', errors='replace')
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

print('=== U+00CE contexts (first 8) ===')
n = 0
for u in units:
    ev = u['evidence_wording']
    for m in re.finditer('Î', ev):
        s = max(0, m.start() - 30)
        print(f"  {u['id']} ...{ev[s:m.end()+30]!r}...")
        n += 1
        if n >= 8:
            break
    if n >= 8:
        break
print('total units containing Î:', sum(1 for u in units if 'Î' in u['evidence_wording']))
print('=== U+00B4 context ===')
for u in units:
    if '´' in u['evidence_wording']:
        i = u['evidence_wording'].index('´')
        print(f"  {u['id']} ...{u['evidence_wording'][max(0,i-30):i+30]!r}...")

print('=== refined runon (?<=[a-z]{3})(?=[A-Z][a-z]) distribution ===')
cnt = collections.Counter()
flagged = []
for u in units:
    ro = len(re.findall(r'(?<=[a-z]{3})(?=[A-Z][a-z])', u['evidence_wording']))
    for th in (1, 2, 3):
        if ro >= th:
            cnt[f'>={th}'] += 1
    if ro >= 2:
        flagged.append((u['id'], ro, u['structural_path'][:3]))
print(dict(cnt))
for f in flagged:
    print('  runon>=2:', f)
    ev = next(u['evidence_wording'] for u in units if u['id'] == f[0])
    for m in re.finditer(r'(?<=[a-z]{3})(?=[A-Z][a-z])', ev):
        s = max(0, m.start() - 25)
        print('     ...', repr(ev[s:m.end() + 25]))
        break
