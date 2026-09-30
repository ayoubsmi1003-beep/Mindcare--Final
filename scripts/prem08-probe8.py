"""Pre-M08 probe 8: table-fragmentation signals + OCR/mojibake scan for classifier thresholds."""
import json, pathlib, re, collections, unicodedata
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

def signals(ev):
    lines = [l for l in ev.split('\n') if l.strip()]
    singles = sum(1 for l in lines if len(l.split()) <= 1)
    runon = len(re.findall(r'(?<=[a-z])(?=[A-Z][a-z])', ev))
    ratio = (singles / len(lines)) if lines else 0.0
    return len(lines), singles, round(ratio, 3), runon

print('=== caption units (Table N.) ===')
for u in units:
    if re.search(r'\bTable \d+\.', u['evidence_wording']):
        n, s, r, ro = signals(u['evidence_wording'])
        print(f"  {u['id']} lines={n} singles={s} ratio={r} runon={ro} {u['structural_path']}")

print('=== dose units signal distribution ===')
dose = [u for u in units if u['semantic_domain'] == 'dosing']
dist = collections.Counter()
worst = []
for u in dose:
    n, s, r, ro = signals(u['evidence_wording'])
    dist['runon>=2'] += (ro >= 2)
    dist['ratio>=0.25&lines>=8'] += (r >= 0.25 and n >= 8)
    dist['runon>=2 or ratio'] += (ro >= 2 or (r >= 0.25 and n >= 8))
    if ro >= 2 or (r >= 0.25 and n >= 8):
        worst.append((u['id'], n, r, ro, u['structural_path'][:3]))
print(dict(dist), 'of', len(dose))
for w in worst[:25]:
    print('  suspect:', w)

print('=== corpus-wide encoding scan ===')
fffd = c0 = 0
moji = collections.Counter()
for u in units:
    ev = u['evidence_wording']
    fffd += ev.count('�')
    for ch in ev:
        if ord(ch) < 32 and ch not in '\n\t':
            c0 += 1
    for m in re.findall(r'Ã[\x80-\xbfâ]|â(?:€|™|œ)', ev):
        moji[m] += 1
print('U+FFFD:', fffd, 'C0 controls:', c0, 'mojibake markers:', dict(moji))
odd = collections.Counter()
for u in units:
    for ch in u['evidence_wording']:
        if ord(ch) > 127:
            odd[ch] += 1
print('non-ascii chars:', {f'U+{ord(k):04X}({k})': v for k, v in sorted(odd.items())})
