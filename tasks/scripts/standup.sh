#!/usr/bin/env bash
# tasks/scripts/standup.sh
# Plain-English status of every task plan — readable by a non-technical owner.
# No GitHub, no LLM, instant. Adapted from ccpm's standup pattern.
# Usage:  bash tasks/scripts/standup.sh

cd "$(dirname "$0")/.." || exit 1

echo ""
echo "📋  KRACKED SALES — STANDUP   ($(date '+%a %d %b %Y · %H:%M'))"
echo "────────────────────────────────────────────────────────────"

found=0
# Newest-modified first, so the active work floats to the top.
for f in $(ls -t ./*.md 2>/dev/null); do
  done=$(grep -cE '^[[:space:]]*- \[[xX]\]' "$f" 2>/dev/null)
  todo=$(grep -cE '^[[:space:]]*- \[ \]' "$f" 2>/dev/null)
  total=$((done + todo))
  [ "$total" -eq 0 ] && continue
  found=$((found + 1))
  pct=$(( done * 100 / total ))
  filled=$(( (pct + 5) / 10 )); bar=""
  for i in $(seq 1 10); do [ "$i" -le "$filled" ] && bar+="█" || bar+="░"; done
  icon="🟡"; [ "$pct" -eq 100 ] && icon="✅"; [ "$pct" -eq 0 ] && icon="⚪"
  name=$(basename "$f" .md)
  printf "%s  %-34s %s %3d%%  (%d/%d)\n" "$icon" "$name" "$bar" "$pct" "$done" "$total"
done

[ "$found" -eq 0 ] && { echo "   (no task plans with checklists found)"; echo ""; exit 0; }

echo "────────────────────────────────────────────────────────────"

# Active = most recently touched plan that isn't 100% done.
active=""
for f in $(ls -t ./*.md 2>/dev/null); do
  todo=$(grep -cE '^[[:space:]]*- \[ \]' "$f" 2>/dev/null)
  [ "$todo" -gt 0 ] && { active="$f"; break; }
done

if [ -n "$active" ]; then
  echo "▶️  ACTIVE: $(basename "$active" .md)"
  echo "    Next up:"
  grep -E '^[[:space:]]*- \[ \]' "$active" 2>/dev/null | head -5 \
    | sed -E 's/^[[:space:]]*- \[ \][[:space:]]*/      • /'
else
  echo "🎉  All task plans complete."
fi
echo ""
