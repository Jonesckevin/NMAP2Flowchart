/**
 * Validation for the risk-level policy shared by the server default and the
 * per-account preferences. The browser normalises the same shape
 * (`App/src/doc/risk.ts`); here it only has to be defensive, because the value
 * can come from an operator's environment file or from any signed-in client.
 */
const MAX_LEVELS = 12;
const MAX_LABEL = 40;
const MAX_PORTS = 600;
const MAX_JSON_BYTES = 32 * 1024;
const HEX_COLOR = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i;
const LEVEL_ID = /^[a-z0-9-]{1,40}$/;
import fs from 'node:fs';

/** Trimmed, bounded copy of one policy, or null when it is not usable. */
export function sanitizeRiskPolicy(value) {
  if (!value || typeof value !== 'object') return null;
  const raw = Array.isArray(value) ? value : value.levels;
  if (!Array.isArray(raw)) return null;

  const levels = [];
  for (const entry of raw.slice(0, MAX_LEVELS)) {
    if (!entry || typeof entry !== 'object') continue;
    const label = String(entry.label ?? '')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, MAX_LABEL);
    const ports = String(entry.ports ?? '').trim().slice(0, MAX_PORTS);
    if (!label && !ports) continue;

    let id = typeof entry.id === 'string' && LEVEL_ID.test(entry.id) ? entry.id : `level-${levels.length + 1}`;
    if (levels.some((level) => level.id === id)) id = `${id}-${levels.length + 1}`;

    levels.push({
      id,
      label: label || `Level ${levels.length + 1}`,
      color:
        typeof entry.color === 'string' && HEX_COLOR.test(entry.color.trim()) ? entry.color.trim() : '#e5484d',
      ports,
      enabled: entry.enabled !== false,
    });
  }

  const policy = { version: 1, levels };
  if (Buffer.byteLength(JSON.stringify(policy)) > MAX_JSON_BYTES) return null;
  return policy;
}

/**
 * Reads the operator-configured policy from `NMAP_RISK_LEVELS` (inline JSON) or
 * `NMAP_RISK_POLICY_FILE` (path to JSON). Either may be a bare array of levels
 * or a `{ "levels": [...] }` object. Anything unreadable is ignored so a typo
 * never stops the server from starting.
 */
export function loadRiskPolicy(env) {
  const inline = env.NMAP_RISK_LEVELS;
  const file = env.NMAP_RISK_POLICY_FILE;
  try {
    let raw = null;
    if (file) {
      raw = JSON.parse(fs.readFileSync(String(file), 'utf8'));
    } else if (typeof inline === 'string' && inline.trim()) {
      raw = JSON.parse(inline);
    } else {
      return null;
    }
    return sanitizeRiskPolicy(raw);
  } catch {
    return null;
  }
}

export const RISK_LIMITS = { MAX_LEVELS, MAX_LABEL, MAX_PORTS, MAX_JSON_BYTES };
