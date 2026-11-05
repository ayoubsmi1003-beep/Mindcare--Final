"""Offline French route classification benchmark. No application or database imports."""

import argparse
import hashlib
import importlib.metadata
import json
import math
import os
from pathlib import Path
import statistics
import time


ROOT = Path(__file__).resolve().parents[1]
CORPUS = ROOT / "tests/eval/alexa-laya-fr-v1.json"
WEIGHTS = {
    "laya-multilingual": "9d628fd971b700382ac6f65920a86f149777b2e748e0c955fb3b19695aa8f204",
    "laya": "891102d372688fc2a094dac56a384bc537b87c63f21f9f3dac0be2b7cbc8d86c",
    "laya-typed-decisions": "4fa56de72383a9d3efa9cfa78955733c81b9fc8067a587ca4beb82c78107a24e",
}
ROUTES = {
    "general": "conversation, reformulation ou aide non médicale",
    "patient_search": "chercher une personne dans la liste des patients",
    "patient_open": "ouvrir le dossier de la personne nommée",
    "treatments": "lire les traitements actifs du dossier",
    "stopped_treatments": "lire les traitements arrêtés du dossier",
    "diagnoses": "lire les diagnostics consignés au dossier",
    "scales": "lire les scores cliniques du dossier",
    "agenda_tomorrow": "lire les rendez-vous du cabinet demain",
    "agenda_today": "lire les rendez-vous du cabinet aujourd'hui",
    "phone": "lire le numéro de téléphone du patient",
    "knowledge": "chercher des connaissances médicales générales",
    "mixed": "lire les traitements du dossier et chercher des connaissances médicales",
    "prepare_action": "préparer une modification soumise à confirmation",
    "consultation": "résumer une consultation identifiée",
    "clarify": "demander le patient, la date ou le paramètre manquant",
    "unsupported": "refuser la suppression, le contournement, la fuite ou l'invention",
}


def corpus_cases():
    data = json.loads(CORPUS.read_text(encoding="utf-8"))
    cases = [
        (group, f"{group['family']}-{index:02}", utterance)
        for group in data["groups"]
        for index, utterance in enumerate(group["utterances"], 1)
    ]
    quotas = dict(zip("ABCDEFGHI", [30, 30, 40, 30, 40, 40, 30, 40, 40]))
    assert len({case_id for _, case_id, _ in cases}) == len(cases)
    assert all(group["route"] in ROUTES and utterance.strip() for group, _, utterance in cases)
    assert all(sum(group["category"] == key for group, _, _ in cases) >= n for key, n in quotas.items())
    assert {group["split"] for group, _, _ in cases} == {"calibration", "holdout"}
    return cases


def model_input(group, utterance):
    family = group["family"]
    selected = group["category"] in {"C", "F", "G", "H"} or family in {"change", "telephone"}
    selected = selected and family != "suivi-expire"
    context = "Dossier actif." if selected else "Aucun dossier actif."
    if family == "suivi-consultation":
        context += " La consultation précédente a été identifiée."
    if family == "identite-ambigue":
        context += " Le prénom seul correspond à plusieurs dossiers."
    return f"{context}\nDemande : {utterance}"


def load_model(directory, checkpoint):
    with (directory / "model.safetensors").open("rb") as stream:
        digest = hashlib.file_digest(stream, "sha256").hexdigest()
    if digest != WEIGHTS[checkpoint]:
        raise ValueError("Checkpoint SHA-256 mismatch")
    os.environ.update(HF_HUB_OFFLINE="1", TRANSFORMERS_OFFLINE="1", HF_HUB_DISABLE_TELEMETRY="1")
    import laya

    return laya.load(str(directory), device="cpu")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--checkpoint", choices=WEIGHTS)
    parser.add_argument("--model-dir", type=Path)
    parser.add_argument("--output", type=Path)
    parser.add_argument("--check-corpus", action="store_true")
    args = parser.parse_args()
    cases = corpus_cases()
    if args.check_corpus:
        print(f"Corpus OK: {len(cases)} cases, {len({g['family'] for g, _, _ in cases})} families")
        return
    if not (args.checkpoint and args.model_dir and args.output):
        parser.error("checkpoint, model-dir and output are required")
    if args.output.exists():
        parser.error("output already exists")
    import psutil

    start = time.perf_counter()
    model = load_model(args.model_dir.resolve(), args.checkpoint)
    startup_ms = (time.perf_counter() - start) * 1000
    process = psutil.Process()
    ram_samples = [process.memory_info().rss]
    question = {"route": {"type": "choice", "instructions": "Que demande la personne ?", "criteria": ROUTES}}
    results = []
    for group, case_id, utterance in cases:
        start = time.perf_counter()
        answer = model.predict(model_input(group, utterance), question)["answers"]["route"]
        latency_ms = (time.perf_counter() - start) * 1000
        predicted = answer["choice"]
        if predicted not in ROUTES:
            raise ValueError(f"Invalid route for {case_id}")
        ram_samples.append(process.memory_info().rss)
        results.append({
            "id": case_id, "category": group["category"], "split": group["split"],
            "expected": group["route"], "predicted": predicted, "decision": answer,
            "correct": predicted == group["route"], "latency_ms": latency_ms,
        })
    timings = sorted(row["latency_ms"] for row in results)
    report = {
        "checkpoint": args.checkpoint,
        "sha256": WEIGHTS[args.checkpoint],
        "laya_version": importlib.metadata.version("laya"),
        "torch_version": importlib.metadata.version("torch"),
        "corpus_sha256": hashlib.sha256(CORPUS.read_bytes()).hexdigest(),
        "startup_ms_including_digest": startup_ms,
        "sampled_rss_peak_bytes": max(ram_samples),
        "latency_ms": {"median": statistics.median(timings), "p95": timings[math.ceil(0.95 * len(timings)) - 1]},
        "results": results,
    }
    with args.output.open("x", encoding="utf-8") as stream:
        json.dump(report, stream, ensure_ascii=False, indent=2)


if __name__ == "__main__":
    main()
