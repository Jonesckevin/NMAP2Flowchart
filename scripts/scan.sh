#!/usr/bin/env bash
set -uo pipefail

PREFIX=${PREFIX:-24}
ARGS=${ARGS:--sV -O --traceroute}
OUT=${OUT:-scans}
TARGETS=(192.168.0.0 192.168.1.0)
command -v nmap >/dev/null || { echo "nmap not found in PATH" >&2; exit 1; }
(( EUID == 0 )) || echo "note: root (sudo) needed for -O and raw scans" >&2
mkdir -p "$OUT"
fail=0
for t in "${TARGETS[@]}"; do
  [[ $t == *.0 ]] && spec="$t/$PREFIX" || spec="$t/32"
  echo "==> $spec"
  nmap $ARGS -oX "$OUT/${t//./-}.xml" "$spec" || fail=$((fail + 1))
done
echo "wrote $(find "$OUT" -name '*.xml' | wc -l) file(s) to $OUT, $fail failed"
exit $((fail > 0))
