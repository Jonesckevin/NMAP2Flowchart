import { flattenLayers, nodeTitle, type DiagramDoc } from '../doc/types';
import { LAYER_COLORS } from '../doc/types';

type SelectionToolbarProps = {
  doc: DiagramDoc;
  nodeIds: string[];
  edgeIds: string[];
  connecting: boolean;
  onStartConnect: () => void;
  onCancelConnect: () => void;
  onMoveToLayer: (layerId: string) => void;
  onAlign: (mode: 'left' | 'center' | 'right' | 'top' | 'middle' | 'bottom') => void;
  onDistribute: (mode: 'horizontal' | 'vertical') => void;
  onRecolor: (color: string) => void;
  onDuplicate: () => void;
  onDelete: () => void;
  onClose: () => void;
};

export function SelectionToolbar({
  doc,
  nodeIds,
  edgeIds,
  connecting,
  onStartConnect,
  onCancelConnect,
  onMoveToLayer,
  onAlign,
  onDistribute,
  onRecolor,
  onDuplicate,
  onDelete,
  onClose,
}: SelectionToolbarProps) {
  const nodes = nodeIds
    .map((id) => doc.nodes.find((node) => node.id === id))
    .filter((node): node is NonNullable<typeof node> => Boolean(node));
  const edge = edgeIds.length > 0 ? doc.edges.find((item) => item.id === edgeIds[0]) : undefined;

  if (nodes.length === 0 && !edge) return null;

  if (edge) {
    return (
      <div className="selection-bar">
        <span className="selection-bar__label">
          {edge.kind === 'route' ? 'Traceroute link' : `Connection: ${edge.label || 'unlabelled'}`}
        </span>
        <button type="button" className="btn btn--tiny btn--danger" onClick={onDelete}>
          Delete connection
        </button>
        <button type="button" className="selection-bar__close" onClick={onClose} aria-label="Clear selection">
          ✕
        </button>
      </div>
    );
  }

  const single = nodes.length === 1 ? nodes[0] : null;
  const currentLayer = single ? doc.layers.find((layer) => layer.id === single.layerId) : undefined;
  const kindCounts = nodes.reduce<Record<string, number>>((counts, node) => {
    counts[node.kind] = (counts[node.kind] ?? 0) + 1;
    return counts;
  }, {});
  const commonKinds = Object.entries(kindCounts)
    .map(([kind, count]) => `${count} ${kind}${count === 1 ? '' : 's'}`)
    .join(', ');

  return (
    <div className="selection-bar">
      <span className="selection-bar__label">
        {single ? nodeTitle(single) : `${nodes.length} nodes`}
        <em>{single ? single.kind : commonKinds}</em>
      </span>

      <label className="selection-bar__field">
        <span>Layer</span>
        <select
          className="input input--compact"
          value={single?.layerId ?? ''}
          onChange={(event) => onMoveToLayer(event.target.value)}
        >
          {!single && <option value="">Move all to…</option>}
          {flattenLayers(doc.layers).map(({ layer, depth }) => (
            <option key={layer.id} value={layer.id}>
              {'\u00A0'.repeat(depth * 2)}
              {layer.name}
              {currentLayer?.id === layer.id && single ? '  ✓' : ''}
            </option>
          ))}
        </select>
      </label>

      {single && (
        <button
          type="button"
          className={`btn btn--tiny${connecting ? ' is-on' : ''}`}
          onClick={connecting ? onCancelConnect : onStartConnect}
          title="Click this, then click another node to connect them"
        >
          {connecting ? 'Cancel link' : 'Connect'}
        </button>
      )}

      {!single && nodes.length > 1 && (
        <>
          <label className="selection-bar__field">
            <span>Align</span>
            <select className="input input--compact selection-bar__align" defaultValue="" onChange={(event) => {
              if (event.target.value) onAlign(event.target.value as 'left' | 'center' | 'right' | 'top' | 'middle' | 'bottom');
              event.target.value = '';
            }}>
              <option value="" disabled>Align…</option>
              <option value="left">Left</option>
              <option value="center">Horizontal center</option>
              <option value="right">Right</option>
              <option value="top">Top</option>
              <option value="middle">Vertical middle</option>
              <option value="bottom">Bottom</option>
            </select>
          </label>
          {nodes.length >= 3 && (
            <label className="selection-bar__field">
              <span>Distribute</span>
              <select className="input input--compact selection-bar__align" defaultValue="" onChange={(event) => {
                if (event.target.value) onDistribute(event.target.value as 'horizontal' | 'vertical');
                event.target.value = '';
              }}>
                <option value="" disabled>Space…</option>
                <option value="horizontal">Horizontally</option>
                <option value="vertical">Vertically</option>
              </select>
            </label>
          )}
          <label className="selection-bar__field selection-bar__color-field">
            <span>Color</span>
            <button type="button" className="selection-bar__color" title="Apply accent colour" onClick={() => onRecolor(LAYER_COLORS[0])} style={{ background: LAYER_COLORS[0] }} />
          </label>
        </>
      )}

      <button type="button" className="btn btn--tiny" onClick={onDuplicate} disabled={!single}>
        Duplicate
      </button>
      <button type="button" className="btn btn--tiny btn--danger" onClick={onDelete}>
        Delete
      </button>
      <button type="button" className="selection-bar__close" onClick={onClose} aria-label="Clear selection">
        ✕
      </button>
    </div>
  );
}
