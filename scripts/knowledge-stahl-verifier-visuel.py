#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Stahl 7e — verification visuelle independante (pages rendues).

Usage:
    python scripts/knowledge-stahl-verifier-visuel.py

Ecrit :
  docs/reports/2026-10-20-stahl-verification-visuelle.json  (preuve, suivie)
  artifacts/stahl-verification/pNNNN.png                       (rendus, hors Git)

Pourquoi : une extraction ne se certifie pas elle-meme. Les pages sont
RENDUES puis lues a l'oeil, et comparees a ce que la couche canonique
affirme. Toute divergence devient un constat visible.

Ce que la verification independante a etabli (2026-10-20) :
  - les TABLEAUX reconstruits (entetes, etiquettes, rangees, colonnes) sont
    conformes aux pages rendues ;
  - la TRONCATURE a droite (« Phente », « Local a / contain / vasoco »,
    « DextromethorphanLumateperoneZiprasidone ») est portee par la PAGE
    RENDUE elle-meme : c'est le document source qui est tronque, pas
    l'extracteur ;
  - la FAUTE IMPRIMEE « Specia Populations » est presente sur la page rendue ;
  - le MODELE CITRA 6.0.0 (rust-core) REFUSE ce PDF (« selectable text
    exceeds bounded raw-part budget ») sur toute page demandee, alors
    qu'il en confirme independamment l'empreinte SHA-256.
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

import pymupdf

RACINE = Path(__file__).resolve().parent.parent
SRC = RACINE / "Books" / "prescribers-guide-stahls-essential-psychopharmacology.pdf"
DOSSIER = RACINE / "knowledge" / "canonical-v2" / "stahl-prescribers-guide-7e-cup" / \
    "sha256-cf23ef7b70e7c6e099a5a43d994adb2f34ef06718643932611f5e91eeba180e3"
RENDUS = RACINE / "artifacts" / "stahl-verification"
SORTIE = RACINE / "docs" / "reports" / "2026-10-20-stahl-verification-visuelle.json"

# Observations lues sur les pages RENDUES (transcription fidele).
OBSERVATIONS = {
    1109: {
        "rendu": "Monographie MAOI. Table 1 « Drugs contraindicated due to risk of "
                 "serotonin syndrome/toxicity » : etiquette « Do Not Use: », en-tete a "
                 "4 colonnes (Antidepressants | Drugs of Abuse | Opioids | Other), 4 rangees "
                 "de donnees. Table 2 « Dietary guidelines for patients taking MAOIs* » : "
                 "2 colonnes (Foods to avoid** | Foods allowed), 3 rangees visibles.",
        "verifie": [
            "en-tete a 4 colonnes et ses libelles : conformes aux colonnes extraites",
            "etiquette « Do Not Use: » : presente, extraite comme label_rows",
            "4 rangees de donnees : conformes, y compris la cellule repliee "
            "« High-dose or injected amphetamine » (3 lignes rendus, 1 cellule extraite)",
            "table 2 a 2 colonnes : conforme",
        ],
        "anomalies_visibles": [
            "la 4e cellule de la derniere rangee s'imprime "
            "« DextromethorphanLumateperoneZiprasidone » : trois medicaments colles "
            "SANS separateur DANS LA PAGE RENDUE (le source est ainsi)",
        ],
    },
    1110: {
        "rendu": "Suite de la table 2 (en-tete « Foods to avoid** | Foods allowed » "
                 "REPETE en haut de page) puis note de pied « * Consult up-to-date "
                 "listing of tyramine content ... **Not necessary for 6 mg transdermal "
                 "or low-dose oral selegiline ». Table 3 « Drugs that boost "
                 "norepinephrine ... » : etiquette « Use With Caution: », 4 colonnes "
                 "(Decongestants | Stimulants | Antidepressants with norepinephrine "
                 "reuptake inhibition | Other), 2 rangees de donnees.",
        "verifie": [
            "la REPETITION de l'en-tete en haut de page confirme la continuation : "
            "la table 2 est bien un seul tableau p.1109-1110",
            "la note de pied est bien capturee dans footnotes",
            "table 3 : 4 colonnes et 2 rangees conformes, y compris la cellule "
            "« Antidepressants with norepinephrine reuptake inhibition » (6 lignes rendues)",
        ],
        "anomalies_visibles": [
            "la 4e colonne est TRONQUEE par la marge droite de la page : la page "
            "rendue affiche « Phente » et « Local a / contain / vasoco ». Les "
            "caracteres manquants N'EXISTENT PAS dans le document.",
            "« MethylphenidateCocaineMethamphetamineModafinilArmodafinil » et "
            "« NRIsNDRIs » sont imprimes colles, sans separateur.",
        ],
    },
    1775: {
        "rendu": "Monographie MAOI (rasagiline). Table 3 « Drugs that boost "
                 "norepinephrine ... » IMPRIMEE EN CLAIR : en-tete a 4 colonnes "
                 "(Decongestants | Stimulants | Antidepressants with norepinephrine "
                 "reuptake inhibition | Other), 2 rangees. La 4e colonne porte "
                 "« Phentermine » et « Local anesthetics containing vasoconstrictors / "
                 "Tapentadol » (deux lignes). La 3e colonne porte « Methylphenidate / "
                 "Cocaine / Methamphetamine / Modafinil / Armodafinil » (cinq lignes). "
                 "Apres un filet horizontal, « Do Not Use » forme un BLOC DISTINCT "
                 "avec sa liste a puces.",
        "verifie": [
            "cette copie est la VERSION CLAIRE du meme tableau que les copies "
            "tronquees des p.1110 et p.1505 : elle en est la PREUVE interne",
            "les 4 colonnes et les 2 rangees correspondent exactement a "
            "l'extraction de la p.1775",
            "le bloc « Do Not Use » est bien distinct du tableau (filet horizontal "
            "intermediaire) : il ne doit PAS etre capture comme ligne de table",
        ],
        "anomalies_visibles": [],
    },
    2256: {
        "rendu": "Monographie MAOI. Table 1 « Drugs contraindicated ... » : en-tete a "
                 "4 colonnes, 6 rangees. La 4e colonne de la derniere rangee porte "
                 "« Dextromethorphan », « Lumateperone », « Ziprasidone » sur TROIS "
                 "lignes distinctes (la colonne est plus large que sur p.1109, ou "
                 "les trois noms tiennent sur une seule ligne).",
        "verifie": [
            "l'extraction reproduit fidelement les trois items de la 4e colonne ; "
            "ils apparaissent sur trois rangees parce que la source les imprime "
            "sur trois lignes, avec un rythme vertical irregulier (71 pt puis 33 pt)",
            "c'est une SEGMENTATION DE RANGEES fidele, pas une perte : les trois "
            "noms sont presents et la page est exacte",
            "la meme cellule, complete et espaces, est lisible dans les copies "
            "p.1504 et p.1772 -> c'est l'occurrence.soeur qui sert de preuve",
        ],
        "anomalies_visibles": [],
    },
    2363: {
        "rendu": "Monographie du valbenazine. Bloc « Other Warnings/Precautions », "
                 "« Do Not Use », puis un titre de section s'imprimant "
                 "« Specia Populations » (sic), puis « Renal Impairment », "
                 "« Hepatic Impairment » (« Moderate to severe impairment: 40 mg once "
                 "daily »), « Cardiac Impairment ».",
        "verifie": [
            "la FAUTE IMPRIMEE « Specia Populations » est bien presente dans la page "
            "rendue : l'extraction la reproduit verbatim, l'ISOLO (ne la fusionne pas "
            "avec « Special Populations ») et la soumet a relecture",
            "la dose « 40 mg » (Hepatic Impairment) est extraite en assertion "
            "verbatim-ancree sur la page 2363",
            "les 3 unites concernees par la faute appartiennent a la monographie "
            "« Valbenazine » (p.2363-2364) : la faute est LOCALISEE, pas globale",
        ],
        "anomalies_visibles": [
            "« Other Warnings/Precautions » est imprime AVANT « Specia Populations » "
            "comme un bloc distinct, alors que la couche canonique le range sous "
            "« Specia Populations ». Modele HERITE de la couche canonique "
            "pre-existante (units.jsonl, non modifie par cette ingestion) : "
            "signale, non reecrit.",
        ],
    },
}


def main() -> int:
    RENDUS.mkdir(parents=True, exist_ok=True)
    doc = pymupdf.open(SRC)
    tables = [json.loads(l) for l in (DOSSIER / "tables.jsonl").read_text(encoding="utf-8").split("\n") if l.strip()]
    unites = [json.loads(l) for l in (DOSSIER / "units.jsonl").read_text(encoding="utf-8").split("\n") if l.strip()]
    assertions = [json.loads(l) for l in (DOSSIER / "assertions.jsonl").read_text(encoding="utf-8").split("\n") if l.strip()]

    pages = []
    for numero, obs in sorted(OBSERVATIONS.items()):
        page = doc[numero - 1]
        pix = page.get_pixmap(matrix=pymupdf.Matrix(1.6, 1.6), colorspace=pymupdf.csRGB)
        fichier = RENDUS / f"p{numero:04d}.png"
        pix.save(str(fichier))
        tables_page = [
            {"table_id": t["table_id"], "label": t["label"], "title": t["title"],
             "columns": t["columns"], "headers": t["headers"], "rows": t["rows_count"],
             "label_rows": t["label_rows"], "footnotes": t["footnotes"],
             "page_start": t["page_start"], "page_end": t["page_end"],
             "anomalies": t.get("source_anomalies", [])}
            for t in tables if t["page_start"] <= numero <= t["page_end"]
        ]
        unites_page = [
            {"id": u["id"], "path": u["structural_path"], "page": u["page_start"]}
            for u in unites if u.get("page_start") == numero
        ]
        assertions_page = [
            {"id": a["assertion_id"], "raw_value": a["raw_value"], "parsed": a["parsed_value"],
             "unit": a["unit"], "comparator": a["comparator"], "l3": a["l3"],
             "anchored": a["verbatim_anchored"]}
            for a in assertions if a.get("page_start") == numero
        ]
        pages.append({
            "page": numero,
            "rendu": str(fichier.relative_to(RACINE)),
            "observation_rendue": obs["rendu"],
            "extraction": {
                "tables": tables_page,
                "unites": len(unites_page),
                "unites_details": unites_page,
                "assertions": assertions_page,
            },
            "verifie": obs["verifie"],
            "anomalies_visibles": obs["anomalies_visibles"],
            "verdict": "conforme" if not obs["anomalies_visibles"] else "conforme aux defauts DU SOURCE (constates, non corriges)",
        })
    doc.close()

    # page 2691 : statut "texte court" — page de titre de partie, lue dans la couche brute
    brut2691 = json.loads((DOSSIER / "raw" / "page-2691.json").read_text(encoding="utf-8"))
    pages.append({
        "page": 2691,
        "rendu": None,
        "observation_rendue": "Non rendue : la couche brute suffit (30 caracteres, "
                              "1 image). Contenu reel : titre de partie.",
        "extraction": {"status": brut2691["status"], "char_count": brut2691["char_count"],
                       "image_count": brut2691["image_count"],
                       "texte": brut2691["raw_text"].strip()},
        "verifie": ["le statut 'texte court' est justifie : page de titre de partie "
                    "(« Decriminalizing Mental Illness ») avec une image, aucun corps de texte"],
        "anomalies_visibles": [],
        "verdict": "statut legitime, documente",
    })

    rapport = {
        "livre": "stahl-prescribers-guide-7e-cup",
        "objet": "Verification independante de l'extraction par RENDU puis LECTURE A L'OEIL",
        "methode": "PyMuPDF 1.28.2 (rendu 1,6x) + lecture visuelle, comparee a la couche canonique",
        "pages_verifiees": [p["page"] for p in pages],
        "pages": pages,
        "moteur_citra": {
            "version": "6.0.0",
            "moteur": "rust-core / rust-pdf-inspect-v1",
            "resultat": "REFUS",
            "erreur": "Failed to extract PDF text: IO error: selectable text exceeds bounded raw-part budget",
            "portee_teste": "read_pdf (1 page et 2 pages), search_pdf (3 requetes), pdf_evidence inspect (1 page)",
            "effet_de_bord_constate": "aucune extraction : le moteur ne peut pas ouvrir ce PDF, meme page par page",
            "verification_independante_reussie": "l'empreinte SHA-256 du fichier est confirmee par citra "
                                                  "(cf23ef7b70e7c6e099a5a43d994adb2f34ef06718643932611f5e91eeba180e3), "
                                                  "independantement du calcul local",
            "conclusion": "Sur ce PDF de 16,9 Mo produit par Calibre, citra est INEXPLOITABLE "
                          "et PyMuPDF 1.28.2 est retenu. Aucun OCR n'est requis ni possible.",
        },
        "conclusion": [
            "Les tableaux reconstruits sont conformes aux pages rendues (entetes, etiquettes, "
            "rangees, colonnes, continuation de page, notes de pied).",
            "Les anomalies de cellule (concatenation, troncature a droite) sont PORTES PAR LA PAGE "
            "RENDUE : elles sont dans le document source, pas dans l'extraction. Aucune completion "
            "n'a ete inventee ; la seule proposition (decoupage d'un decoupe) reste une proposition.",
            "La faute imprimee « Specia Populations » est presente dans le source : elle est "
            "reproduite verbatim, isolee et soumise a relecture.",
        ],
    }
    SORTIE.parent.mkdir(parents=True, exist_ok=True)
    SORTIE.write_text(json.dumps(rapport, ensure_ascii=False, indent=1, sort_keys=True) + "\n", encoding="utf-8")
    print(f"verification visuelle ecrites : {SORTIE.relative_to(RACINE)}")
    for p in pages:
        print(f"  p.{p['page']} : {p['verdict']}")
    return 0


if __name__ == "__main__":
    try:
        sys.stdout.reconfigure(encoding="utf-8")
    except Exception:
        pass
    sys.exit(main())
