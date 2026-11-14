import { useState } from 'react';
import { NodeIcon } from '../icons/NodeIcon';
import {
  EDGE_ARROWS,
  EDGE_ARROW_LABELS,
  EDGE_LINES,
  EDGE_PATHS,
  EDGE_PATH_LABELS,
  EDGE_SIDES,
  EDGE_SIDE_LABELS,
  edgeArrow,
  edgeLine,
  edgePath,
  edgeSides,
  flattenLayers,
  LAYER_COLORS,
  nodeTitle,
  type DiagramDoc,
  type DiagramEdge,
  type DiagramNode,
  type EdgePath,
  type EdgeSide,
} from '../doc/types';
import { discoveryOnly, openPorts, type NmapHost, type NmapMac, type NmapOsMatch, type NmapPort } from '../model/types';
import { hexToRgba, portsByLevel, type RiskPolicy } from '../doc/risk';
import { IconPicker } from './IconPicker';

const PATH_SAMPLES: Record<EdgePath, string> = {
  curve: 'M3 17 C 14 17, 26 3, 37 3',
  straight: 'M3 17 L 37 3',
  step: 'M3 17 H 20 V 3 H 37',
  smoothstep: 'M3 17 H 15 Q 20 17 20 12 V 8 Q 20 3 25 3 H 37',
};

const EDGE_SIDE_ARROWS: Record<EdgeSide, string> = { l: '←', t: '↑', r: '→', b: '↓' };

const PATH_HINTS: Record<EdgePath, string> = {
  curve: 'Curve – a soft bezier between the two nodes',
  straight: 'Straight – a single direct line',
  step: 'Step – right angles with sharp corners',
  smoothstep: 'Square – right angles with rounded corners, like traceroute links',
};

type InspectorProps = {
  doc: DiagramDoc;
  /** Active risk policy; the diagram's own levels or the inherited ones. */
  riskPolicy: RiskPolicy;
  nodeIds: string[];
  edgeIds: string[];
  onPatchNode: (id: string, patch: Partial<DiagramNode>) => void;
  onPatchNodes: (ids: string[], patch: Partial<DiagramNode>) => void;
  onSetSection: (id: string, sectionId: string | null) => void;
  onDeleteNodes: (ids: string[]) => void;
  onDuplicateNode: (id: string) => void;
  onPatchEdge: (id: string, patch: Partial<DiagramEdge>) => void;
  onPatchEdges: (ids: string[], patch: Partial<DiagramEdge>) => void;
  onDeleteEdges: (ids: string[]) => void;
  onStackNode: (id: string, mode: 'front' | 'forward' | 'backward' | 'back') => void;
  onArrangeSection: (id: string) => void;
  onAutoSizeSection: (id: string) => void;
  onClose: () => void;
};

const KIND_LABEL: Record<DiagramNode['kind'], string> = {
  host: 'host',
  section: 'section',
  note: 'note',
  hop: 'route hop',
  origin: 'scan origin',
};

/** Human names for the accent swatches, aligned with LAYER_COLORS. */
const ACCENT_NAMES = ['blue', 'green', 'orange', 'purple', 'pink', 'yellow', 'slate'];

export function Inspector(props: InspectorProps) {
  const { doc, nodeIds, edgeIds, onClose } = props;
  const nodes = nodeIds.map((id) => doc.nodes.find((node) => node.id === id)).filter(Boolean) as DiagramNode[];
  const edges = edgeIds.map((id) => doc.edges.find((edge) => edge.id === id)).filter(Boolean) as DiagramEdge[];

  if (nodes.length === 0 && edges.length === 0) return null;

  if (nodes.length > 1) {
    return (
      <aside className="inspector">
        <header className="inspector__head">
          <div>
            <span className="inspector__eyebrow">selection</span>
            <h2>{nodes.length} nodes</h2>
          </div>
          <button type="button" className="icon-button" onClick={onClose} aria-label="Close inspector">
            ✕
          </button>
        </header>
        <div className="inspector__body">
          <Field label="Move to layer">
            <select
              className="input"
              value=""              aria-label="Move to layer"

              onChange={(event) => {
                if (event.target.value) props.onPatchNodes(nodeIds, { layerId: event.target.value });
              }}
            >
              <option value="">Choose a layer…</option>
              {flattenLayers(doc.layers).map(({ layer, depth }) => (
                <option key={layer.id} value={layer.id}>
                  {'\u00A0'.repeat(depth * 2)}
                  {layer.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Icon">
            <BulkIcon doc={doc} onPick={(icon) => props.onPatchNodes(nodeIds, { icon })} />
          </Field>
          <div className="inspector__footer">
            <button type="button" className="btn btn--danger" onClick={() => props.onDeleteNodes(nodeIds)}>
              Delete {nodes.length} nodes
            </button>
          </div>
        </div>
      </aside>
    );
  }

  if (nodes.length === 0 && edges.length > 0) {
    return <EdgeDetails {...props} edge={edges[0]} edgeCount={edges.length} />;
  }

  return <NodeDetails {...props} node={nodes[0]} />;
}

function BulkIcon({ onPick }: { doc: DiagramDoc; onPick: (id: string) => void }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="picker-wrap">
      <button type="button" className="btn btn--tiny" onClick={() => setOpen((value) => !value)}>
        Change icon…
      </button>
      {open && <IconPicker value={undefined} onPick={onPick} onClose={() => setOpen(false)} />}
    </div>
  );
}

const emptyHostData = (id: string): NmapHost => ({
  id: `${id}:scan`,
  ip: '',
  hostnames: [],
  status: 'up',
  os: [],
  ports: [],
  scripts: [],
  hops: [],
});

const osWith = (os: NmapOsMatch[], name: string, accuracy: number): NmapOsMatch[] =>
  name.trim() ? [{ name: name.trim(), accuracy }, ...os.slice(1)] : [];

function ListEditor({
  name,
  values,
  onChange,
  placeholder,
  addLabel,
  mono,
}: {
  name: string;
  values: string[];
  onChange: (values: string[]) => void;
  placeholder?: string;
  addLabel: string;
  mono?: boolean;
}) {
  return (
    <div className="list-editor">
      {values.map((value, index) => (
        <div className="list-editor__row" key={index}>
          <input
            className={`input${mono ? ' mono' : ''}`}
            aria-label={`${name} ${index + 1}`}
            placeholder={placeholder}
            value={value}
            onChange={(event) =>
              onChange(values.map((item, itemIndex) => (itemIndex === index ? event.target.value : item)))
            }
          />
          <button
            type="button"
            className="icon-button list-editor__remove"
            aria-label={`Remove ${name} ${index + 1}`}
            onClick={() => onChange(values.filter((_, itemIndex) => itemIndex !== index))}
          >
            ✕
          </button>
        </div>
      ))}
      <button type="button" className="btn btn--tiny list-editor__add" onClick={() => onChange([...values, ''])}>
        + {addLabel}
      </button>
    </div>
  );
}

function MacEditor({ macs, onChange }: { macs: NmapMac[]; onChange: (macs: NmapMac[]) => void }) {
  const patch = (index: number, next: Partial<NmapMac>) =>
    onChange(macs.map((entry, itemIndex) => (itemIndex === index ? { ...entry, ...next } : entry)));

  return (
    <div className="list-editor">
      {macs.map((entry, index) => (
        <div className="list-editor__row" key={index}>
          <input
            className="input mono"
            aria-label={`MAC ${index + 1}`}
            placeholder="00:11:22:33:44:55"
            value={entry.addr}
            onChange={(event) => patch(index, { addr: event.target.value.toUpperCase() })}
          />
          <input
            className="input"
            aria-label={`Vendor ${index + 1}`}
            placeholder="vendor"
            value={entry.vendor ?? ''}
            onChange={(event) => patch(index, { vendor: event.target.value })}
          />
          <button
            type="button"
            className="icon-button list-editor__remove"
            aria-label={`Remove MAC ${index + 1}`}
            onClick={() => onChange(macs.filter((_, itemIndex) => itemIndex !== index))}
          >
            ✕
          </button>
        </div>
      ))}
      <button type="button" className="btn btn--tiny list-editor__add" onClick={() => onChange([...macs, { addr: '' }])}>
        + Add MAC
      </button>
    </div>
  );
}

const PORT_PROTOCOLS = ['tcp', 'udp', 'sctp'];
const PORT_STATES = ['open', 'closed', 'filtered', 'open|filtered', 'unfiltered'];

const withCurrent = (current: string, options: string[]) =>
  [current, ...options].filter((value, index, all) => all.indexOf(value) === index);

function PortsEditor({ ports, onChange }: { ports: NmapPort[]; onChange: (ports: NmapPort[]) => void }) {
  const patch = (index: number, next: Partial<NmapPort>) =>
    onChange(ports.map((port, i) => (i === index ? { ...port, ...next } : port)));

  return (
    <div className="port-editor">
      {ports.map((port, index) => (
        <div className="port-editor__row" key={index}>
          <div className="port-editor__line">
            <input
              className="input mono"
              type="number"
              min={0}
              max={65535}
              aria-label="Port"
              value={port.port}
              onChange={(event) => patch(index, { port: Number(event.target.value) || 0 })}
            />
            <select
              className="input"
              aria-label="Protocol"
              value={port.protocol}
              onChange={(event) => patch(index, { protocol: event.target.value })}
            >
              {withCurrent(port.protocol, PORT_PROTOCOLS).map((value) => (
                <option key={value} value={value}>
                  {value}
                </option>
              ))}
            </select>
            <select
              className="input"
              aria-label="State"
              value={port.state}
              onChange={(event) => patch(index, { state: event.target.value })}
            >
              {withCurrent(port.state, PORT_STATES).map((value) => (
                <option key={value} value={value}>
                  {value}
                </option>
              ))}
            </select>
            <button
              type="button"
              className="icon-button"
              aria-label="Remove port"
              title="Remove port"
              onClick={() => onChange(ports.filter((_, i) => i !== index))}
            >
              ✕
            </button>
          </div>
          <div className="port-editor__line">
            <input
              className="input"
              aria-label="Service"
              placeholder="service"
              value={port.service ?? ''}
              onChange={(event) => patch(index, { service: event.target.value || undefined })}
            />
            <input
              className="input"
              aria-label="Product"
              placeholder="product"
              value={port.product ?? ''}
              onChange={(event) => patch(index, { product: event.target.value || undefined })}
            />
            <input
              className="input"
              aria-label="Version"
              placeholder="version"
              value={port.version ?? ''}
              onChange={(event) => patch(index, { version: event.target.value || undefined })}
            />
          </div>
        </div>
      ))}
      <button
        type="button"
        className="btn btn--tiny"
        onClick={() => onChange([...ports, { port: 80, protocol: 'tcp', state: 'open', scripts: [] }])}
      >
        + Add port
      </button>
    </div>
  );
}

function NodeDetails({
  doc,
  riskPolicy,
  node,
  onPatchNode,
  onSetSection,
  onDeleteNodes,
  onDuplicateNode,
  onStackNode,
  onArrangeSection,
  onAutoSizeSection,
  onClose,
}: InspectorProps & { node: DiagramNode }) {
  const [iconOpen, setIconOpen] = useState(false);
  const host = node.host ?? emptyHostData(node.id);
  const path = flattenLayers(doc.layers);
  const sections = doc.nodes.filter((item) => item.kind === 'section' && item.id !== node.id);
  const open = openPorts(host);
  const risks = portsByLevel(host, riskPolicy);
  const scripts = [...host.scripts, ...host.ports.flatMap((port) => port.scripts)];
  const patchHost = (patch: Partial<NmapHost>) => onPatchNode(node.id, { host: { ...host, ...patch } });

  return (
    <aside className="inspector">
      <header className="inspector__head">
        <div className="inspector__title">
          <span className="inspector__eyebrow">{KIND_LABEL[node.kind]}</span>
          <h2 className="mono">
            <NodeIcon id={node.icon} size={18} />
            {nodeTitle(node)}
          </h2>
        </div>
        <button type="button" className="icon-button" onClick={onClose} aria-label="Close inspector">
          ✕
        </button>
      </header>

      <div className="inspector__body">
        <Field label="Title">
          <input
            className="input"
            value={node.label ?? ''}
            placeholder={node.host?.ip ?? node.cidr ?? 'Untitled'}
            onChange={(event) => onPatchNode(node.id, { label: event.target.value })}
          />
        </Field>

        <Field label="Subtitle">
          <input
            className="input"
            value={node.subtitle ?? ''}
            placeholder={node.host?.hostnames[0] ?? 'Optional second line'}
            onChange={(event) => onPatchNode(node.id, { subtitle: event.target.value })}
          />
        </Field>

        <Field label="Icon">
          <div className="picker-wrap">
            <button type="button" className="icon-button-lg" onClick={() => setIconOpen((value) => !value)}>
              <NodeIcon id={node.icon} size={18} />
              <span>Change icon</span>
            </button>
            {iconOpen && (
              <IconPicker
                value={node.icon}
                onPick={(icon) => onPatchNode(node.id, { icon })}
                onClose={() => setIconOpen(false)}
              />
            )}
          </div>
        </Field>

        <Field label="Layer">
          <select
            className="input"
            value={node.layerId}            aria-label="Layer"

            onChange={(event) => onPatchNode(node.id, { layerId: event.target.value })}
          >
            {path.map(({ layer, depth }) => (
              <option key={layer.id} value={layer.id}>
                {'\u00A0'.repeat(depth * 2)}
                {layer.name}
              </option>
            ))}
          </select>
        </Field>

        {(node.kind === 'host' || node.kind === 'note') && (
          <Field label="Section">
            <select
              className="input"
              value={node.parentId ?? ''}              aria-label="Section"

              onChange={(event) => onSetSection(node.id, event.target.value || null)}
            >
              <option value="">No section (free on canvas)</option>
              {sections.map((section) => (
                <option key={section.id} value={section.id}>
                  {nodeTitle(section)}
                </option>
              ))}
            </select>
          </Field>
        )}

        {node.kind === 'hop' && (
          <>
            <Field label="Address">
              <input
                className="input mono"
                aria-label="Hop address"
                value={node.address ?? ''}
                placeholder="10.0.0.1"
                onChange={(event) => onPatchNode(node.id, { address: event.target.value })}
              />
            </Field>
            <Field label="Hop number (TTL)">
              <input
                className="input"
                aria-label="Hop number"
                type="number"
                min={1}
                value={node.depth ?? 1}
                onChange={(event) =>
                  onPatchNode(node.id, { depth: Math.max(1, Math.round(Number(event.target.value) || 1)) })
                }
              />
            </Field>
            <p className="inspector__note">
              A traceroute hop only carries an address and a TTL – nmap reports no ports or OS for
              routers in the path, so this is all the scan can give. Link it up with Connect.
            </p>
          </>
        )}

        {node.kind === 'origin' && (
          <Field label="Scan command">
            <input
              className="input mono"
              aria-label="Scan command"
              value={node.address ?? ''}
              placeholder="nmap -sV -sC -O --traceroute -oX scan.xml"
              onChange={(event) => onPatchNode(node.id, { address: event.target.value })}
            />
          </Field>
        )}

        {node.kind === 'section' && (
          <Field label="CIDR">
            <input
              className="input mono"
              aria-label="CIDR"
              value={node.cidr ?? ''}
              placeholder="10.0.0.0/24"
              onChange={(event) => onPatchNode(node.id, { cidr: event.target.value })}
            />
          </Field>
        )}

        {node.kind === 'section' && (
          <>
            <Field label="Collapse">
              <label className="switch">
                <input
                  type="checkbox"
                  checked={Boolean(node.collapsed)}
                  onChange={(event) => onPatchNode(node.id, { collapsed: event.target.checked })}
                />
                <span>Hide contents</span>
              </label>
            </Field>

            <Field label="Frame">
              <div className="button-row">
                <button type="button" className="btn btn--tiny" onClick={() => onArrangeSection(node.id)}>
                  Arrange grid
                </button>
                <button
                  type="button"
                  className="btn btn--tiny"
                  disabled={!node.manualSize}
                  title="Drop the hand-dragged size and fit the frame to its cards again"
                  onClick={() => onAutoSizeSection(node.id)}
                >
                  Auto-size
                </button>
              </div>
            </Field>
          </>
        )}

        <Field label="Stacking">
          <div className="button-row">
            <button type="button" className="btn btn--tiny" title="Bring to front" onClick={() => onStackNode(node.id, 'front')}>
              Front
            </button>
            <button type="button" className="btn btn--tiny" title="Bring forward" onClick={() => onStackNode(node.id, 'forward')}>
              Forward
            </button>
            <button type="button" className="btn btn--tiny" title="Send backward" onClick={() => onStackNode(node.id, 'backward')}>
              Backward
            </button>
            <button type="button" className="btn btn--tiny" title="Send to back" onClick={() => onStackNode(node.id, 'back')}>
              Back
            </button>
          </div>
          <p className="inspector__note">
            Stacking stays inside the node's layer – the layer list above the canvas decides which layer sits on top.
          </p>
        </Field>

        <Field label="Accent">
          <div className="swatches">
            <button
              type="button"
              className={`swatch swatch--none${node.accent ? '' : ' is-active'}`}
              title="No accent"
              aria-label="No accent"
              aria-pressed={!node.accent}
              onClick={() => onPatchNode(node.id, { accent: undefined })}
            />
            {LAYER_COLORS.map((color, index) => (
              <button
                key={color}
                type="button"
                className={`swatch${node.accent === color ? ' is-active' : ''}`}
                style={{ background: color }}
                title={`${ACCENT_NAMES[index] ?? 'Accent'} accent`}
                aria-label={`${ACCENT_NAMES[index] ?? color} accent`}
                aria-pressed={node.accent === color}
                onClick={() => onPatchNode(node.id, { accent: color })}
              />
            ))}
          </div>
          <p className="inspector__note">
            The accent colours the card edge. When a risk level applies, the edge keeps the risk colour
            and the accent becomes a stripe; selecting a card turns the edge green until you deselect.
          </p>
        </Field>

        <Field label={node.kind === 'note' ? 'Note' : 'Notes'}>
          <textarea
            className="input input--area"
            rows={4}
            value={node.notes ?? ''}
            placeholder={node.kind === 'note' ? 'Write the note…' : 'Free-form notes, exported with the diagram'}
            onChange={(event) => onPatchNode(node.id, { notes: event.target.value })}
          />
        </Field>

        {node.kind === 'host' && (
          <>
            {risks.map((entry) => (
              <p
                key={entry.level.id}
                className="inspector__warning"
                style={{
                  borderColor: hexToRgba(entry.level.color, 0.45),
                  background: hexToRgba(entry.level.color, 0.1),
                  color: entry.level.color,
                }}
              >
                {entry.ports.length} {entry.level.label.toLowerCase()}{' '}
                {entry.ports.length === 1 ? 'port' : 'ports'} exposed: {entry.ports.join(', ')}
              </p>
            ))}

            <h3 className="inspector__section">
              Scan data{' '}
              <span>{discoveryOnly(host) ? 'discovery only' : `${open.length} open / ${host.ports.length} scanned`}</span>
            </h3>

            {discoveryOnly(host) && (
              <p className="inspector__note">
                This scan never looked at ports (<code>nmap -sn</code> only discovers live hosts). Re-scan with
                <code> -sV</code> to fill them in, or add ports by hand below.
              </p>
            )}

            <Field label="Addresses">
              <ListEditor
                name="Address"
                values={host.addresses ?? [host.ip, host.ipv6].filter((value): value is string => Boolean(value))}
                onChange={(values) => {
                  const cleaned = values.map((value) => value.trim());
                  const filled = cleaned.filter(Boolean);
                  const primary = filled[0] ?? '';
                  // One filled address is the host's `ip`; anything else – several
                  // rows, or a row the user just opened and has not typed into yet –
                  // is kept as a list so the text box stays on screen while it is empty.
                  const asList = cleaned.length > 1 || filled.length === 0;
                  patchHost({
                    addresses: asList ? cleaned : undefined,
                    ip: primary,
                    // `ipv6` is the extra address beside an IPv4 `ip`, as the parser
                    // stores it; a lone IPv6 address is just the `ip`.
                    ipv6: primary.includes(':') ? undefined : filled.find((value) => value.includes(':')),
                  });
                }}
                placeholder="10.0.0.10"
                addLabel="Add address"
                mono
              />
            </Field>

            <Field label="Hostnames">
              <ListEditor
                name="Hostname"
                values={host.hostnames}
                onChange={(values) => patchHost({ hostnames: values })}
                placeholder="host.lab.internal"
                addLabel="Add hostname"
              />
            </Field>

            <Field label="MAC addresses">
              <MacEditor
                macs={host.macs ?? (host.mac ? [{ addr: host.mac, vendor: host.vendor }] : [])}
                onChange={(macs) => {
                  const cleaned = macs.map((entry) => ({
                    addr: entry.addr.trim().toUpperCase(),
                    vendor: entry.vendor?.trim() || undefined,
                  }));
                  const filled = cleaned.filter((entry) => entry.addr.length > 0);
                  // One filled address is the host's `mac`; anything else – several
                  // rows, or a row the user just opened and has not typed into yet –
                  // is kept as a list so the text box stays on screen while it is empty.
                  const asList = cleaned.length > 1 || filled.length === 0;
                  patchHost({
                    macs: asList ? cleaned : undefined,
                    mac: filled[0]?.addr,
                    vendor: filled[0]?.vendor,
                  });
                }}
              />
            </Field>

            <div className="field-pair">
              <Field label="Status">
                <select
                  className="input"
                  aria-label="Status"
                  value={host.status}
                  onChange={(event) => patchHost({ status: event.target.value })}
                >
                  {[host.status, 'up', 'down', 'unknown']
                    .filter((state, index, all) => all.indexOf(state) === index)
                    .map((state) => (
                      <option key={state} value={state}>
                        {state}
                      </option>
                    ))}
                </select>
              </Field>
            </div>

            <Field label="Route">
              <ListEditor
                name="Route hop"
                values={host.hops}
                onChange={(values) => patchHost({ hops: values.map((value) => value.trim()) })}
                placeholder="10.0.0.1"
                addLabel="Add hop"
                mono
              />
            </Field>

            <div className="field-pair">
              <Field label="OS">
                <input
                  className="input"
                  aria-label="OS"
                  value={host.os[0]?.name ?? ''}
                  placeholder="Linux 5.x"
                  onChange={(event) =>
                    patchHost({ os: osWith(host.os, event.target.value, host.os[0]?.accuracy ?? 0) })
                  }
                />
              </Field>
              <Field label="Accuracy %">
                <input
                  className="input"
                  type="number"
                  min={0}
                  max={100}
                  aria-label="Accuracy %"
                  value={host.os[0]?.accuracy ?? 0}
                  onChange={(event) =>
                    patchHost({ os: osWith(host.os, host.os[0]?.name ?? '', Number(event.target.value) || 0) })
                  }
                />
              </Field>
            </div>

            <Field label="Ports">
              <PortsEditor ports={host.ports} onChange={(ports) => patchHost({ ports })} />
            </Field>

            {scripts.length > 0 && (
              <>
                <h3 className="inspector__section">NSE scripts</h3>
                {scripts.map((script, index) => (
                  <details key={`${script.id}-${index}`} className="script">
                    <summary className="mono">{script.id}</summary>
                    <pre>{script.output}</pre>
                  </details>
                ))}
              </>
            )}
          </>
        )}

        <div className="inspector__footer">
          {node.kind !== 'origin' && (
            <button type="button" className="btn btn--tiny" onClick={() => onDuplicateNode(node.id)}>
              Duplicate
            </button>
          )}
          <button type="button" className="btn btn--tiny btn--danger" onClick={() => onDeleteNodes([node.id])}>
            Delete
          </button>
        </div>
      </div>
    </aside>
  );
}

function EdgeDetails({
  doc,
  edge,
  edgeIds,
  edgeCount,
  onPatchEdge,
  onPatchEdges,
  onDeleteEdges,
  onClose,
}: InspectorProps & { edge: DiagramEdge; edgeCount: number }) {
  const title = (id: string) => {
    const node = doc.nodes.find((item) => item.id === id);
    return node ? nodeTitle(node) : id;
  };
  const ids = edgeIds.length > 0 ? edgeIds : [edge.id];
  const current = edgeLine(edge);
  const currentPath = edgePath(edge);
  const currentArrow = edgeArrow(edge);
  const sides = edgeSides(edge);

  return (
    <aside className="inspector">
      <header className="inspector__head">
        <div>
          <span className="inspector__eyebrow">{edge.kind === 'route' ? 'traceroute link' : 'connection'}</span>
          <h2>
            {edgeCount > 1 ? `${edgeCount} connections` : `${title(edge.source)} → ${title(edge.target)}`}
          </h2>
        </div>
        <button type="button" className="icon-button" onClick={onClose} aria-label="Close inspector">
          ✕
        </button>
      </header>
      <div className="inspector__body">
        <Field label="Path">
          <div className="path-picker">
            {EDGE_PATHS.map((path) => (
              <button
                key={path}
                type="button"
                className={`path-picker__option${currentPath === path ? ' is-active' : ''}`}
                title={PATH_HINTS[path]}
                onClick={() => onPatchEdges(ids, { path })}
              >
                <svg viewBox="0 0 40 20" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
                  <path d={PATH_SAMPLES[path]} />
                </svg>
                {EDGE_PATH_LABELS[path]}
              </button>
            ))}
          </div>
        </Field>
        <Field label="Line">
          <div className="line-picker">
            {EDGE_LINES.map((line) => (
              <button
                key={line}
                type="button"
                className={`line-picker__option${current === line ? ' is-active' : ''}`}
                title={`${line[0].toUpperCase()}${line.slice(1)} line`}
                onClick={() => onPatchEdges(ids, { line })}
              >
                <span className={`line-picker__sample line-picker__sample--${line}`} />
                {line}
              </button>
            ))}
          </div>
        </Field>
        <Field label="Arrow">
          <div className="arrow-picker">
            {EDGE_ARROWS.map((arrow) => (
              <button
                key={arrow}
                type="button"
                className={`arrow-picker__option${currentArrow === arrow ? ' is-active' : ''}`}
                title={EDGE_ARROW_LABELS[arrow]}
                aria-label={EDGE_ARROW_LABELS[arrow]}
                onClick={() => onPatchEdges(ids, { arrow })}
              >
                <svg viewBox="0 0 34 12" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true">
                  <path d="M2 6h30" />
                  {arrow === 'target' || arrow === 'both' ? <path d="M27 2l4 4-4 4" /> : null}
                  {arrow === 'source' || arrow === 'both' ? <path d="M7 2L3 6l4 4" /> : null}
                </svg>
              </button>
            ))}
          </div>
        </Field>
        {edgeCount === 1 && (
          <>
            <Field label={`Leaves ${EDGE_SIDE_LABELS[sides.from]}`}>
              <div className="side-picker">
                {EDGE_SIDES.map((side) => (
                  <button
                    key={side}
                    type="button"
                    className={`side-picker__option${sides.from === side ? ' is-active' : ''}`}
                    title={`Leave ${EDGE_SIDE_LABELS[side].toLowerCase()}`}
                    aria-label={`Leave ${EDGE_SIDE_LABELS[side].toLowerCase()}`}
                    onClick={() => onPatchEdge(edge.id, { from: side })}
                  >
                    {EDGE_SIDE_ARROWS[side]}
                  </button>
                ))}
              </div>
            </Field>
            <Field label={`Arrives ${EDGE_SIDE_LABELS[sides.to]}`}>
              <div className="side-picker">
                {EDGE_SIDES.map((side) => (
                  <button
                    key={side}
                    type="button"
                    className={`side-picker__option${sides.to === side ? ' is-active' : ''}`}
                    title={`Arrive from the ${EDGE_SIDE_LABELS[side].toLowerCase()}`}
                    aria-label={`Arrive from the ${EDGE_SIDE_LABELS[side].toLowerCase()}`}
                    onClick={() => onPatchEdge(edge.id, { to: side })}
                  >
                    {EDGE_SIDE_ARROWS[side]}
                  </button>
                ))}
              </div>
            </Field>
          </>
        )}
        <Field label="Label">
          <input
            className="input"
            value={edge.label ?? ''}
            placeholder="e.g. uplink, 1 Gbps"
            onChange={(event) =>
              ids.length > 1 ? onPatchEdges(ids, { label: event.target.value }) : onPatchEdge(edge.id, { label: event.target.value })
            }
          />
        </Field>
        {edge.kind === 'route' && (
          <p className="inspector__note">
            Route links come from traceroute data and are rebuilt when a scan is imported – restyle or delete them freely.
          </p>
        )}
        <div className="inspector__footer">
          <button type="button" className="btn btn--tiny btn--danger" onClick={() => onDeleteEdges(ids)}>
            {ids.length > 1 ? `Delete ${ids.length} connections` : 'Delete connection'}
          </button>
        </div>
      </div>
    </aside>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="field">
      <span className="field__label">{label}</span>
      {children}
    </div>
  );
}
