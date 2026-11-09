import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

type Tip = { keys: string; what: string };

const TIP_GROUPS: { title: string; tips: Tip[] }[] = [
  {
    title: 'Selecting',
    tips: [
      {
        keys: 'Hover a card',
        what: 'A floating summary shows its scan data – address, OS, ports and scripts – without selecting anything.',
      },
      {
        keys: 'Shift + drag',
        what: 'Marquee-select and add to the selection. A subnet frame joins in when the box covers the whole frame.',
      },
      { keys: 'Shift- or Ctrl-click', what: 'Add or remove a single node from the selection.' },
      {
        keys: 'Ctrl + A',
        what: 'Select everything drawn on the canvas, subnet frames included. Delete then clears the diagram.',
      },
      { keys: 'Right-click', what: 'Add a note, host, hop or section here; duplicate, delete or fit the view.' },
      {
        keys: '+ Host / Hop / Section / Note',
        what: 'The dock at the bottom of the canvas is always there. With a frame selected, every click adds another host into it and the frame stays selected – click the canvas to stop.',
      },
    ],
  },
  {
    title: 'Editing nodes',
    tips: [
      {
        keys: 'Select a frame, drag a corner',
        what: 'Resize a section by hand – smaller than its cards if you like. Moving a card inside hands the frame back to auto-size.',
      },
      {
        keys: 'Frame head → arrange',
        what: 'Snap every card in the section into an even grid and fit the frame to it.',
      },
      {
        keys: 'Inspector → Stacking',
        what: 'Front / Forward / Backward / Back restack a node inside its own layer. The layer list decides which layer sits on top.',
      },
      {
        keys: 'Drag a card into a frame',
        what: 'Drop it on a section to join that section; drag it out to leave. Cards stay inside the frame.',
      },
      { keys: 'Select → Section', what: 'Move a host to another /24 frame, or back to the free canvas.' },
      {
        keys: 'Inspector → Scan data',
        what: 'Addresses, hostnames, MACs, OS and ports are all editable – add as many of each as the host has.',
      },
      { keys: 'Select → Connect', what: 'Click a node, hit Connect, then click the second node. Esc cancels.' },
      {
        keys: 'Inspector → Change icon',
        what: 'Imports pick an icon from the hostname/vendor model, the fingerprinted platform, the NIC vendor and the open ports – in that order, so a router on OpenWrt stays a router. Change icon overrides it.',
      },
      {
        keys: 'Inspector → Accent',
        what: 'Give any card, note or frame its own colour: it becomes the border. Selecting a card turns the border green while it is selected, and a risk level colour always outranks the accent – then the accent shows as a stripe on the left edge instead.',
      },
      {
        keys: 'Risk',
        what: 'Opens the risk summary: every level, the ports that raised it and the hosts listening on them. Switch between the current view and the whole diagram, filter the tree, then export JSON or CSV for a report.',
      },
      {
        keys: 'Drag a node by its dot',
        what: 'Drop on another node to draw a connection. Sections have dots too, so you can link subnets.',
      },
      {
        keys: 'Select a link',
        what: 'Pick a Path (Curve, Straight, Step, Square) and a Line (Solid, Dashed, Dotted) in the inspector, or from the right-click menu on the link.',
      },
      {
        keys: 'Add → Hop',
        what: 'Hops come from traceroute. Nmap only reports an address and a TTL per hop, so hops carry no ports or OS.',
      },
    ],
  },
  {
    title: 'Notes & layers',
    tips: [
      { keys: 'Double-click canvas', what: 'New sticky note where you clicked – it is focused, just start typing.' },
      { keys: 'Double-click a note', what: 'Open it for typing. Esc leaves editing – the note stays selected.' },
      {
        keys: 'Drag node → layer row',
        what: 'Drop a node (or a whole section) on the layers panel to move it. Sections take their hosts.',
      },
      {
        keys: 'Layer ▴ / ▾',
        what: 'Shift a layer up or down. The list is the stacking order: the top row draws over everything below it, and new layers arrive on top.',
      },
      {
        keys: 'Double-click a layer name',
        what: 'Rename it. The eye hides it, ◎ focuses it, and exports follow the focus.',
      },
      {
        keys: 'Drag the panel edge',
        what: 'Resize the layers panel – double-click the edge to go back to the default width. The width is remembered in this browser.',
      },
      {
        keys: '⋯ → Add scan as new layer',
        what: 'Drop in another scan file and it lands on its own layer. Pick several files to get one layer each; the newest becomes active. The import preview opens with New layer already selected.',
      },
    ],
  },
  {
    title: 'Canvas & output',
    tips: [
      { keys: 'Drag, middle-drag', what: 'Pan with the left or middle mouse button. Scroll to pan, Ctrl+scroll to zoom, Fit to reset.' },
      {
        keys: 'Grid ▾ (bottom right)',
        what: 'Snap dragged cards to a 8 / 16 / 32 / 64 px grid, or turn snapping off for free placement. Sits next to Legend.',
      },
      { keys: 'Delete / Ctrl+Z', what: 'Remove the selection (several nodes at once) / undo. Ctrl+Shift+Z redoes.' },
      {
        keys: '⋯ → Risk levels',
        what: 'Decide which ports count as risky: per level a name, a colour and a list of ports or ranges (8000-8100). The list is the hierarchy – the top level wins, so a red port outranks an orange one. Save to this diagram, to your account, or leave the diagram inheriting the server default. Common ports… opens a reference of well-known service ports with the level each one falls into.',
      },
      {
        keys: 'Filter “risk:…”',
        what: 'risk:any (or risk:) flags every host with a matched port, risk:high the ones at the top level, and risk:critical / risk:medium / risk:low a level by name.',
      },
      {
        keys: '⋯ → Export SVG / PNG / PDF',
        what: 'Print-ready output on a white page: vector SVG, 300 dpi PNG, or one PDF page sized to the diagram for plotter prints.',
      },
      {
        keys: 'Import / Export',
        what: 'One panel for files. Import / Open takes an nmap XML scan (reviewed before it lands, then Merge, Replace or New layer), adds scans as new layers, reopens a design file, starts a blank diagram, or loads the sample scan. Export writes the design file, Mermaid, draw.io, SVG, PNG or PDF, and states the scope first. On an empty canvas the button opens on Import; with a diagram open it opens on Export.',
      },
      {
        keys: 'Save',
        what: 'The shortcut beside the filter saves the whole diagram as a design file – the same export as Import / Export → Design file (.json).',
      },
      {
        keys: 'Export → design file',
        what: 'The first row of the Export tab saves the whole diagram – layers, positions, notes, connections and its risk levels – as one file another instance can open.',
      },
      {
        keys: 'Export tab',
        what: 'The note at the top states the picture scope before you pick a format – the focused layer, hidden nodes, and whether the canvas filter is ignored.',
      },
      {
        keys: 'Risk panel → Export',
        what: 'The Risk panel lists the ports behind each level and honours its filter. Export current view writes exactly the rows the search left, and Export all writes every card in the diagram (hidden ones included), as CSV or JSON.',
      },
      {
        keys: 'Mermaid / draw.io',
        what: 'Export a text diagram you can paste into a wiki or open in draw.io.',
      },
      {
        keys: 'Live chip (shared server)',
        what: 'Only on a server started with --shared: the chip counts the browsers on the diagram, lists who they are with their address, and lets you rename yourself. Everyone edits the same drawing – changes and pointers show up on the other screens as you go.',
      },
      {
        keys: 'Share (account project)',
        what: 'Publish a project as a link – from the Share button, from ⋯ → Share “project”…, or from the Share action on a row in the project list. “Can edit” makes it a live room – everyone on the link sees your changes and you see theirs, with pointers and presence. “View only” gives the same room with the editor locked: no add buttons, no layer edits, exports only. New link retires the old one; Stop sharing switches it off.',
      },
      {
        keys: 'Ctrl / Cmd + K',
        what: 'Command palette: type what you want to do – add a host or note, focus a layer, fit, toggle snap or the legend, undo, open the risk summary or the export panel – and press Enter. Arrow keys move, Escape closes.',
      },
      {
        keys: 'Drag a card',
        what: 'Thin guides appear when the card’s left, centre or right edge (and its top, middle or bottom) lines up with another card, so a row of hosts can be straightened by eye. ⋯ → Re-flow positions redoes the whole layout.',
      },
      {
        keys: 'Logo',
        what: 'Click the logo to cycle the accent colour: green (the default), orange, then purple. It repaints the buttons, focus rings, links, the save meter, the canvas arrows and the logo itself, and the choice is remembered in this browser.',
      },
      {
        keys: 'Sun / moon icon',
        what: 'Switches the whole editor between the dark theme (default) and a light one whose diagram matches the white page the exports print. The icon shows the theme it switches to and the choice is remembered in this browser.',
      },
      {
        keys: 'Recoverable error',
        what: 'If the editor throws, it shows a page that names the failure and offers the last autosaved copy as a design file, a reload, or an empty canvas – so a broken panel cannot strand a diagram in browser storage.',
      },
      {
        keys: 'Saved locally',
        what: 'The chip beside the filter says whether this diagram is safe in this browser and opens a panel with the detail: where it is kept (IndexedDB, or the small localStorage fallback), how big the diagram is, how much room the site has left, and when it last saved. If a write cannot be made, the panel says so and offers the diagram as a download instead. Nothing is uploaded – Import / Export → Design file is how a copy leaves the machine.',
      },
      {
        keys: 'Account chip → Projects',
        what: 'When the server enables accounts, sign in or continue as a guest to save diagrams to the account. The chip shows the open project – click it for the project list, where Open switches the editor to another project, Share publishes a row with a link, and Save as new project stores the diagram you have open. The dot shows the save state; without accounts everything stays in this browser.',
      },
    ],
  },
];

export function HelpButton({ shared = false }: { shared?: boolean }) {
  const [open, setOpen] = useState(false);
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set());
  const dialogRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  const toggleGroup = (title: string) =>
    setCollapsed((current) => {
      const next = new Set(current);
      if (next.has(title)) next.delete(title);
      else next.add(title);
      return next;
    });

  useEffect(() => {
    const showHelp = () => setOpen(true);
    window.addEventListener('nmap2flowchart:help', showHelp);
    return () => window.removeEventListener('nmap2flowchart:help', showHelp);
  }, []);

  useEffect(() => {
    if (!open) return;
    const previous = document.activeElement as HTMLElement | null;
    const dialog = dialogRef.current;
    dialog?.querySelector<HTMLButtonElement>('button')?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.stopPropagation();
      setOpen(false);
    };
    window.addEventListener('keydown', onKey, true);
    return () => {
      window.removeEventListener('keydown', onKey, true);
      (previous ?? triggerRef.current)?.focus();
    };
  }, [open]);

  return (
    <div className="menu-wrap">
      <button
        ref={triggerRef}
        type="button"
        className="btn btn--ghost btn--icon help-button"
        title="How to edit"
        data-tooltip="How to edit"
        aria-label="How to edit"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        ?
      </button>
      {open &&
        createPortal(
          <div className="help-modal" role="dialog" aria-modal="true" aria-labelledby="help-title">
            <div className="help-modal__scrim" onClick={() => setOpen(false)} />
            <div
              ref={dialogRef}
              className="help-modal__card"
              onKeyDown={(event) => {
                if (event.key !== 'Tab') return;
                const focusable = [...dialogRef.current?.querySelectorAll<HTMLElement>(
                  'button:not([disabled]), a[href], input:not([disabled]), [tabindex]:not([tabindex="-1"])',
                ) ?? []];
                if (focusable.length === 0) return;
                const first = focusable[0];
                const last = focusable[focusable.length - 1];
                if (event.shiftKey && document.activeElement === first) {
                  event.preventDefault();
                  last.focus();
                } else if (!event.shiftKey && document.activeElement === last) {
                  event.preventDefault();
                  first.focus();
                }
              }}
            >
              <header className="help-modal__head">
                <div>
                  <span className="help-modal__eyebrow">Cheat sheet</span>
                  <h2 id="help-title">How to edit</h2>
                </div>
                <button type="button" className="icon-button" onClick={() => setOpen(false)} aria-label="Close help">
                  ✕
                </button>
              </header>
              <div className="help-modal__body">
                {TIP_GROUPS.map((group) => {
                  const isCollapsed = collapsed.has(group.title);
                  return (
                    <section
                      key={group.title}
                      className={`help-section${isCollapsed ? ' is-collapsed' : ''}`}
                    >
                      <button
                        type="button"
                        className="help-section__head"
                        aria-expanded={!isCollapsed}
                        onClick={() => toggleGroup(group.title)}
                      >
                        <span className="help-section__caret" aria-hidden="true">
                          ▸
                        </span>
                        <span className="help-section__title">{group.title}</span>
                        <span className="help-section__count">{group.tips.length}</span>
                      </button>
                      {!isCollapsed && (
                        <ul className="help-section__list">
                          {group.tips.map((tip) => (
                            <li key={tip.keys}>
                              <span className="help-panel__keys">{tip.keys}</span>
                              <span>{tip.what}</span>
                            </li>
                          ))}
                        </ul>
                      )}
                    </section>
                  );
                })}
              </div>
              <p className="help-panel__foot">
                {shared ? (
                  <>
                    This server keeps the diagram and shares it with everyone connected. Save a{' '}
                    <code>.nmap2flowchart.json</code> design file to keep a copy.
                  </>
                ) : (
                  <>
                    Everything is stored in this browser tab. Save a <code>.nmap2flowchart.json</code> design
                    file to keep a copy or open it in another instance.
                  </>
                )}
              </p>            </div>
          </div>,
          document.body,
        )}
    </div>
  );
}
