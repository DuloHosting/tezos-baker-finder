#!/bin/bash
set -e

read -sp "GitHub token: " TOKEN
echo ""
ORG="DuloHosting"
REPO="tezos-baker-finder"

echo "→ Creating repo $ORG/$REPO on GitHub..."
curl -s -X POST \
  -H "Authorization: token $TOKEN" \
  -H "Accept: application/vnd.github.v3+json" \
  https://api.github.com/orgs/$ORG/repos \
  -d "{\"name\":\"$REPO\",\"description\":\"Tezos baker quiet window finder\",\"private\":false,\"auto_init\":false}" \
  | grep -E '"full_name"|"html_url"|"message"'

echo ""
echo "→ Initialising git and pushing..."
cd "$(dirname "$0")"
git init
git add .
git commit -m "Initial commit: Tezos baker quiet window finder"
git branch -M main
git remote add origin https://$TOKEN@github.com/$ORG/$REPO.git
git push -u origin main

echo ""
echo "✓ Done! Repo live at: https://github.com/$ORG/$REPO"
