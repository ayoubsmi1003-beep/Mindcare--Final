/**
 * L'écran d'appairage — HTML pur, sans Electron.
 *
 * ═══ POURQUOI CE FICHIER EST SÉPARÉ ══════════════════════════════════════════
 *
 * Il était noyé dans `bureau-cabinet.ts`, donc impossibles à vérifier : ni test
 * unitaire, ni rendu réel avant l'installation chez la praticienne. Trois
 * défauts en sont sortis — une politique de sécurité qui bloquait toutes les
 * feuilles de style, un titre figé sans aucun indicateur d'activité, et des
 * boutons absents tant que rien n'était en erreur.
 *
 * Ici, la fonction ne dépend que de ses arguments : on peut l'exécuter dans un
 * test, l'ouvrir dans un navigateur, et comparer ce que l'on voit à ce qui est
 * livré. `bureau-cabinet.ts` ne fournit que le nonce et les libellés.
 */

function echapperHtml(valeur: string): string {
  return valeur.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/**
 * Rend l'écran complet.
 *
 * `messages` est le fichier `cabinet-desktop.fr.json` (packagé sous
 * `resources/cabinet/messages-fr.json`). `nomPoste` est le nom réseau de CE
 * poste : il est affiché sous le bouton d'hôte pour que la praticienne puisse
 * le lire à l'accueil si la découverte automatique est bloquée.
 */
export function htmlEcranCabinet(messages: Record<string, string>, nonce: string, nomPoste: string): string {
  const m = (cle: string): string => echapperHtml(messages[cle] ?? "");
  const nom = echapperHtml(nomPoste);
  return `<!doctype html><html lang="fr"><head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'nonce-${nonce}'; script-src 'nonce-${nonce}'">
<title>MindCare OS</title>
<style nonce="${nonce}">
  *{box-sizing:border-box}
  body{font:16px "Segoe UI",Arial,sans-serif;padding:36px 40px;line-height:1.55;color:#1b1b1b;width:100%;max-width:820px;margin:0 auto}
  h1{font-size:23px;margin:0 0 6px}
  #message{margin:0 0 4px;font-weight:600}
  #detail{margin:0;color:#1a6b63;font-weight:600;word-break:break-word;min-height:1.4em}
  .points{display:inline-block;width:12px;height:12px;margin-left:9px;border:2px solid #d5d5d5;border-top-color:#1a6b63;border-radius:50%;animation:p .9s linear infinite;vertical-align:middle}
  @keyframes p{to{transform:rotate(360deg)}}
  .bloc{margin-top:26px;padding-top:18px;border-top:1px solid #e3e3e3}
  .bloc h2{font-size:14px;margin:0 0 6px;color:#555;font-weight:600}
  label{display:block;font-size:14px;margin-bottom:6px}
  input{font:inherit;padding:9px 10px;width:100%;box-sizing:border-box;border:1px solid #c9c9c9;border-radius:8px}
  .rangee{display:flex;gap:8px;margin-top:10px;flex-wrap:wrap}
  .espace{margin-top:22px}
  button{font:inherit;padding:9px 15px;border-radius:8px;border:1px solid #c9c9c9;background:#fff;cursor:pointer}
  button:hover{border-color:#8a8a8a}
  button.primaire{background:#1a6b63;border-color:#1a6b63;color:#fff}
  button.lien{border:none;background:none;color:#1a6b63;text-decoration:underline;padding:4px 0}
  small{display:block;margin-top:8px;color:#666}
  [hidden]{display:none!important}
  .nom{font-family:Consolas,monospace;background:#f3f3f3;padding:2px 6px;border-radius:4px}
  @media (prefers-reduced-motion: reduce){.points{animation:none}}
</style></head>
<body>
<h1>MindCare OS</h1>
<p id="message" role="status">${m("search")}<span class="points" aria-hidden="true"></span></p>
<p id="detail"></p>

<div class="bloc" id="premier" hidden>
  <h2>${m("hostHelp")}</h2>
  <button class="primaire" id="host">${m("hostButton")}</button>
  <small>${m("thisComputerName").replace("{nom}", `<span class="nom">${nom}</span>`)}</small>
</div>

<div class="bloc" id="invitation" hidden>
  <label for="code">${m("invitationLabel")}</label>
  <input id="code" autocomplete="off" spellcheck="false" placeholder="XXXX XXXX XXXX XXXX XXXX XXXX">
  <div class="rangee"><button class="primaire" id="pair">${m("pairButton")}</button></div>
  <small>${m("pairHelp")}</small>
</div>

<div class="bloc" id="manuelle">
  <h2>${m("manualTitle")}</h2>
  <label for="pcname">${m("manualLabel")}</label>
  <input id="pcname" autocomplete="off" spellcheck="false" placeholder="CABINET-PC">
  <div class="rangee"><button id="manual">${m("manualButton")}</button>
  <button class="lien" id="diagnostic">${m("diagnosticButton")}</button></div>
  <small>${m("manualHelp")}</small>
</div>

<div class="rangee espace">
  <button id="retry">${m("searchAgain")}</button>
</div>

<script nonce="${nonce}">
  const $ = (id) => document.getElementById(id);
  const appliquer = (e) => {
    $('message').textContent = e.message;
    $('message').appendChild(Object.assign(document.createElement('span'), {className:'points', ariaHidden:'true'}));
    $('detail').textContent = e.detail || '';
    $('premier').hidden = !e.premier;
    $('invitation').hidden = !e.invitation;
    $('manuelle').hidden = !e.manuelle;
  };
  window.cabinet.onEtat(appliquer);
  $('host').onclick = () => window.cabinet.action('host');
  $('pair').onclick = () => { const i = $('code'); const code = i.value; i.value = ''; window.cabinet.action('pair', code); };
  $('manual').onclick = () => { const i = $('pcname'); window.cabinet.action('manual', i.value); };
  $('pcname').addEventListener('keydown', (e) => { if (e.key === 'Enter') $('manual').click(); });
  $('code').addEventListener('keydown', (e) => { if (e.key === 'Enter') $('pair').click(); });
  $('retry').onclick = () => window.cabinet.action('retry');
  $('diagnostic').onclick = () => window.cabinet.action('diagnostic');
</script></body></html>`;
}
