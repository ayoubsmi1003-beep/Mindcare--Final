"""Pre-M08 probe: dump data shapes needed to design the integrity package."""
import json, pathlib
vd = pathlib.Path('knowledge/canonical-v2/stahl-prescribers-guide-7e-cup/sha256-cf23ef7b70e7c6e099a5a43d994adb2f34ef06718643932611f5e91eeba180e3')

def head(n, k=3):
    with open(vd / n, encoding='utf-8') as f:
        return [json.loads(l) for _, l in zip(range(k), f)]

print('=== book.json ===')
print(json.dumps(json.load(open(vd / 'book.json', encoding='utf-8')), indent=1, ensure_ascii=False))
print('=== unit sample (content) ===')
print(json.dumps(head('units-B.jsonl')[0], indent=1, ensure_ascii=False)[:2400])
print('=== unit sample (IDX) ===')
print(json.dumps(head('units-IDX.jsonl')[0], indent=1, ensure_ascii=False)[:1800])
print('=== xrefs samples ===')
print(json.dumps(head('xrefs-IDX.jsonl')[0], indent=1, ensure_ascii=False))
print(json.dumps(head('xrefs-K.jsonl')[0], indent=1, ensure_ascii=False))
print('=== pages.map ===')
pm = json.load(open(vd / 'pages.map.json', encoding='utf-8'))
print('type:', type(pm).__name__, 'len:', len(pm))
if isinstance(pm, dict):
    print('first keys:', list(pm)[:4])
    k0 = list(pm)[0]
    print(k0, '->', json.dumps(pm[k0], ensure_ascii=False)[:400])
else:
    print(json.dumps(pm[:2], ensure_ascii=False, indent=1))
print('=== structure.json ===')
st = json.load(open(vd / 'structure.json', encoding='utf-8'))
print('type:', type(st).__name__, 'keys:', list(st)[:10] if isinstance(st, dict) else len(st))
if isinstance(st, dict):
    for k in list(st)[:6]:
        print(k, ':', json.dumps(st[k], ensure_ascii=False)[:200])
print('=== meds sample keys ===')
m = head('meds-A.jsonl')[0]
print(sorted(m.keys()))
print('=== review-queue sample ===')
rq = json.load(open(vd / 'review-queue.json', encoding='utf-8'))
print('type:', type(rq).__name__)
if isinstance(rq, dict):
    print('keys:', list(rq))
    first = list(rq.values())[0] if not isinstance(next(iter(rq.values()), None), str) else None
    print(json.dumps(rq, ensure_ascii=False)[:600])
elif isinstance(rq, list):
    print('len:', len(rq), json.dumps(rq[0], ensure_ascii=False)[:400])
