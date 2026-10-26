type PublicFact = {
  readonly id: string;
  readonly label: string;
  readonly sourceUrl: string;
  readonly secondarySourceUrl?: string;
  readonly match: readonly (readonly string[])[];
  readonly answer: string;
  readonly requiredConcepts?: readonly (readonly string[])[];
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
  {
    id: "day-night", label: "NASA Space Place — What Causes the Seasons?",
    sourceUrl: "https://spaceplace.nasa.gov/seasons/en/",
    match: [["jour"], ["nuit"], ["succèdent", "alternent", "pourquoi", "cycle", "rotation"]],
    answer: "Le jour et la nuit se succèdent parce que la Terre tourne sur son axe : chaque lieu passe alternativement face au Soleil, puis à l’opposé.",
  },
  {
    id: "ice-density", label: "U.S. Geological Survey — Water Density",
    sourceUrl: "https://www.usgs.gov/water-science-school/science/water-density",
    match: [["glace"], ["flotte", "flotter", "flottaison"]],
    answer: "La glace flotte parce qu’elle est moins dense que l’eau liquide : à volume égal, sa masse est plus faible.",
  },
  {
    id: "sound-pitch", label: "NASA — Speed of Sound",
    sourceUrl: "https://www.nasa.gov/wp-content/uploads/2018/07/speed_of_sound_9-12.pdf",
    match: [["son", "sons"], ["aigu", "aigue"], ["grave"]],
    answer: "La hauteur d’un son dépend de sa fréquence : une fréquence plus élevée donne un son aigu, et une fréquence plus basse un son grave.",
  },
  {
    id: "condensation", label: "USGS — Condensation and the Water Cycle",
    sourceUrl: "https://www.usgs.gov/water-science-school/science/condensation-and-water-cycle",
    match: [["miroir"], ["buee", "condensation"]],
    answer: "La surface froide refroidit la vapeur d’eau de l’air, qui se transforme en fines gouttelettes : cette condensation forme la buée.",
    requiredConcepts: [["buee", "buée"], ["vapeur", "eau"], ["condensation", "condense"]],
  },
  {
    id: "autumn-leaves", label: "NASA Earth Observatory — Fall Colors in the Mid-Atlantic",
    sourceUrl: "https://science.nasa.gov/earth/earth-observatory/fall-colors-in-the-mid-atlantic-79512/",
    match: [["feuille", "feuilles"], ["couleur", "couleurs"], ["automne"]],
    answer: "À l’automne, la chlorophylle diminue dans les feuilles : le vert s’efface et laisse apparaître d’autres pigments, jaunes ou rouges.",
    requiredConcepts: [["automne"], ["feuille", "feuilles"], ["chlorophylle"], ["pigment", "jaune", "rouge"]],
  },
  {
    id: "white-clouds", label: "NASA — Crepuscular Rays and Light Scattering",
    sourceUrl: "https://eol.jsc.nasa.gov/Collections/EarthObservatory/articles/CrepuscularRaysandLightScattering.htm",
    match: [["nuage", "nuages"], ["blanc", "blancs", "blanche", "blanches"], ["pourquoi", "paraissent", "sembler"]],
    answer: "Les gouttelettes d’eau des nuages diffusent les différentes couleurs de la lumière solaire à peu près ensemble, ce qui les fait paraître blanches.",
    requiredConcepts: [["nuage", "nuages"], ["blanc"], ["goutte", "diffus", "lumiere"]],
  },
  {
    id: "metal-and-wood", label: "OpenStax College Physics 2e — Conduction",
    sourceUrl: "https://openstax.org/books/college-physics-2e/pages/14-5-conduction",
    match: [["metal"], ["bois"], ["froid", "froide"], ["temperature"]],
    answer: "À température égale, le métal retire la chaleur de la main plus vite que le bois parce qu’il la conduit mieux; il paraît donc plus froid.",
    requiredConcepts: [["metal"], ["bois"], ["chaleur"], ["conduit", "transfere", "transmet"]],
  },
  {
    id: "mass-and-weight", label: "NASA Glenn — Weight Equation",
    sourceUrl: "https://www1.grc.nasa.gov/beginners-guide-to-aeronautics/weight-equation-2/",
    match: [["masse"], ["poids"], ["difference", "différence"]],
    answer: "La masse mesure la quantité de matière d’un objet; son poids est la force de gravité qui agit sur lui et varie selon l’astre.",
    requiredConcepts: [["masse"], ["poids"], ["matiere", "quantite"], ["force", "gravite"]],
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

export function publicFactAnswerMatches(answer:string,fact:PublicFact):boolean{
  const normalized=normalize(answer);
  return fact.requiredConcepts?.every(group=>group.some(term=>normalized.includes(normalize(term))))??true;
}
