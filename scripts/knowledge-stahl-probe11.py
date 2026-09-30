# -*- coding: utf-8 -*-
"""Probe 11: new IDX title sanity vs old list (old list hardcoded from probe9)."""
import json, sys, io, re
from pathlib import Path
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8")
VD = (Path(__file__).resolve().parent.parent / "knowledge" / "canonical-v2" /
      "stahl-prescribers-guide-7e-cup" /
      "sha256-cf23ef7b70e7c6e099a5a43d994adb2f34ef06718643932611f5e91eeba180e3")
idx = [json.loads(l) for l in
       (VD / "units-IDX.jsonl").read_text(encoding="utf-8").splitlines()
       if l.strip()]
uses = [u["title"] for u in idx
        if u["structural_path"][1] == "Index by Use"]
kls = [u["title"] for u in idx
       if u["structural_path"][1] == "Index by Class"]
print("uses:", len(uses), "classes:", len(kls),
      "abbr:", sum(1 for u in idx if u["structural_path"][1] == "Abbreviations"))
junk = re.compile(r"\(\s*d\s*,|\(adjunct\)|combination\s*,|\d{3}", re.I)
print("== suspicious NEW titles ==")
for t in uses + kls:
    if junk.search(t.replace("Index by Use - ", "")
                   .replace("Index by Class - ", "")):
        print("  ", repr(t))
print("== NEW use titles not in old list? (ADHD etc.) ==")
old_u = {"Aggression", "Alcohol abstinence", "Alcohol dependence, 255",
         "Alcohol withdrawal", "Alzheimer disease", "Amnesia, Drug-induced",
         "Anxiety", "Autism-related irritability", "Behavioral problems",
         "Benzodiazepine reversal", "Benzodiazepine withdrawal",
         "Bipolar depression", "Bipolar disorder", "Bipolar maintenance",
         "Bulimia nervosa/binge eating", "Cataplexy syndrome", "Catatonia",
         "Chorea, Huntington’s disease", "Delirium", "Dementia",
         "Dementia-related psychosis", "Depression",
         "Drug-induced parkinsonism", "Erectile dysfunction",
         "Excessive sleepiness", "Fatigue", "Fibromyalgia",
         "Generalized anxiety disorder", "Glossopharyngeal neuralgia",
         "Hiccups, intractable", "Hypersalivation", "Hypertension",
         "Hypoactive sexual desire disorder", "Insomnia", "Mania",
         "Migraine", "Muscle spasm", "Nausea/vomiting",
         "Neuropathic pain/chronic pain", "Nicotine addiction",
         "Non-24-hour sleep-wake disorder", "Obsessive-compulsive disorder",
         "Opioid dependence", "Panic disorder", "Parkinson’s disease",
         "Parkinson’s disease dementia", "Parkinson’s disease psychosis",
         "Pervasive developmental disorders", "Porphyria",
         "Postherpetic neuralgia", "Postpartum depression",
         "Posttraumatic stress disorder", "Premenstrual dysphoric disorder",
         "Preoperative anxiety", "Pruritus", "Pseudobulbar affect",
         "Psychosis", "Schizoaffective disorder", "Schizophrenia",
         "Seasonal affective disorder", "Sedation-induction",
         "Seizure disorders", "Sexual dysfunction", "Sleepiness, excessive",
         "Social anxiety disorder", "Stress urinary incontinence",
         "Tardive dyskinesia", "Tetanus", "Tourette’s syndrome/tic disorders",
         "Tremor", "Trigeminal neuralgia", "Vasomotor symptoms"}
old_c = {"Anticholinergics", "Anticonvulsants", "Antidepressants",
         "Antipsychotics", "Anxiolytics", "Benzodiazepine antagonist",
         "Dementia treatments", "Libido enhancers", "Medical food",
         "Mood stabilizers", "Movement disorder treatments",
         "NMDA antagonists", "Neuroactive steroid",
         "Neuropathic/chronic pain treatments",
         "Phosphodiesterase-5 (PDE-5) inhibitor", "Sedative hypnotics",
         "Substance use disorder treatments", "Tic suppressants"}
nu = [t.replace("Index by Use - ", "") for t in uses]
nc = [t.replace("Index by Class - ", "") for t in kls]
print("  extra uses:", sorted(set(nu) - old_u))
print("  missing uses:", sorted(old_u - set(nu)))
print("  extra classes:", sorted(set(nc) - old_c))
print("  missing classes:", sorted(old_c - set(nc)))
print("\n== isomer/adjunct evidence check ==")
for u in idx:
    if re.search(r"\(d,l\)|\(d\)|\(L\)|l-methylfolate", u["title"]):
        print("  title:", u["title"])
# show ADHD use evidence head
for u in idx:
    if "Attention deficit" in u["title"]:
        print("  ", u["title"], "->", u["evidence_wording"][:220])
# dup entry sanity within one use
for u in idx:
    if u["title"].endswith("Depression"):
        entries = u["evidence_wording"].split(": ", 1)[1].split("; ")
        dups = [e for e in set(entries) if entries.count(e) > 1]
        print("  Depression entries:", len(entries), "dups:", dups[:5])
