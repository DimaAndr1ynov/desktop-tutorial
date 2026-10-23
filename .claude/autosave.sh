#!/usr/bin/env bash
# Автосохранение работы в git: снимок рабочей папки -> ветка claude/autosave -> push.
# Рабочая ветка и main не трогаются (коммит собирается отдельным индексом), на живой сайт не влияет.
cd "${CLAUDE_PROJECT_DIR:-.}" || exit 0
git rev-parse --git-dir >/dev/null 2>&1 || exit 0

BR="claude/autosave"
GD="$(git rev-parse --git-dir)"
export GIT_INDEX_FILE="$GD/autosave-index"
rm -f "$GIT_INDEX_FILE"

if git rev-parse -q --verify "refs/heads/$BR" >/dev/null; then
  PARENT="refs/heads/$BR"
elif git rev-parse -q --verify "refs/remotes/origin/$BR" >/dev/null; then
  PARENT="refs/remotes/origin/$BR"
else
  PARENT="HEAD"
fi

git read-tree "$PARENT" || exit 0
git add -A >/dev/null 2>&1
TREE="$(git write-tree)" || exit 0
if [ "$TREE" = "$(git rev-parse "$PARENT^{tree}")" ]; then
  rm -f "$GIT_INDEX_FILE"
  exit 0
fi

COMMIT="$(printf 'Автосохранение: %s\n' "$(date '+%Y-%m-%d %H:%M')" | git commit-tree "$TREE" -p "$(git rev-parse "$PARENT")")" || exit 0
git update-ref "refs/heads/$BR" "$COMMIT"
rm -f "$GIT_INDEX_FILE"
unset GIT_INDEX_FILE
git push -q origin "$BR" 2>/dev/null || true
exit 0
