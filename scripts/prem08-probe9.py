"""Pre-M08 probe 9: inspect non-caption suspects + safe non-ascii inventory."""
import json, pathlib, re, collections, sys, unicodedata
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
by_id = {u['id']: u for u in units}

print('=== runon>=2 non-caption units: full evidence ===')
for u in units:
    if re.search(r'\bTable \d+\.', u['evidence_wording']):
        continue
    ro = len(re.findall(r'(?<=[a-z])(?=[A-Z][a-z])', u['evidence_wording']))
    if ro >= 2:
        print(f"--- {u['id']} runon={ro} {u['structural_path']}")
        print(u['evidence_wording'][:700].replace('\n', ' | '))

print('=== sample ratio suspects: Oxcarbazepine UDR, Valbenazine How to Dose ===')
for uid in ('stahl7-u-1664-070', 'stahl7-u-2360-040'):
    u = by_id[uid]
    print(f"--- {uid} {u['structural_path']}")
    print(u['evidence_wording'].replace('\n', ' | '))

print('=== non-ascii inventory (safe) ===')
odd = collections.Counter()
for u in units:
    for ch in u['evidence_wording']:
        if ord(ch) > 127:
            odd[ch] += 1
for ch, n in sorted(odd.items()):
    print(f'  U+{ord(ch):04X} x{n}  {unicodedata.name(ch, "?")}' if (lambda: True)() else '')
