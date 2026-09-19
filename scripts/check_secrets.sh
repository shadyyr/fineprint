#!/usr/bin/env bash
#
# Block secrets and student data from entering the repository.
#
# .gitignore only protects files nobody force-adds. This runs on the content
# actually being committed, so a `git add -f` or a mistyped path still gets
# caught.
#
#   scripts/check_secrets.sh            scan staged content (what the hook does)
#   scripts/check_secrets.sh --all      scan the whole working tree
#
# Wired in via .githooks/pre-commit. Re-enable after a fresh clone with:
#   git config core.hooksPath .githooks

set -uo pipefail

MODE="${1:---staged}"
REPO_ROOT="$(git rev-parse --show-toplevel)"
cd "$REPO_ROOT"

RED=$'\033[31m'; YEL=$'\033[33m'; DIM=$'\033[2m'; OFF=$'\033[0m'
findings=0

note()  { printf '%s\n' "  $*"; }
fail()  { printf '%s\n' "${RED}BLOCKED${OFF}  $*"; findings=$((findings + 1)); }

# This script necessarily contains the patterns it searches for, so it would
# always match itself. Excluded by path.
SELF="scripts/check_secrets.sh"

# Content scanning is text-only. PDFs get the path check below instead.
BINARY_RE='\.(pdf|png|jpe?g|gif|ico|woff2?|ttf|otf|eot|zip|gz|tgz|mp4|webm|map)$'

# Student aid letters carry personal information (master context 6.11).
# Only synthetic letters and publicly published institutional samples belong
# in the repository, and only in these two directories.
PDF_ALLOWED_RE='^(fixtures/|corpus/letters/)'

MAX_BYTES=$((10 * 1024 * 1024))

# --- what to look for -------------------------------------------------------

# Filenames that should never be committed regardless of content.
BLOCKED_PATHS_RE='(^|/)(\.env(\..*)?|credentials\.json|secrets\.json|.*\.(pem|key|p12))$'
# .env.example is the documented template and carries no real value.
ALLOWED_PATHS_RE='(^|/)\.env\.example$'

# Secret-shaped content. Kept deliberately narrow: a noisy scanner that people
# learn to bypass is worse than a quiet one they trust.
read -r -d '' SECRET_RE <<'PATTERNS' || true
sk-ant-[A-Za-z0-9_-]{16,}
sk-[A-Za-z0-9]{32,}
AKIA[0-9A-Z]{16}
ghp_[A-Za-z0-9]{36}
github_pat_[A-Za-z0-9_]{50,}
xox[baprs]-[A-Za-z0-9-]{10,}
-----BEGIN [A-Z ]*PRIVATE KEY-----
(ANTHROPIC|OPENAI|AWS_SECRET|GOOGLE)[A-Z_]*(KEY|TOKEN|SECRET)[[:space:]]*[:=][[:space:]]*['"]?[A-Za-z0-9/_+-]{16,}
PATTERNS
SECRET_RE_JOINED="$(printf '%s' "$SECRET_RE" | paste -sd'|' -)"

# --- gather the file list ---------------------------------------------------

files=()
if [[ "$MODE" == "--all" ]]; then
  while IFS= read -r f; do files+=("$f"); done < <(
    git ls-files --cached --others --exclude-standard
  )
else
  while IFS= read -r f; do files+=("$f"); done < <(
    git diff --cached --name-only --diff-filter=ACM
  )
fi

if [[ ${#files[@]} -eq 0 ]]; then
  echo "No files to scan."
  exit 0
fi

# Read a file's content from the index when staged, from disk otherwise.
content_of() {
  if [[ "$MODE" == "--all" ]]; then cat -- "$1" 2>/dev/null
  else git show ":$1" 2>/dev/null
  fi
}

size_of() {
  if [[ "$MODE" == "--all" ]]; then wc -c <"$1" 2>/dev/null || echo 0
  else git cat-file -s "$(git rev-parse ":$1" 2>/dev/null)" 2>/dev/null || echo 0
  fi
}

# --- run the checks ---------------------------------------------------------

for f in "${files[@]}"; do
  [[ "$f" == "$SELF" ]] && continue

  # 1. Filenames that must never be committed.
  if [[ "$f" =~ $BLOCKED_PATHS_RE ]] && ! [[ "$f" =~ $ALLOWED_PATHS_RE ]]; then
    fail "$f"
    note "${DIM}A secret-bearing file. Keep it on disk; it is already gitignored.${OFF}"
    continue
  fi

  # 2. PDFs outside the two approved directories.
  if [[ "$f" =~ \.pdf$ ]] && ! [[ "$f" =~ $PDF_ALLOWED_RE ]]; then
    fail "$f"
    note "${DIM}PDFs may only live in fixtures/ or corpus/letters/. If this is a real${OFF}"
    note "${DIM}student's aid letter it must not be committed at all (see 6.11).${OFF}"
    continue
  fi

  # 3. Oversized files.
  bytes="$(size_of "$f")"
  if [[ "${bytes:-0}" -gt "$MAX_BYTES" ]]; then
    fail "$f"
    note "${DIM}$((bytes / 1024 / 1024)) MB exceeds the 10 MB limit.${OFF}"
    continue
  fi

  # 4. Secret-shaped content, text files only.
  [[ "$f" =~ $BINARY_RE ]] && continue
  hits="$(content_of "$f" | grep -nEa "$SECRET_RE_JOINED" 2>/dev/null | head -3)"
  if [[ -n "$hits" ]]; then
    fail "$f"
    while IFS= read -r line; do
      note "${DIM}${line:0:120}${OFF}"
    done <<<"$hits"
  fi
done

# --- reminder, not a blocker ------------------------------------------------

staged_pdfs="$(printf '%s\n' "${files[@]}" | grep -E '\.pdf$' || true)"
if [[ -n "$staged_pdfs" && $findings -eq 0 ]]; then
  printf '%s\n' "${YEL}Note${OFF}  committing PDFs:"
  printf '%s\n' "$staged_pdfs" | sed 's/^/        /'
  printf '%s\n' "${DIM}      Confirm these are synthetic or publicly published samples,${OFF}"
  printf '%s\n' "${DIM}      never a real student's letter.${OFF}"
fi

if [[ $findings -gt 0 ]]; then
  echo
  printf '%s\n' "${RED}$findings problem(s) found. Commit aborted.${OFF}"
  printf '%s\n' "${DIM}Unstage the file, or if this is genuinely a false positive:${OFF}"
  printf '%s\n' "${DIM}  git commit --no-verify${OFF}"
  exit 1
fi

echo "Secret scan clean (${#files[@]} file(s))."
exit 0
