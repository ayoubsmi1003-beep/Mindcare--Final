"""Pre-M08 build: provenance map, risk classification, evidence status, table safety,
xref status, critical review queue for the Stahl 7 canonical corpus.

Deterministic (no timestamps, sorted inputs, fixed key order). Read-only on the
canonical directory; writes only to knowledge/pre-m08/.
Usage: python scripts/knowledge-prem08-build.py
"""
import hashlib
import json
import pathlib
import re
import sys

sys.stdout.reconfigure(encoding='utf-8', errors='replace')

VD = pathlib.Path('knowledge/canonical-v2/stahl-prescribers-guide-7e-cup/'
                  'sha256-cf23ef7b70e7c6e099a5a43d994adb2f34ef06718643932611f5e91eeba180e3')
OUT = pathlib.Path('knowledge/pre-m08')
OUT.mkdir(parents=True, exist_ok=True)

BOOK = json.loads((VD / 'book.json').read_text(encoding='utf-8'))
STRUCTURE = json.loads((VD / 'structure.json').read_text(encoding='utf-8'))
SOURCE_HASH = BOOK['local_sha256'].lower()
CANONICAL_SV = BOOK['source_version']                      # sha256:<hash> (colon form)
PAGE_MAP = json.loads((VD / 'pages.map.json').read_text(encoding='utf-8'))
SHORT_MIN = 40
MOJI_RE = re.compile('Î[±¼´¹²³°µ–…]|Î[±¼´¹²³°µ]')
CAPTION_RE = re.compile(r'\bTable \d+\.')
JOIN_RE = re.compile(r'(?<=[a-z]{3})(?=[A-Z][a-z])')
PAGE_MIN, PAGE_MAX = 13, 2682


def load_jsonl(path):
    rows = []
    with open(path, encoding='utf-8') as f:
        for line in f:
            if line.strip():
                rows.append(json.loads(line))
    return rows


def sha(text):
    return hashlib.sha256(text.encode('utf-8')).hexdigest()


def jdump(obj):
    return json.dumps(obj, ensure_ascii=False)


def write_jsonl(name, rows):
    p = OUT / name
    with open(p, 'w', encoding='utf-8', newline='\n') as f:
        for r in rows:
            f.write(jdump(r) + '\n')
    return len(rows)


# ---- inputs (sorted for determinism) ----
units = []
for p in sorted(VD.glob('units-*.jsonl')):
    units.extend(load_jsonl(p))
units.sort(key=lambda u: u['id'])
xrefs = load_jsonl(VD / 'xrefs.jsonl')
xrefs.sort(key=lambda r: (r['from_unit'], r['target_text']))
meds = load_jsonl(VD / 'meds.jsonl')
meds.sort(key=lambda m: m['med_id'])
queue0 = json.loads((VD / 'review-queue.json').read_text(encoding='utf-8'))
QUEUE_IDS = {q['id'] for q in queue0 if q['kind'] == 'unit'}

assert len(units) == 2662, f'units {len(units)}'
content = [u for u in units if u['content_type'] != 'index-entry']
idx = [u for u in units if u['content_type'] == 'index-entry']
assert len(content) == 2563 and len(idx) == 99, (len(content), len(idx))

MED_BY_NAME = {m['drug_name']: m['med_id'] for m in meds}
SECTIONS = {s['title']: s for s in STRUCTURE['sections']}
DRUG_SECTIONS = {s['title']: s for s in STRUCTURE['sections'] if s.get('depth') == 1}
FRONT_SEC = next(s for s in STRUCTURE['sections'] if s.get('depth') == 0)
BACK_SEC = next(s for s in STRUCTURE['sections'] if 'ack matter' in s.get('title', '')
                or s.get('section_id') == 'back-matter')

# ---- section_type normalization (metadata layer only; raw L2 kept in rows) ----
L2_TYPE = {
    'therapeutics': 'therapeutics', 'dosing and use': 'dosing-and-use',
    'side effects': 'side-effects', 'special populations': 'special-populations',
    'specia populations': 'special-populations',   # source typo kept raw; type normalized
    'the art of psychopharmacology': 'art-of-psychopharmacology',
    'the art of switching': 'switching', 'suggested reading': 'suggested-reading',
    'introduction': 'front-matter', 'back matter': 'back-matter',
}


def section_type(path):
    if path and path[0] == 'Back matter':
        return 'back-matter'
    if len(path) >= 2:
        return L2_TYPE.get(path[1].strip().lower(), 'unmapped')
    return 'unmapped'


# ---- Phase B: deterministic risk classification (metadata only) ----
DESC_L3 = {'generic?', 'brands', 'brand names'}
CRIT_L3_1 = {'other warnings/precautions', 'do not use'}
CRIT_L3_2 = {'life-threatening or dangerous side effects'}
CRIT_L3_3 = {'overdose'}
CRIT_L3_4 = {'children and adolescents', 'elderly', 'renal impairment', 'hepatic impairment'}
HIGH_L3 = {'how to stop', 'how long until it works', 'long-term use', 'tests',
           'what to do about side effects', 'monitoring after starting an atypical antipsychotic',
           'monitoring after starting any atypical antipsychotic'}

CRIT_RULES = [
    ('R-C1', lambda u, l2, l3: u['semantic_domain'] == 'dosing'),
    ('R-C2', lambda u, l2, l3: u['semantic_domain'] == 'interaction' or l3 == 'drug interactions'),
    ('R-C3', lambda u, l2, l3: u['semantic_domain'] == 'pregnancy-lactation'
     or l3 in {'pregnancy', 'breast feeding'}),
    ('R-C4', lambda u, l2, l3: u['semantic_domain'] == 'precaution' or l3 in CRIT_L3_1),
    ('R-C5', lambda u, l2, l3: l3 in CRIT_L3_2),
    ('R-C6', lambda u, l2, l3: l3 in CRIT_L3_3),
    ('R-C7', lambda u, l2, l3: l3 in CRIT_L3_4),
]
HIGH_RULES = [
    ('R-H1', lambda u, l2, l3: u['semantic_domain'] == 'therapeutics' and l3 not in DESC_L3),
    ('R-H2', lambda u, l2, l3: u['semantic_domain'] in
     {'adverse-effect', 'switching', 'pharmacokinetics', 'art-of-psychopharmacology'}),
    ('R-H3', lambda u, l2, l3: l3 in HIGH_L3),
]


def classify_risk(unit):
    if unit['content_type'] == 'index-entry':
        return 'NORMAL', 'R-N0', ['R-N0']
    path = unit['structural_path']
    l2 = path[1].strip().lower() if len(path) >= 2 else ''
    l3 = path[2].strip().lower() if len(path) >= 3 else ''
    matched = [rid for rid, fn in CRIT_RULES if fn(unit, l2, l3)]
    if matched:
        return 'CRITICAL', matched[0], matched
    matched = [rid for rid, fn in HIGH_RULES if fn(unit, l2, l3)]
    if matched:
        return 'HIGH', matched[0], matched
    return 'NORMAL', 'R-N1', ['R-N1']


KNOWLEDGE_TYPE = {
    'dosing': 'dose', 'interaction': 'drug_interaction',
    'pregnancy-lactation': 'pregnancy_lactation', 'precaution': 'precaution',
    'adverse-effect': 'adverse_effect', 'therapeutics': 'therapeutic_fact',
    'switching': 'switching', 'pharmacokinetics': 'pharmacokinetics',
    'art-of-psychopharmacology': 'clinical_guidance', 'reference': 'index_reference',
}


# ---- Phase C: evidence checks ----
def title_path_ok(unit):
    t, p = unit['title'], unit['structural_path']
    if unit['content_type'] == 'index-entry':
        return t == ' - '.join(p[1:]) if len(p) >= 3 else False
    return t == f'{p[0]} - {p[-1]}' if len(p) >= 2 else False


def structure_contains(unit):
    path = unit['structural_path']
    if path[0] == 'Back matter':
        sec = BACK_SEC
    elif path[0] in DRUG_SECTIONS:
        sec = DRUG_SECTIONS[path[0]]
    else:
        sec = next((s for s in STRUCTURE['sections']
                    if s['source_page_start'] <= unit['page_start'] <= s['source_page_end']), None)
    if sec is None:
        return True
    return sec['source_page_start'] <= unit['page_start'] and \
        unit['page_end'] <= sec['source_page_end']


def evidence_checks(unit, risk):
    ev = unit['evidence_wording'] or ''
    defects = []
    pages_ok = (PAGE_MIN <= unit['page_start'] <= unit['page_end'] <= PAGE_MAX
                and str(unit['page_start']) == unit['printed_page_start']
                and str(unit['page_end']) == unit['printed_page_end']
                and unit['page_mapping_status'] == 'certain')
    if not ev.strip():
        defects.append({'code': 'E-MISSING', 'detail': 'empty evidence_wording'})
    if risk in ('CRITICAL', 'HIGH') and len(ev) < SHORT_MIN:
        defects.append({'code': 'E-SHORT',
                        'detail': f'evidence {len(ev)} chars < {SHORT_MIN} (cannot support claim alone)'})
    if not pages_ok:
        defects.append({'code': 'E-PAGE-INVALID',
                        'detail': 'page fields inconsistent with identity map or outside 13..2682'})
    if not title_path_ok(unit):
        defects.append({'code': 'E-HEADING-MISMATCH', 'detail': 'title does not match structural path'})
    if not structure_contains(unit):
        defects.append({'code': 'E-HEADING-MISMATCH',
                        'detail': 'unit pages outside its structure.json section span'})
    moji = MOJI_RE.findall(ev)
    if moji:
        defects.append({'code': 'E-CHARSET-MOJIBAKE',
                        'detail': f'{len(moji)} cp1252-mojibake token(s) '
                                  f'{sorted(set(moji))[:4]} (Greek/micro letters double-encoded)'})
    caption = bool(CAPTION_RE.search(ev))
    lines = [l for l in ev.split('\n') if l.strip()]
    singles = sum(1 for l in lines if len(l.split()) <= 1)
    ratio = round(singles / len(lines), 3) if lines else 0.0
    joins = len(JOIN_RE.findall(ev))
    if caption and (joins >= 1 or (ratio >= 0.20 and len(lines) >= 8)):
        defects.append({'code': 'E-TABLE-FRAGMENT',
                        'detail': f'caption table flattened: boundary_joins={joins}, '
                                  f'single_word_line_ratio={ratio} over {len(lines)} lines'})
    if not caption and joins >= 2:
        defects.append({'code': 'E-FRAGMENT-SUSPECT',
                        'detail': f'{joins} intra-word capital joins '
                                  '(possible cross-cell concatenation)'})
    hard = {'E-MISSING', 'E-PAGE-INVALID', 'E-HEADING-MISMATCH',
            'E-CHARSET-MOJIBAKE', 'E-TABLE-FRAGMENT'}
    if any(d['code'] in hard for d in defects):
        status = 'QUARANTINED'
    elif defects:
        status = 'EVIDENCE_CONFLICT'
    else:
        status = 'VERIFIED'
    signals = {'caption': caption, 'lines': len(lines),
               'single_word_ratio': ratio, 'boundary_joins': joins}
    return status, defects, signals


# ---- Phase D: table safety ----
def table_status(unit, sig):
    if not sig['caption'] and unit['semantic_domain'] != 'dosing':
        return 'NOT_APPLICABLE', ['not a dose-bearing or caption-bearing unit']
    if sig['caption']:
        if sig['boundary_joins'] >= 1 or (sig['single_word_ratio'] >= 0.20 and sig['lines'] >= 8):
            return 'TABLE_UNSAFE_FOR_RETRIEVAL', [
                'multi-column caption table flattened to lines; cell-boundary loss signals present',
                f"boundary_joins={sig['boundary_joins']}, "
                f"single_word_line_ratio={sig['single_word_ratio']}, lines={sig['lines']}",
                'geometry not persisted: TABLE_RECONSTRUCTED_FROM_GEOMETRY not producible']
        return 'TABLE_PARTIAL', ['caption table flattened to lines; column relationships not provable']
    if sig['boundary_joins'] >= 2:
        return 'TABLE_PARTIAL', [f"boundary_joins={sig['boundary_joins']} "
                                 '(possible cross-cell concatenation in dose line-list)']
    return 'TABLE_INTACT', ['single-column line list; line order preserved, no boundary-loss signal']


# ---- main pass over units ----
FOLIO_RE = re.compile(r',\s*(\d{1,4})(?=\s*[:]|$)')
MAP_METHOD = ('identity-offset-0 (pages.map.json rule printed = source_page_index; '
              'verified_anchors; QA dual-page-consistency PASS)')
DRUG_CF = {t.casefold(): t for t in DRUG_SECTIONS}

provenance_rows, risk_rows, evidence_rows, table_rows = [], [], [], []
unit_meta = {}

for u in units:
    ev = u['evidence_wording'] or ''
    risk, rule, matched = classify_risk(u)
    status, defects, sig = evidence_checks(u, risk)
    tstat, treasons = table_status(u, sig)
    pages_ok = (PAGE_MIN <= u['page_start'] <= u['page_end'] <= PAGE_MAX
                and str(u['page_start']) == u['printed_page_start']
                and str(u['page_end']) == u['printed_page_end']
                and u['page_mapping_status'] == 'certain')

    # embedded folio references (back-matter index entries only)
    folios = []
    if u['content_type'] == 'index-entry':
        for m in FOLIO_RE.finditer((u['title'] + '\n' + ev)):
            folio = int(m.group(1))
            owner = next((t for t, s in DRUG_SECTIONS.items()
                          if s['source_page_start'] <= folio <= s['source_page_end']), None)
            tail = ev.split(':', 1)[1] if ':' in ev else ''
            targets = [DRUG_CF.get(x.strip().casefold())
                       for x in re.split(r'[;,]', tail) if x.strip()]
            targets = [t for t in targets if t]
            if not targets:
                ref_status = 'UNRESOLVED'
                reason = ('folio-like number with no parseable drug target; '
                          'no printed-folio map exists in the source')
            elif owner in targets:
                ref_status = 'CONFIRMED'
                reason = f'identity page {folio} lies inside target section {owner}'
            else:
                ref_status = 'CONFLICT'
                reason = (f'identity interpretation maps page {folio} to section '
                          f'{owner or "front/back-matter"}, not to indexed target(s) '
                          f'{targets}; printed-folio interpretation unverifiable '
                          '(source carries no folio labels) - open human decision')
            folios.append({'folio_ref': folio, 'text': m.group(0).strip(),
                           'mapping_status': ref_status,
                           'mapping_method': 'identity-map vs index-internal pointer; no folio map',
                           'reason': reason})

    provenance_rows.append({
        'unit_id': u['id'], 'book_id': u['book_id'], 'source_id': BOOK['source_identifier'],
        'edition': BOOK['edition'], 'ingestion_version': u['ingestion_version'],
        'source_version_canonical': CANONICAL_SV,
        'source_version_as_recorded': u['source_version'],
        'source_version_format': 'colon' if ':' in u['source_version'] else 'dash',
        'source_hash': SOURCE_HASH,
        'printed_page': {'start': u['printed_page_start'], 'end': u['printed_page_end']},
        'pdf_page': {'start': u['page_start'], 'end': u['page_end']},
        'page_label': None,
        'mapping_status': 'CONFIRMED' if pages_ok else 'CONFLICT',
        'mapping_method': MAP_METHOD,
        'unit_page_mapping_status': u['page_mapping_status'],
        'evidence_sha256': sha(ev), 'evidence_chars': len(ev),
        'embedded_folio_refs': folios,
    })

    monograph = u['structural_path'][0]
    risk_rows.append({
        'unit_id': u['id'], 'clinical_risk': risk, 'risk_rule': rule,
        'risk_rules_matched': matched,
        'knowledge_type': KNOWLEDGE_TYPE.get(u['semantic_domain'], 'unclassified'),
        'semantic_domain': u['semantic_domain'],
        'monograph': monograph if u['content_type'] != 'index-entry' else None,
        'section_path': u['structural_path'],
        'section_type': section_type(u['structural_path']),
        'section_l2_raw': (u['structural_path'][1]
                           if u['content_type'] != 'index-entry' and len(u['structural_path']) > 1
                           else None),
        'medication_id': MED_BY_NAME.get(monograph),
        'population': u['population'], 'age_group': u['age_group'],
        'language': u['language'], 'metadata_only': True,
        'retrieval_eligibility': None,   # set after eligibility computed below
    })

    if risk in ('CRITICAL', 'HIGH'):
        evidence_rows.append({
            'unit_id': u['id'], 'book_id': u['book_id'], 'source_id': BOOK['source_identifier'],
            'edition': BOOK['edition'], 'source_version_canonical': CANONICAL_SV,
            'monograph': monograph if u['content_type'] != 'index-entry' else None,
            'section_path': u['structural_path'],
            'section_type': section_type(u['structural_path']),
            'clinical_risk': risk,
            'printed_page': {'start': u['printed_page_start'], 'end': u['printed_page_end']},
            'pdf_page': {'start': u['page_start'], 'end': u['page_end']},
            'evidence': {'sha256': sha(ev), 'chars': len(ev), 'lines': sig['lines'],
                         'segment': u['provenance'].get('segment')},
            'evidence_status': status, 'defects': defects,
            'extraction_status': u['extraction_status'],
            'review_status': u['validation_status'], 'confidence': u['confidence'],
        })

    if tstat != 'NOT_APPLICABLE':
        table_rows.append({
            'unit_id': u['id'], 'clinical_risk': risk,
            'scope': 'caption-table' if sig['caption'] else 'dose-line-list',
            'monograph': monograph if u['content_type'] != 'index-entry' else None,
            'section_path': u['structural_path'],
            'pdf_page': {'start': u['page_start'], 'end': u['page_end']},
            'table_status': tstat, 'reasons': treasons, 'signals': sig,
            'evidence_status': status,
        })

    if status != 'VERIFIED':
        elig = 'BLOCKED_EVIDENCE'
    elif tstat in ('TABLE_PARTIAL', 'TABLE_UNSAFE_FOR_RETRIEVAL'):
        elig = 'BLOCKED_TABLE'
    elif u['id'] in QUEUE_IDS:
        elig = 'PENDING_CLINICAL_REVIEW'
    else:
        elig = 'STRUCTURALLY_ELIGIBLE_PENDING_SOURCE_ACTIVATION'
    unit_meta[u['id']] = {'risk': risk, 'status': status, 'defects': defects,
                          'table': tstat, 'eligibility': elig, 'unit': u}

# fill retrieval_eligibility into risk rows (fixed order preserved: value replaced in place)
for row in risk_rows:
    row['retrieval_eligibility'] = unit_meta[row['unit_id']]['eligibility']

# ---- Phase E: xref status ----
TARGET_L3 = {
    'see warnings below': 'other warnings/precautions',
    'see how to': 'how to dose',
    'see children and': 'children and adolescents',
}
xref_rows = []
xref_tally = {}
for r in xrefs:
    assert not r['target_unit'] or str(r['target_unit']).startswith('stahl7-'), r
    from_u = unit_meta.get(r['from_unit'], {}).get('unit')
    assert from_u is not None, f"dangling from_unit {r['from_unit']}"
    if r['status'] == 'resolved':
        xstat, reason = 'RESOLVED', ('unique intra-book target established by deterministic '
                                     'resolver; pointer phrase verified in referring evidence')
    else:
        tt = (r['target_text'] or '').lower()
        path = from_u['structural_path']
        mono = path[0]
        l3 = path[2].strip().lower() if len(path) >= 3 else ''
        if tt == 'see table':
            if CAPTION_RE.search(from_u['evidence_wording']):
                xstat = 'TABLE_CAPTION_WITHIN_UNIT'
                reason = 'Table caption/content sits inside the referring unit\'s own evidence; self-link refused'
            else:
                xstat, reason = 'UNRESOLVED', 'no table caption found in referring unit evidence'
        elif tt in TARGET_L3:
            target_l3 = TARGET_L3[tt]
            siblings = {p[2].strip().lower() for p in
                        (x['structural_path'] for x in content) if p[0] == mono and len(p) > 2}
            if l3 == target_l3:
                xstat = 'POINTER_WITHIN_UNIT'
                reason = f'pointer names its own section ({target_l3}); target text is in the same unit; self-link refused'
            elif target_l3 not in siblings:
                xstat = 'TARGET_NOT_ATOMIZED'
                reason = f'no unit for target section "{target_l3}" exists in monograph {mono}; not establishable without source re-read - NOT guessed'
            else:
                xstat = 'UNRESOLVED'
                reason = 'target section exists in monograph but link not established by resolver'
        else:
            xstat, reason = 'UNRESOLVED', 'unrecognized pointer text; no unique target provable'
    xref_tally[xstat] = xref_tally.get(xstat, 0) + 1
    xref_rows.append({'from_unit': r['from_unit'], 'target_text': r['target_text'],
                      'target_unit': r['target_unit'], 'resolution_status': r['status'],
                      'xref_status': xstat, 'reason': reason, 'cross_book': False})

assert len(xrefs) == 1073, len(xrefs)
assert xref_tally == {'RESOLVED': 1049, 'POINTER_WITHIN_UNIT': 12,
                      'TABLE_CAPTION_WITHIN_UNIT': 7, 'TARGET_NOT_ATOMIZED': 5}, xref_tally

# ---- critical review queue (deterministic priorities) ----
QUEUE_CATEGORY = {
    'dosing': 'unit/dose-therapeutic', 'precaution': 'unit/precaution-safety',
    'pregnancy-lactation': 'unit/pregnancy-lactation', 'interaction': 'unit/drug-interaction',
}
KIND_ORDER = {'unit': 0, 'med': 1, 'xref': 2}
queue_rows = []

for u in units:
    m = unit_meta[u['id']]
    cat = QUEUE_CATEGORY.get(u['semantic_domain'])
    reasons, priority = [], None
    if m['status'] != 'VERIFIED':
        priority = 1
        reasons += [f"{d['code']}: {d['detail']}" for d in m['defects']]
        if m['table'] in ('TABLE_PARTIAL', 'TABLE_UNSAFE_FOR_RETRIEVAL'):
            reasons.append(f"table_status: {m['table']}")
    elif u['id'] in QUEUE_IDS:
        priority = 2
        reasons.append('canonical review queue: validation_status=needs_review')
    elif m['risk'] == 'CRITICAL':
        priority = 3
        reasons.append('CRITICAL clinical risk, auto-validated: clinical sign-off required before M08')
    if priority is None:
        continue
    if cat:
        reasons.append(f'canonical category: {cat}')
    queue_rows.append({
        'kind': 'unit', 'priority': priority, 'id': u['id'],
        'clinical_risk': m['risk'], 'categories': [cat] if cat else [],
        'reasons': reasons,
        'pdf_pages': [u['page_start'], u['page_end']],
        'printed_pages': [u['printed_page_start'], u['printed_page_end']],
        'review_status': u['validation_status'],
        'evidence_status': m['status'], 'table_status': m['table'],
    })

for med in meds:
    queue_rows.append({
        'kind': 'med', 'priority': 2, 'id': med['med_id'],
        'clinical_risk': 'CRITICAL', 'categories': ['med/dose-bearing'],
        'reasons': ['dose-bearing monograph fields (usual_dosage_range/how_to_dose/'
                    'warnings_precautions/pregnancy/drug_interactions/overdose) '
                    'require clinician verification'],
        'pdf_pages': [med['page_start'], med['page_end']],
        'printed_pages': [med['printed_page_start'], med['printed_page_end']],
        'review_status': med['validation_status'],
        'evidence_status': None, 'table_status': None,
    })

for x in xref_rows:
    if x['xref_status'] == 'RESOLVED':
        continue
    u = unit_meta[x['from_unit']]['unit']
    queue_rows.append({
        'kind': 'xref', 'priority': 3, 'id': f"{x['from_unit']}::{x['target_text']}",
        'clinical_risk': unit_meta[x['from_unit']]['risk'], 'categories': [],
        'reasons': [f"{x['xref_status']}: {x['reason']}"],
        'pdf_pages': [u['page_start'], u['page_end']],
        'printed_pages': [u['printed_page_start'], u['printed_page_end']],
        'review_status': 'unresolved-by-design',
        'evidence_status': None, 'table_status': None,
    })

queue_rows.sort(key=lambda r: (r['priority'], KIND_ORDER[r['kind']], r['id']))

# ---- write artifacts ----
n_prov = write_jsonl('STHAL7-PROVENANCE-MAP.jsonl', provenance_rows)
n_risk = write_jsonl('STHAL7-RISK-CLASSIFICATION.jsonl', risk_rows)
n_evid = write_jsonl('STHAL7-EVIDENCE-STATUS.jsonl', evidence_rows)
n_tab = write_jsonl('STHAL7-TABLE-SAFETY.jsonl', table_rows)
n_xref = write_jsonl('STHAL7-XREF-STATUS.jsonl', xref_rows)
n_queue = write_jsonl('STHAL7-CRITICAL-REVIEW-QUEUE.jsonl', queue_rows)

# ---- invariants ----
assert n_prov == 2662 and n_risk == 2662, (n_prov, n_risk)
assert {r['mapping_status'] for r in provenance_rows} == {'CONFIRMED'}
folio_refs = [f for r in provenance_rows for f in r['embedded_folio_refs']]
assert len(folio_refs) == 1 and folio_refs[0]['mapping_status'] == 'CONFLICT', folio_refs
assert len(QUEUE_IDS) == 948, len(QUEUE_IDS)
n_ch = sum(1 for m in unit_meta.values() if m['risk'] in ('CRITICAL', 'HIGH'))
assert n_evid == n_ch, (n_evid, n_ch)
assert len(meds) == 152
p2_units = sum(1 for r in queue_rows if r['kind'] == 'unit' and r['priority'] == 2)
assert p2_units <= 948

# ---- summary ----
import collections as C
print(f'written to {OUT}:')
print(f'  STHAL7-PROVENANCE-MAP.jsonl        rows={n_prov}')
print(f'  STHAL7-RISK-CLASSIFICATION.jsonl   rows={n_risk}')
print(f'  STHAL7-EVIDENCE-STATUS.jsonl       rows={n_evid} (CRITICAL+HIGH)')
print(f'  STHAL7-TABLE-SAFETY.jsonl          rows={n_tab}')
print(f'  STHAL7-XREF-STATUS.jsonl           rows={n_xref}')
print(f'  STHAL7-CRITICAL-REVIEW-QUEUE.jsonl rows={n_queue}')
print('risk:', dict(C.Counter(r['clinical_risk'] for r in risk_rows)))
print('eligibility:', dict(C.Counter(r['retrieval_eligibility'] for r in risk_rows)))
print('evidence:', dict(C.Counter(r['evidence_status'] for r in evidence_rows)))
print('defects:', dict(C.Counter(d['code'] for r in evidence_rows for d in r['defects'])))
print('tables:', dict(C.Counter(r['table_status'] for r in table_rows)))
print('xrefs:', xref_tally)
print('queue by priority:', dict(C.Counter(r['priority'] for r in queue_rows)))
print('queue by kind:', dict(C.Counter(r['kind'] for r in queue_rows)))
print('folio refs:', [(f['folio_ref'], f['mapping_status']) for f in folio_refs])
print('OK')






