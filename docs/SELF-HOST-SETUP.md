# SELF-HOST-SETUP.md
**Supabase auto-hébergé sur le PC serveur du cabinet — session S0**
v1 — 2026-08-02 · Windows 10 Pro · i7 · 16 GB

> Ce document remplace la décision « Supabase Cloud ».
> Conséquence directe : **aucune donnée patient ne quitte l'Algérie.** Loi 18-07 respectée,
> pas contournée. C'est la meilleure décision prise sur ce projet.

---

## 0. À LANCER MAINTENANT, HORS SESSION

Les téléchargements n'ont pas besoin de toi ni de Claude. Lance-les **avant** S0.

```powershell
# PowerShell administrateur
wsl --install
# redémarrer le PC
```
Puis télécharge **Docker Desktop for Windows** et installe-le. Coche « Use WSL 2 based engine ».

Pendant que ça tourne, tu peux faire autre chose. **C'est de l'attente, pas du travail.**

---

## 1. RESSOURCES — 16 GB suffisent, mais il faut les cadrer

La pile Supabase demande ~6 GB. Windows en prend ~4. Il reste de la marge, à condition de la borner.

`C:\Users\<toi>\.wslconfig` :
```ini
[wsl2]
memory=8GB
processors=4
swap=2GB
```
Sans ce fichier, WSL2 prend jusqu'à 50 % de la RAM et le poste devient lent pendant une consultation.

---

## 2. INSTALLATION

```bash
git clone --depth 1 https://github.com/supabase/supabase
cp -r supabase/docker mindcare-db
cd mindcare-db
cp .env.example .env
```

### 2.1 `.env` — les valeurs qui comptent
```
POSTGRES_PASSWORD=<32+ caractères aléatoires>
JWT_SECRET=<40+ caractères aléatoires>
ANON_KEY=<généré depuis JWT_SECRET>
SERVICE_ROLE_KEY=<généré depuis JWT_SECRET>
DASHBOARD_USERNAME=<pas "supabase">
DASHBOARD_PASSWORD=<fort>
```
🔴 **Ne réutilise aucune clé du projet Supabase Cloud.** Elles ont transité par un chat et par un `.env`
non maîtrisé. Considère-les compromises, révoque le projet cloud après migration.

### 2.2 ⚠️ Le point critique — la locale ICU
Le cluster **doit** être créé avec la locale `fr-DZ`. Ça ne se change pas après coup :
un cluster créé en locale par défaut puis migré corrompt les index B-tree sur les noms accentués.
Vérifie dans `docker-compose.yml` que l'initialisation Postgres porte bien la locale avant le premier `up`.

### 2.3 ⚠️ Les ports — liaison locale uniquement
Dans `docker-compose.yml`, chaque port publié doit être préfixé `127.0.0.1:` :
```yaml
ports:
  - "127.0.0.1:8000:8000"     # API
  - "127.0.0.1:5432:5432"     # Postgres
```
Sans ce préfixe, Postgres écoute sur toutes les interfaces du réseau du cabinet.
C'est le défaut d'usine, et c'est la faille la plus courante des installations Supabase auto-hébergées.

```bash
docker compose up -d
```

---

## 3. ✅ CHECKPOINT S0 — copier-coller

```bash
docker ps --format '{{.Names}}\t{{.Status}}'          # 9 conteneurs, tous "healthy"
curl -s http://localhost:8000/rest/v1/ | head -c 200  # réponse JSON
psql -h localhost -p 5432 -U postgres -c "SHOW lc_collate;"   # doit rendre fr-DZ
```
Depuis **un autre poste du réseau** :
```bash
nc -zv <ip-serveur> 5432    # doit ÉCHOUER  ← c'est le test qui compte
curl http://<ip-serveur>:3000    # doit répondre (l'app, pas la base)
```
🔴 Si Postgres répond depuis un autre poste, **on s'arrête**. Rien d'autre n'a de sens.

---

## 4. LE POSTE EST UN SERVEUR — il se configure comme tel

```
[ ] Veille et mise en veille du disque : DÉSACTIVÉES
[ ] Docker Desktop : démarrage automatique
[ ] BitLocker actif sur C:  ← un PC volé ne doit pas être un dossier médical volé
[ ] Verrouillage de session 5 min (le poste est dans un lieu de passage)
[ ] Réservation DHCP : l'IP du serveur ne change jamais
[ ] Pare-feu : 5432 bloqué hors machine, port applicatif ouvert sur le LAN seulement
[ ] AUCUNE redirection de port sur le routeur — le système n'est pas joignable d'internet
[ ] Onduleur si disponible : une coupure pendant une écriture corrompt la base
```

---

## 5. SAUVEGARDE — à câbler en S8, pas plus tard

```
[ ] pg_dump chiffré, quotidien, tâche planifiée Windows
[ ] Copie sur disque USB externe, débranché après copie
[ ] ⚠️ RESTAURATION TESTÉE sur un second dossier — pas seulement lancée
[ ] Procédure écrite en français, une page, imprimée, posée près du PC
```
> **Une sauvegarde jamais restaurée n'est pas une sauvegarde.**

---

## 6. CE QUI NE CHANGE PAS DANS LE CODE

Trois variables d'environnement. C'est tout.
```
NEXT_PUBLIC_SUPABASE_URL=http://localhost:8000
NEXT_PUBLIC_SUPABASE_ANON_KEY=…
SUPABASE_SERVICE_ROLE_KEY=…
```
Aucune requête, aucune migration, aucun composant ne bouge.
C'est pour ça qu'on pouvait se permettre de commencer sur le cloud — et pour ça qu'on en sort maintenant,
avant qu'il y ait de vraies données dedans.
