import json, pathlib
v = pathlib.Path('knowledge/canonical-v2/stahl-prescribers-guide-7e-cup/sha256-cf23ef7b70e7c6e099a5a43d994adb2f34ef06718643932611f5e91eeba180e3')
p = pathlib.Path('knowledge/pre-m08')
L = lambda n,b=v: [json.loads(x) for x in (b/n).read_text(encoding='utf-8').splitlines() if x]
units=[]
for f in sorted(v.glob('units-*.jsonl')):
    units.extend(L(f.name))
units.sort(key=lambda x:x['id'])
meds=L('meds.jsonl')
concepts=L('concepts.jsonl')
risk={r['unit_id']:r for r in L('STHAL7-RISK-CLASSIFICATION.jsonl',p)}
ev={r['unit_id']:r for r in L('STHAL7-EVIDENCE-STATUS.jsonl',p)}
tab={r['unit_id']:r for r in L('STHAL7-TABLE-SAFETY.jsonl',p)}
xr=L('STHAL7-XREF-STATUS.jsonl',p)
eligible_statuses={'STRUCTURALLY_ELIGIBLE_PENDING_SOURCE_ACTIVATION','PENDING_CLINICIAN_REVIEW'}
def safe(u):
    return (risk[u['id']]['retrieval_eligibility'] in eligible_statuses
            and ev.get(u['id'],{}).get('evidence_status')=='VERIFIED'
            and tab.get(u['id'],{}).get('table_status') in {None,'NOT_APPLICABLE','TABLE_INTACT'})
def cands(pred,label,n=4):
    out=[u['id'] for u in units if pred(u) and safe(u)]
    print(label, len(out), out[:n])
cands(lambda u:u['subject']=='Acamprosate' and u['semantic_domain']=='therapeutics','ther')
cands(lambda u:u['semantic_domain']=='dosing','dose')
cands(lambda u:u['semantic_domain']=='dosing' and u['subject']=='Acamprosate','dose_acam')
cands(lambda u:'maximum' in (u['title']+' '+' '.join(u['structural_path'])+' '+u['evidence_wording']).lower(),'maximum')
cands(lambda u:u['subject']=='Acamprosate' and 'titration' in u['evidence_wording'].lower(),'titration')
cands(lambda u:u['subject']=='Acamprosate' and u.get('predicate')=='indicated_for','indication')
cands(lambda u:'do not use' in ' '.join(u['structural_path']).lower(),'contraindication')
cands(lambda u:u['semantic_domain'] in {'precaution','adverse-effect'},'precaution')
cands(lambda u:u['subject']=='Alprazolam' and u['semantic_domain']=='interaction','interaction_alp')
cands(lambda u:u['semantic_domain']=='interaction','interaction_any')
cands(lambda u:u['semantic_domain']=='pregnancy-lactation' and 'pregnan' in ' '.join(u['structural_path']).lower(),'pregnancy')
cands(lambda u:u['semantic_domain']=='pregnancy-lactation' and any(x in ' '.join(u['structural_path']).lower() for x in ('breast','lactat')),'lactation')
cands(lambda u:any(x in ' '.join(u['structural_path']).lower() for x in ('children','adolescents')),'children')
cands(lambda u:u['subject']=='Acamprosate' and any(x in ' '.join(u['structural_path']).lower() for x in ('children','adolescents')),'children_acam')
resolved=[(r['from_unit'],r['target_unit']) for r in xr if r['xref_status']=='RESOLVED']
print('resolved xref sample', resolved[:5])
unit_by_id={u['id']:u for u in units}
print('resolved both safe count', sum(1 for a,b in resolved if a in unit_by_id and b in unit_by_id and safe(unit_by_id[a]) and safe(unit_by_id[b])))
brand=[u['id'] for u in units if 'brand' in (u['title']+' '.join(u['structural_path'])).lower() and safe(u)]
print('brand units', len(brand), brand[:5])
print('med sample', meds[0])
print('concept sample', concepts[0])
print('concept keys', sorted(concepts[0]))
print('med keys', sorted(meds[0]))
table_safe=[r['unit_id'] for r in tab.values() if r['table_status']=='TABLE_INTACT' and risk.get(r['unit_id'],{}).get('retrieval_eligibility')=='STRUCTURALLY_ELIGIBLE_PENDING_SOURCE_ACTIVATION' and ev.get(r['unit_id'],{}).get('evidence_status')=='VERIFIED']
print('table safe', len(table_safe), table_safe[:5])
print('eligible count', sum(safe(u) for u in units))
