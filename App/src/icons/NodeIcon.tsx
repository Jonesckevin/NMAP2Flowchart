import { iconById } from './registry';

export function NodeIcon({ id, size = 18 }: { id?: string; size?: number }) {
  const def = iconById(id);
  const base = { width: size, height: size };
  if (def.logo) {
    return (
      <span className="node-icon node-icon--logo" style={{ ...base, color: def.color }}>
        <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
          <path d={def.logo} />
        </svg>
      </span>
    );
  }
  if (def.glyph) {
    return (
      <span className="node-icon node-icon--glyph" style={{ ...base, color: def.color, fontSize: size }}>
        {def.glyph}
      </span>
    );
  }
  return (
    <span
      className="node-icon node-icon--mark"
      style={{
        ...base,
        fontSize: Math.round(size * 0.46),
        color: def.color,
        borderColor: `${def.color}55`,
        background: `${def.color}1a`,
      }}
    >
      {def.mark}
    </span>
  );
}
