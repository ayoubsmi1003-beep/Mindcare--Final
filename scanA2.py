import json, io
p = open(r'C:\Users\ABC Informatique\AppData\Local\Temp\stahlA.txt', encoding='utf-8').read()
nonascii = sorted(set(c for c in p if ord(c) > 127))
with io.open('scanA2.txt', 'w', encoding='utf-8') as f:
    f.write('U+FFFD count: %d\n' % p.count('\ufffd'))
    f.write('non-ascii: %s\n' % [(c, 'U+%04X' % ord(c)) for c in nonascii])
    d = 'knowledge/canonical-v2/stahl-prescribers-guide-7e-cup/sha256-cf23ef7b70e7c6e099a5a43d994adb2f34ef06718643932611f5e91eeba180e3'
    m = json.load(open(d + '/pages.map.json', encoding='utf-8'))
    f.write('map type: %s\n' % type(m).__name__)
    if isinstance(m, dict):
        ks = list(m.keys())[:10]
        f.write('map keys: %s\n' % ks)
        for k in ks[:3]:
            f.write('map %r = %s\n' % (k, json.dumps(m[k], ensure_ascii=True)[:300]))
    elif isinstance(m, list) and m:
        f.write('map0 = %s\n' % json.dumps(m[0], ensure_ascii=True)[:500])
print('done')
