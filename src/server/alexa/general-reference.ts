type PublicFact = {
  readonly id: string;
  readonly label: string;
  readonly sourceUrl: string;
  readonly secondarySourceUrl?: string;
  readonly match: readonly (readonly string[])[];
  readonly answer: string;
};

const facts: readonly PublicFact[] = [
  {
    id: "moon-orbit", label: "NASA — How Orbits Work",
    sourceUrl: "https://science.nasa.gov/learn/basics-of-space-flight/chapter3-4/",
    match: [["lune"], ["terre"], ["tourne", "orbite", "tombe"]],
    answer: "La gravité terrestre dévie continuellement la Lune vers la Terre, tandis que sa vitesse tangentielle l'empêche d'y tomber : elle est ainsi en chute libre autour de nous.",
  },
  {
    id: "rainbow", label: "NASA — Rainbow Formation",
    sourceUrl: "https://science.nasa.gov/image-article/apod-2007-september-12-six-rainbows-across-norway/",
    secondarySourceUrl: "https://nasaeclips.arc.nasa.gov/shared_assets/resources/nasa-launchpad-analyzing-spectra/479659main_LP8-AnalyzingSpectra_508.pdf",
    match: [["arc en ciel"], ["forme", "forment", "formation", "couleurs"]],
    answer: "Dans les gouttelettes d’eau, la lumière du Soleil est réfractée puis réfléchie; la dispersion sépare ses couleurs, qui ressortent sous forme d’arc.",
  },
  {
    id: "blue-sky", label: "NASA — Rayleigh Scattering",
    sourceUrl: "https://astrobiology.nasa.gov/nai/articles/2016/5/6/could-earths-light-blue-color-be-a-signature-of-life/index.html",
    match: [["ciel"], ["bleu", "bleue"]],
    answer: "L’atmosphère diffuse surtout les longueurs d'onde courtes, notamment la lumière bleue : c’est la diffusion de Rayleigh.",
  },
  {
    id: "computer", label: "Computer Science Field Guide — Machine Code",
    sourceUrl: "https://www.csfieldguide.org.nz/en/chapters/programming-languages/machine-code/",
    match: [["ordinateur"], ["fonctionne", "marche", "processeur", "programme"]],
    answer: "Un ordinateur traite les instructions d’un programme avec son processeur; il effectue des calculs sur les données et renvoie un résultat.",
  },
  {
    id: "algorithm", label: "NIST — Algorithm",
    sourceUrl: "https://csrc.nist.gov/glossary/term/Algorithm",
    match: [["algorithme"]],
    answer: "Un algorithme est une suite précise d’étapes qui permet de résoudre un problème ou d’atteindre un résultat.",
  },
  {
    id: "seasons", label: "NASA Space Place — What Causes the Seasons?",
    sourceUrl: "https://spaceplace.nasa.gov/seasons/en/",
    match: [["saison", "saisons"], ["change", "changent", "changer", "pourquoi"]],
    answer: "L’axe incliné de la Terre, pendant sa révolution autour du Soleil, modifie l’ensoleillement de chaque hémisphère.",
  },
  {
    id: "airplane-flight", label: "NASA Glenn — Four Forces on an Airplane",
    sourceUrl: "https://www1.grc.nasa.gov/beginners-guide-to-aeronautics/four-forces-on-an-airplane/",
    match: [["avion"], ["vol", "vole", "voler", "reste"]],
    answer: "Les ailes dévient l’air vers le bas, ce qui crée la portance qui s’oppose au poids; la poussée maintient l’avion en mouvement face à la traînée.",
  },
  {
    id: "planet-star", label: "NASA StarChild — Stars and Planets",
    sourceUrl: "https://starchild.gsfc.nasa.gov/docs/StarChild/questions/question62.html",
    match: [["planete", "planètes"], ["etoile", "étoile"], ["difference", "distinction"]],
    answer: "Une étoile produit sa propre lumière grâce à la fusion nucléaire; une planète orbite autour d’une étoile et réfléchit surtout sa lumière.",
  },
  {
    id: "boiling", label: "OpenStax Chemistry 2e — Phase Transitions",
    sourceUrl: "https://openstax.org/books/chemistry-2e/pages/10-3-phase-transitions",
    match: [["eau"], ["bout", "bouillir", "ebullition"]],
    answer: "L’eau bout à sa température d’ébullition lorsque sa pression de vapeur égale la pression extérieure; elle se transforme en vapeur.",
  },
  {
    id: "rain", label: "USGS — Condensation and the Water Cycle",
    sourceUrl: "https://www.usgs.gov/water-science-school/science/condensation-and-water-cycle",
    match: [["pluie"], ["forme", "formation", "comment", "goutte", "gouttelettes"]],
    answer: "L’eau s’évapore, puis la vapeur se condense en nuages; les gouttelettes grossissent et retombent sous forme de pluie.",
  },
];

function normalize(value: string): string {
  return value.normalize("NFKD").replace(/\p{M}/gu, "").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
}

/** Retrieves only a uniquely matched local fact card; unknown questions stay with the selected local model. */
export function findVerifiedPublicFact(question: string): PublicFact | null {
  const normalized = ` ${normalize(question)} `;
  const matches = facts.filter(fact => fact.match.every(group => group.some(alias => normalized.includes(` ${normalize(alias)} `))));
  return matches.length === 1 ? matches[0]! : null;
}
