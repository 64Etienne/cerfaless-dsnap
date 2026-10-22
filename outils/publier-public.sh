#!/bin/bash
# Publie DSNap dans le dépôt public 64Etienne/cerfaless-dsnap : un commit par version, sans l'historique privé.
# Usage : outils/publier-public.sh <dossier du clone du dépôt public>
# Seuls les fichiers suivis par git sont copiés (git archive) : rien d'ignoré, aucune donnée locale.
set -euo pipefail
RACINE=$(cd "$(dirname "$0")/.." && pwd)
CIBLE=$(cd "${1:?Usage : outils/publier-public.sh <clone du dépôt public>}" && pwd)
[ -d "$CIBLE/.git" ] || { echo "$CIBLE n'est pas un clone git."; exit 1; }
[ "$CIBLE" != "$RACINE" ] || { echo "La cible doit être le clone du dépôt public, pas ce dépôt."; exit 1; }
cd "$RACINE"
git diff --quiet && git diff --cached --quiet || { echo "Validez d'abord vos modifications."; exit 1; }
VERSION=$(node -p "require('./server/lib/version.js').VERSION")
SOURCE=$(git rev-parse --short HEAD)
find "$CIBLE" -mindepth 1 -maxdepth 1 ! -name .git -exec rm -rf {} +
git archive HEAD | tar -x -C "$CIBLE"
cd "$CIBLE"
git add -A
if git diff --cached --quiet; then echo "Rien de nouveau à publier."; exit 0; fi
git commit -q -m "DSNap $VERSION" -m "Publié depuis le dépôt de développement ($SOURCE)."
echo "Commit prêt dans $CIBLE : relisez-le (git show --stat), puis git push."
