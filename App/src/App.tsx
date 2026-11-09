import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Background,
  BackgroundVariant,
  Controls,
  MiniMap,
  ReactFlow,
  ReactFlowProvider,
  ViewportPortal,
  useEdgesState,
  useNodesState,
  useReactFlow,
  type Connection,
  type OnNodeDrag,
} from '@xyflow/react';

import { HostNode, HopNode, NoteNode, OriginNode, SectionNode } from './components/nodes';
import { alignmentGuides, type Guide } from './graph/guides';import { Inspector } from './components/Inspector';
import { LayerPanel } from './components/LayerPanel';
import { SelectionToolbar } from './components/SelectionToolbar';
import { ContextMenu, type MenuEntry } from './components/ContextMenu';
import { CommandPalette, type Command } from './components/CommandPalette';
import { HoverCard } from './components/HoverCard';
import { HelpButton } from './components/HelpPanel';
import { AccountButton } from './components/AccountButton';
import { AccountDialog } from './components/AccountDialog';
import { useAccount } from './account/useAccount';
import type { ProjectSummary } from './account/types';
import { buildRfGraph, type AppEdge, type AppNode } from './graph/buildRfGraph';
import {
  createDocFromScan,
  emptyDoc,
  type ImportMode,
} from './doc/docFromScan';
import { useDocHistory } from './doc/history';
import {
  MAIN_LAYER,
  edgeLine,
  edgePath,
  EDGE_LINES,
  EDGE_PATHS,
  EDGE_PATH_LABELS,
  isLayerVisible,
  layerMap,
  nodeTitle,
  type DiagramDoc,
  type DiagramNode,
} from './doc/types';
import { absolutePosition, nodeSize, sectionAt } from './doc/measure';
import {
  addLayer,
  addLink,
  arrangeSection,
  bringNodeZ,
  countNodesByLayer,
  createNode,
  deleteLayer,
  duplicateNode,
  moveLayer,
  patchEdge,
  patchNode,
  patchNodes,
  recolorLayer,
  releaseSectionSize,
  removeEdges,
  removeNodes,
  renameLayer,
  setFocusedLayer,
  setNodeSection,
  setSectionSize,
  toggleLayerVisible,
  alignNodes,
  distributeNodes,
  type NewNodeKind,
  type StackMode,
} from './doc/operations';
import { DesignOpenDialog, type DesignPreview } from './components/DesignOpenDialog';
import { FileHubDialog, type ExportFormat, type FileHubTab } from './components/FileHubDialog';
import { ImportPreviewBody } from './components/ImportPreview';
import { SaveStatus } from './components/SaveStatus';
import { useWorkspaceStore } from './hooks/useWorkspaceStore';
import { ShareDialog } from './components/ShareDialog';
import { PresenceChip } from './components/PresenceChip';
import { SharedCursors } from './components/SharedCursors';
import { useSharedSession } from './shared/useShared';
import { shareTokenFromLocation, type SharedTarget } from './shared/live';
import type { ImportSuccess } from './nmap/runImport';
import { openPorts } from './model/types';
import {
  RISK_SCOPE_LABEL,
  nodeRisk,
  normalizeDiagramRisk,
  normalizeRiskPolicy,
  resolveRiskPolicy,
  riskStats,
} from './doc/risk';
import { RiskLevelsDialog } from './components/RiskLevelsDialog';
import { RiskSummaryDialog } from './components/RiskSummaryDialog';
import { useExportFlow } from './hooks/useExportFlow';
import { useImportFlow, type LayerBatch } from './hooks/useImportFlow';
import { SAMPLE_FILE_NAME, SAMPLE_SCAN_XML } from './data/sampleScan';

const ONBOARDING_KEY = 'nmap2flowchart.onboardingDismissed';
const LEGACY_ONBOARDING_KEY = 'nmap2flowio.onboardingDismissed';
/** Canvas surface preference: dark for editing, light to match the exported page. */
const CANVAS_THEME_KEY = 'nmap2flowchart.canvasTheme';
/** Accent presets, cycled by clicking the logo. Green is the house colour. */
const ACCENT_KEY = 'nmap2flowchart.accent';
const ACCENTS = ['green', 'orange', 'purple'] as const;
type Accent = (typeof ACCENTS)[number];

const readAccent = (): Accent => {
  try {
    const stored = window.localStorage.getItem(ACCENT_KEY);
    return ACCENTS.includes(stored as Accent) ? (stored as Accent) : 'green';
  } catch {
    return 'green';
  }
};

const nodeTypes = {
  host: HostNode,
  section: SectionNode,
  note: NoteNode,
  hop: HopNode,
  origin: OriginNode,
};

/**
 * Nudges a new node off any card already sitting on that spot, so pressing the dock
 * twice never drops two cards exactly on top of each other.
 */
function freeSpot(doc: DiagramDoc, at: { x: number; y: number }) {
  const taken = doc.nodes.filter((node) => !node.parentId).map((node) => node.position);
  let point = at;
  for (let step = 0; step < 24 && taken.some((p) => Math.abs(p.x - point.x) < 8 && Math.abs(p.y - point.y) < 8); step += 1) {
    point = { x: point.x + 28, y: point.y + 28 };
  }
  return point;
}

function onboardingDismissed() {
  try {
    const dismissed =
      window.localStorage.getItem(ONBOARDING_KEY) === '1' ||
      window.localStorage.getItem(LEGACY_ONBOARDING_KEY) === '1';
    if (dismissed) {
      window.localStorage.setItem(ONBOARDING_KEY, '1');
      window.localStorage.removeItem(LEGACY_ONBOARDING_KEY);
    }
    return dismissed;
  } catch {
    return false;
  }
}

function Logo({ size = 38 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" aria-hidden="true" className="logo">
      <path d="M17 32Q32 14 47 32Q32 50 17 32Z" fill="none" stroke="currentColor" strokeWidth="4" strokeLinejoin="round" />
      <circle cx="32" cy="32" r="4.6" fill="currentColor" />
      <path d="M47 32h3.2M17 32h-3.2" stroke="currentColor" strokeWidth="3.8" strokeLinecap="round" />
      <path d="M50.2 32 55.4 25M50.2 32 55.4 39M13.8 32 8.6 25M13.8 32 8.6 39" stroke="currentColor" strokeWidth="3.6" strokeLinecap="round" />
      <circle cx="56.2" cy="24" r="4" fill="currentColor" />
      <circle cx="56.2" cy="40" r="4" fill="currentColor" />
      <circle cx="7.8" cy="24" r="4" fill="currentColor" />
      <circle cx="7.8" cy="40" r="4" fill="currentColor" />
    </svg>
  );
}

function Stat({ label, value, tone, optional }: { label: string; value: number; tone?: 'danger'; optional?: boolean }) {
  return (
    <div className={`stat${tone === 'danger' ? ' stat--danger' : ''}${optional ? ' stat--optional' : ''}`}>
      <span className="stat__value">{value}</span>
      <span className="stat__label">{label}</span>
    </div>
  );
}

function pointerOf(event: MouseEvent | TouchEvent): { x: number; y: number } | null {
  if ('changedTouches' in event) {
    const touch = event.changedTouches[0];
    return touch ? { x: touch.clientX, y: touch.clientY } : null;
  }
  return { x: (event as MouseEvent).clientX, y: (event as MouseEvent).clientY };
}

type MenuState =
  | { type: 'pane'; x: number; y: number; flow: { x: number; y: number } }
  | { type: 'node'; x: number; y: number; id: string; flow: { x: number; y: number } }
  | { type: 'edge'; x: number; y: number; id: string };

type MarqueeBox = { left: number; top: number; width: number; height: number };

/** A share link in the address bar turns this page into a joined room. */
const SHARE_TOKEN = shareTokenFromLocation();

function Canvas() {
  const account = useAccount();
  // The room this page belongs to: a share link, the owner's shared project, or a
  // `--shared` server. `null` is the normal browser-storage editor.
  const sharedTarget = useMemo<SharedTarget | null>(() => {
    if (SHARE_TOKEN) return { kind: 'link', token: SHARE_TOKEN };
    const share = account.activeProject?.share;
    if (share) return { kind: 'project', token: share.token };
    return SHARE_TOKEN === null ? { kind: 'server' } : null;
  }, [account.activeProject?.share]);
  const shared = useSharedSession(sharedTarget);
  const {
    ready: sharedReady,
    enabled: sharedEnabled,
    incoming: sharedIncoming,
    kind: sharedKind,
    canPublish: sharedCanPublish,
    readOnly: sharedReadOnly,
    publish: publishShared,
  } = shared;
  // A view-only link locks every mutation, including drags and inspector edits.
  const history = useDocHistory(null, { locked: shared.readOnly });
  const doc = history.doc;

  // A room or a share link owns its own storage, so the browser copy switches off.
  const { status: workspaceStatus, restore: restoreWorkspace } = useWorkspaceStore({
    doc,
    enabled: !sharedEnabled && !SHARE_TOKEN,
  });

  // Level colours come from the diagram first, then the account, then the
  // server-configured default, then the built-in three tiers.
  const diagramRisk = useMemo(() => normalizeDiagramRisk(doc?.risk), [doc?.risk]);
  const accountRisk = useMemo(() => normalizeRiskPolicy(account.riskPolicy), [account.riskPolicy]);
  const serverRisk = useMemo(() => normalizeRiskPolicy(account.features.risk), [account.features.risk]);
  const { policy: riskPolicy, scope: riskScope } = useMemo(
    () => resolveRiskPolicy({ diagram: diagramRisk, account: accountRisk, server: serverRisk }),
    [diagramRisk, accountRisk, serverRisk],
  );

  const [selection, setSelection] = useState<{ nodes: string[]; edges: string[] }>({ nodes: [], edges: [] });
  const [query, setQuery] = useState('');
  const [activeLayerId, setActiveLayerId] = useState(MAIN_LAYER);
  const [layersOpen, setLayersOpen] = useState(
    () => !window.matchMedia('(max-width: 760px)').matches,
  );
  const [toast, setToast] = useState<string | null>(null);
  const [toastUndo, setToastUndo] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [moreMenu, setMoreMenu] = useState(false);
  const [fileHubOpen, setFileHubOpen] = useState(false);
  const [fileHubTab, setFileHubTab] = useState<FileHubTab>('import');
  const [accountOpen, setAccountOpen] = useState(false);
  const [riskOpen, setRiskOpen] = useState(false);
  const [riskSummaryOpen, setRiskSummaryOpen] = useState(false);
  const [mobileSearchOpen, setMobileSearchOpen] = useState(false);
  const [dropLayerId, setDropLayerId] = useState<string | null>(null);
  const [dropSectionId, setDropSectionId] = useState<string | null>(null);
  const [nodeDragging, setNodeDragging] = useState(false);
  const [guides, setGuides] = useState<Guide[]>([]);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [linkSource, setLinkSource] = useState<string | null>(null);
  const [editingNote, setEditingNote] = useState<string | null>(null);
  const [hoverCard, setHoverCard] = useState<{ id: string; rect: { left: number; top: number; right: number; bottom: number } } | null>(null);
  const [menu, setMenu] = useState<MenuState | null>(null);
  const [marquee, setMarquee] = useState<MarqueeBox | null>(null);
  const [onboardingOpen, setOnboardingOpen] = useState(
    () => !onboardingDismissed(),
  );
  const [designPreview, setDesignPreview] = useState<DesignPreview | null>(null);
  const [overviewOpen, setOverviewOpen] = useState(false);
  const [legendOpen, setLegendOpen] = useState(false);
  const [onlyMatches, setOnlyMatches] = useState(false);
  const [snapSize, setSnapSize] = useState(16);
  const [theme, setTheme] = useState<'dark' | 'light'>(() => {
    try {
      return window.localStorage.getItem(CANVAS_THEME_KEY) === 'light' ? 'light' : 'dark';
    } catch {
      return 'dark';
    }
  });

  useEffect(() => {
    // `data-theme` on <html> so portals (dialogs, menus, toasts) inherit the theme.
    document.documentElement.dataset.theme = theme;
    try {
      window.localStorage.setItem(CANVAS_THEME_KEY, theme);
    } catch {
      // The theme is a preference, not state the diagram depends on.
    }
  }, [theme]);

  const [accent, setAccent] = useState<Accent>(readAccent);

  useEffect(() => {
    document.documentElement.dataset.accent = accent;
    try {
      window.localStorage.setItem(ACCENT_KEY, accent);
    } catch {
      // Same as the theme: a preference, nothing to recover.
    }
  }, [accent]);

  const cycleAccent = useCallback(() => {
    setAccent((current) => ACCENTS[(ACCENTS.indexOf(current) + 1) % ACCENTS.length]);
  }, []);
  const [gridMenu, setGridMenu] = useState(false);
  const [shareProjectId, setShareProjectId] = useState<string | null>(null);
  // The project the share dialog belongs to – kept by id so the dialog follows the
  // server's answer after a link is created, rotated or switched off.
  const shareTarget = useMemo<ProjectSummary | null>(() => {
    if (!shareProjectId) return null;
    const active = account.activeProject;
    if (active && active.id === shareProjectId) return active;
    return account.projects.find((project) => project.id === shareProjectId) ?? null;
  }, [shareProjectId, account.activeProject, account.projects]);
  /** True when the canvas is too narrow to share its bottom row with the minimap. */
  const [narrowCanvas, setNarrowCanvas] = useState(false);

  const effectiveLayerId = doc?.layers.some((layer) => layer.id === activeLayerId)
    ? activeLayerId
    : (doc?.layers[0]?.id ?? activeLayerId);

  const fileInput = useRef<HTMLInputElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const canvasRef = useRef<HTMLDivElement>(null);
  const layerPanelRef = useRef<HTMLElement>(null);
  const toastTimer = useRef<number | undefined>(undefined);
  const restored = useRef(false);
  const appliedSeq = useRef(0);
  const importMode = useRef<ImportMode>('merge');
  const marqueeStart = useRef<{ x0: number; y0: number; ox: number; oy: number } | null>(null);
  const marqueeClickGuard = useRef(false);
  const recentDowns = useRef<{ at: number; nodeId: string | null }[]>([]);
  const hoverTimer = useRef<number | undefined>(undefined);
  const { fitView, screenToFlowPosition, getZoom } = useReactFlow();

  const notify = useCallback((message: string) => {
    setToastUndo(false);
    setToast(message);
    window.clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => setToast(null), 3600);
  }, []);

  const notifyDeleted = useCallback((message: string) => {
    setToast(message);
    setToastUndo(true);
    window.clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => {
      setToast(null);
      setToastUndo(false);
    }, 5000);
  }, []);

  const {
    focusName,
    exportScope,
    exportDesign,
    exportRiskReport,
    exportMermaid,
    exportDrawio,
    exportSvgFile,
    exportPngFile,
    exportPdfFile,
  } = useExportFlow({ doc, riskPolicy, riskScope, query, notify });

  const closeMenus = useCallback(() => {
    setMoreMenu(false);
    setGridMenu(false);
  }, []);

  const toggleSection = useCallback(
    (id: string) => {
      history.commit((current) => {
        const node = current.nodes.find((item) => item.id === id);
        if (!node) return current;
        return patchNode(current, id, { collapsed: !node.collapsed });
      });
    },
    [history],
  );

  const layerRowAt = useCallback((x: number, y: number): string | null => {
    const rows = layerPanelRef.current?.querySelectorAll<HTMLElement>('[data-layer-id]');
    if (!rows) return null;
    for (const row of rows) {
      const rect = row.getBoundingClientRect();
      if (x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom) {
        return row.dataset.layerId ?? null;
      }
    }
    return null;
  }, []);


  const fitSoon = useCallback(() => {
    window.setTimeout(() => fitView({ padding: 0.16, duration: 380 }), 100);
  }, [fitView]);

  const loadDoc = useCallback(
    (next: DiagramDoc, message?: string) => {
      history.reset(next);
      setSelection({ nodes: [], edges: [] });
      setQuery('');
      setActiveLayerId(next.layers[0]?.id ?? MAIN_LAYER);
      notify(message ?? `${next.fileName} loaded`);
      fitSoon();
    },
    [history, notify, fitSoon],
  );

  // The Add dock is always on screen, so the minimap steps aside once the canvas
  // is too narrow for both of them in the bottom row.
  useEffect(() => {
    const element = canvasRef.current;
    if (!element || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(([entry]) => {
      const width = entry.contentRect.width;
      if (width > 0) setNarrowCanvas(width < 620);
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  const restoreProjectId = account.restoreProjectId;  const openAccountProject = account.openProject;
  const accountProjectId = account.activeProjectId;
  const accountSaveState = account.saveState;
  const accountError = account.error;
  const saveActiveProject = account.saveActiveProject;

  const reopenedProject = useRef(false);
  useEffect(() => {
    if (SHARE_TOKEN) return;
    if (reopenedProject.current || !restoreProjectId) return;
    reopenedProject.current = true;
    void (async () => {
      const project = await openAccountProject(restoreProjectId);
      if (project) loadDoc(project.doc, `“${project.name}” reopened from your account`);
    })();
  }, [restoreProjectId, openAccountProject, loadDoc]);

  useEffect(() => {
    if (SHARE_TOKEN) return;
    if (!doc || !accountProjectId) return;
    const timer = window.setTimeout(() => saveActiveProject(doc, accountProjectId), 1500);
    return () => window.clearTimeout(timer);
  }, [doc, accountProjectId, saveActiveProject]);

  const lastAccountError = useRef<string | null>(null);
  useEffect(() => {
    if (accountSaveState === 'saved') lastAccountError.current = null;
    if (accountSaveState !== 'error' || !accountError) return;
    if (lastAccountError.current === accountError) return;
    lastAccountError.current = accountError;
    notify(`Account save failed: ${accountError}`);
  }, [accountSaveState, accountError, notify]);

  useEffect(() => {
    if (!sharedReady || restored.current) return;
    restored.current = true;
    if (sharedEnabled) {
      // The room owns the diagram; nothing is read from, or written to, this browser.
      // (The owner's own project arrives through the account restore instead.)
      const sharedDoc = sharedKind === 'project' ? null : (sharedIncoming?.doc ?? null);
      if (sharedDoc) {
        history.reset(sharedDoc);
        window.setTimeout(() => fitView({ padding: 0.16 }), 120);
      }
      return;
    }
    void (async () => {
      const result = await restoreWorkspace();
      if (result.kind === 'restored') {
        history.reset(result.doc);
        if (result.location === 'session') notify('Recovered the workspace from this browser session');
        window.setTimeout(() => fitView({ padding: 0.16 }), 120);
      } else if (result.kind === 'unavailable') {
        notify('Browser storage is unavailable; open or save a workspace copy');
      }
    })();
  }, [
    history,
    fitView,
    sharedReady,
    sharedEnabled,
    sharedIncoming,
    sharedKind,
    notify,
    restoreWorkspace,
  ]);

  useEffect(() => {
    if (!doc) return;
    if (sharedCanPublish) {
      // Everyone on the link sees this change; the room saves it server-side.
      publishShared(doc);
    }
  }, [doc, sharedCanPublish, publishShared]);

  // Remote changes land as a plain replacement: they are not this user's edit, so
  // they do not become an undo step, and they wait for a drag or a note to finish.
  useEffect(() => {
    const incoming = shared.incoming;
    if (!incoming) return;
    // Each handed-over document is applied once – re-running this for a local edit
    // would otherwise replace it with the last document someone else sent.
    if (incoming.seq <= appliedSeq.current) return;
    if (nodeDragging || editingNote) return;
    appliedSeq.current = incoming.seq;
    if (!doc) {
      // Nobody had published a diagram yet – this is the first one.
      history.reset(incoming.doc);
      window.setTimeout(() => fitView({ padding: 0.16 }), 120);
      return;
    }
    history.replace(incoming.doc);
    if (incoming.conflict) notify('Another browser saved first – showing their version');
  }, [shared.incoming, nodeDragging, editingNote, doc, history, notify, fitView]);

  const marqueeActive = marquee !== null;
  useEffect(() => {
    if (!marqueeActive) return;
    const canvas = canvasRef.current;

    const move = (event: PointerEvent) => {
      const start = marqueeStart.current;
      if (!start) return;
      setMarquee({
        left: Math.min(start.x0, event.clientX) - start.ox,
        top: Math.min(start.y0, event.clientY) - start.oy,
        width: Math.abs(event.clientX - start.x0),
        height: Math.abs(event.clientY - start.y0),
      });
    };

    const finish = (event: PointerEvent) => {
      const start = marqueeStart.current;
      marqueeStart.current = null;
      setMarquee(null);
      if (!start || !canvas) return;
      const box = {
        left: Math.min(start.x0, event.clientX),
        right: Math.max(start.x0, event.clientX),
        top: Math.min(start.y0, event.clientY),
        bottom: Math.max(start.y0, event.clientY),
      };
      if (box.right - box.left < 4 && box.bottom - box.top < 4) return;
      marqueeClickGuard.current = true;

      const hits: string[] = [];
      for (const element of canvas.querySelectorAll<HTMLElement>('.react-flow__node')) {
        const id = element.dataset.id;
        if (!id) continue;
        const rect = element.getBoundingClientRect();
        if (element.classList.contains('react-flow__node-section')) {
          const covered =
            rect.left >= box.left &&
            rect.right <= box.right &&
            rect.top >= box.top &&
            rect.bottom <= box.bottom;
          if (covered) hits.push(id);
          continue;
        }
        const overlaps =
          rect.left < box.right && rect.right > box.left && rect.top < box.bottom && rect.bottom > box.top;
        if (overlaps) hits.push(id);
      }
      setSelection((current) => {
        const merged = [...current.nodes];
        for (const id of hits) if (!merged.includes(id)) merged.push(id);
        return { nodes: merged, edges: [] };
      });
      setEditingNote(null);
    };

    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', finish);
    return () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', finish);
    };
  }, [marqueeActive]);

  /**
   * Applies an import that has already been parsed and laid out – in the worker,
   * so this only updates the document and says what happened.
   */  const applyImport = useCallback(
    (result: ImportSuccess) => {
      const { doc: next, mode, fileName, added, gone, layerId } = result;
      const hosts = result.scan.hosts.length;

      if (!doc) {
        loadDoc(next, `${fileName}: ${hosts} hosts`);
        return;
      }

      history.commit(next);
      setSelection({ nodes: [], edges: [] });
      setQuery('');

      if (mode === 'replace') {
        setActiveLayerId(next.layers[0]?.id ?? MAIN_LAYER);
        notify(`Replaced with ${fileName} · ${hosts} hosts – undo restores the previous diagram`);
      } else if (mode === 'layer') {
        if (layerId) setActiveLayerId(layerId);
        notify(`“${fileName}” added as a new layer · ${added} nodes`);
      } else {
        notify(`${fileName}: ${added} new, ${gone} missing, ${hosts} hosts total – undo reverts the merge`);
      }
      fitSoon();
    },
    [doc, history, loadDoc, notify, fitSoon],
  );

  /**
   * Several scans added as layers arrive as one document; this commits it and
   * says how many files landed, including the ones that were not scans.
   */
  const applyLayerBatch = useCallback(
    ({ doc: next, layerId, added, ok, failed, designFile }: LayerBatch) => {
      if (added === 0) {
        notify(
          designFile
            ? 'A design file replaces the whole diagram – open it from Import / Open → Open design file.'
            : 'Those files are not nmap XML scans.',
        );
        return;
      }
      history.commit(next);
      if (layerId) setActiveLayerId(layerId);
      setSelection({ nodes: [], edges: [] });
      setQuery('');
      notify(`${ok} scan${ok === 1 ? '' : 's'} added as ${ok === 1 ? 'a layer' : 'layers'} · ${added} nodes`);
      if (failed > 0) notify(`${failed} file${failed === 1 ? '' : 's'} could not be read`);
      fitSoon();
    },
    [history, notify, fitSoon],
  );

  const imports = useImportFlow({
    doc,
    apply: applyImport,
    applyLayerBatch,
    onDesign: setDesignPreview,
    notify,
  });

  // A share link and a view-only room cannot import; everything else can.
  const canImport = !SHARE_TOKEN && !shared.readOnly;

  const openFileHub = useCallback((tab: FileHubTab) => {
    setFileHubTab(tab);
    setFileHubOpen(true);
  }, []);

  const exportFromHub = useCallback(
    (format: ExportFormat) => {
      closeMenus();
      setFileHubOpen(false);
      if (format === 'design') exportDesign();
      else if (format === 'mermaid') exportMermaid();
      else if (format === 'drawio') exportDrawio();
      else if (format === 'svg') exportSvgFile();
      else if (format === 'png') void exportPngFile();
      else void exportPdfFile();
    },
    [closeMenus, exportDesign, exportDrawio, exportMermaid, exportPdfFile, exportPngFile, exportSvgFile],
  );

  const handleFiles = useCallback(
    async (files: FileList | File[]) => {
      const mode = importMode.current;
      importMode.current = 'merge';
      await imports.importFiles(files, mode);
    },
    [imports.importFiles],
  );

  const loadSample = useCallback(() => {
    void imports.importText(SAMPLE_SCAN_XML, SAMPLE_FILE_NAME, 'replace');
  }, [imports.importText]);

  const confirmDesign = useCallback(
    (applyRisk: boolean) => {
      if (!designPreview) return;
      const next: DiagramDoc =
        applyRisk && designPreview.design.risk
          ? { ...designPreview.doc, risk: designPreview.design.risk.policy }
          : designPreview.doc;
      const { fileName } = designPreview;
      setDesignPreview(null);
      if (doc) {
        history.commit(next);
        setSelection({ nodes: [], edges: [] });
        setQuery('');
        setActiveLayerId(next.layers[0]?.id ?? MAIN_LAYER);
        notify(`${fileName} opened – undo restores the previous diagram`);
        fitSoon();
      } else {
        loadDoc(next, `${fileName} opened`);
      }
    },
    [designPreview, doc, fitSoon, history, loadDoc, notify],
  );

  const dismissOnboarding = useCallback(() => {
    window.localStorage.setItem(ONBOARDING_KEY, '1');
    setOnboardingOpen(false);
  }, []);

  const centerPoint = useCallback(() => {
    const rect = canvasRef.current?.getBoundingClientRect();
    return screenToFlowPosition({
      x: (rect?.left ?? 0) + (rect?.width ?? 900) / 2,
      y: (rect?.top ?? 0) + (rect?.height ?? 600) / 2,
    });
  }, [screenToFlowPosition]);

  const focusNoteInput = useCallback((id: string) => {
    const selector = `.react-flow__node[data-id="${CSS.escape(id)}"] textarea`;
    const attempt = (remaining: number) => {
      window.setTimeout(() => {
        const input = document.querySelector<HTMLTextAreaElement>(selector);
        if (input) {
          input.focus();
          input.setSelectionRange(input.value.length, input.value.length);
        } else if (remaining > 0) attempt(remaining - 1);
      }, 25);
    };
    attempt(12);
  }, []);

  const addNodeAt = useCallback(
    (kind: NewNodeKind, position: { x: number; y: number }, sectionId: string | null = null) => {
      if (!doc) {
        loadDoc(emptyDoc(), 'Blank diagram ready – use the dock to add nodes');
        return;
      }
      const intoSection = kind === 'host' ? sectionId : null;
      const { doc: next, id } = createNode(
        doc,
        kind,
        intoSection ? position : freeSpot(doc, position),
        effectiveLayerId,
        intoSection,
      );
      history.commit(next);
      // A node added into a section leaves the section selected, so the dock can
      // drop several hosts in a row without re-selecting it.
      if (next.nodes.find((node) => node.id === id)?.parentId) return;
      setSelection({ nodes: [id], edges: [] });
      setEditingNote(kind === 'note' ? id : null);
      if (kind === 'note') focusNoteInput(id);
    },
    [doc, effectiveLayerId, history, loadDoc, focusNoteInput],
  );

  const resizeSection = useCallback(
    (id: string, size: { w: number; h: number }) => {
      history.commit((current) => setSectionSize(current, id, size));
    },
    [history],
  );

  const resetSectionSize = useCallback(
    (id: string) => history.commit((current) => setSectionSize(current, id, null)),
    [history],
  );

  const tidySection = useCallback(
    (id: string) => {
      history.commit((current) => arrangeSection(current, id));
      notify('Section arranged into an even grid');
    },
    [history, notify],
  );

  const stackNode = useCallback(
    (id: string, mode: StackMode) => history.commit((current) => bringNodeZ(current, id, mode)),
    [history],
  );

  const shiftLayer = useCallback(
    (id: string, delta: -1 | 1) => history.commit((current) => moveLayer(current, id, delta)),
    [history],
  );

  const handleAddNode = useCallback(
    (kind: NewNodeKind) => {
      if (!doc) {
        loadDoc(emptyDoc(), 'Blank diagram ready – use the dock to add nodes');
        return;
      }
      const selected = selection.nodes.length === 1 ? doc.nodes.find((node) => node.id === selection.nodes[0]) : undefined;
      addNodeAt(kind, centerPoint(), selected?.kind === 'section' ? selected.id : null);
    },
    [doc, selection.nodes, centerPoint, loadDoc, addNodeAt],
  );

  const commands = useMemo<Command[]>(() => {
    const list: Command[] = [
      {
        id: 'import',
        group: 'File',
        label: 'Import or open…',
        hint: 'nmap XML, design file, blank canvas',
        run: () => openFileHub('import'),
      },
      {
        id: 'export',
        group: 'File',
        label: 'Export this diagram…',
        hint: 'Mermaid, draw.io, SVG, PNG, PDF',
        run: () => openFileHub('export'),
        disabled: !doc,
      },
      {
        id: 'save-copy',
        group: 'File',
        label: 'Download a design file',
        hint: '.nmap2flowchart.json',
        run: exportDesign,
        disabled: !doc,
      },
      {
        id: 'fit',
        group: 'View',
        label: 'Fit to diagram',
        run: () => fitView({ padding: 0.16, duration: 320 }),
        disabled: !doc,
      },
      {
        id: 'snap',
        group: 'View',
        label: snapSize ? 'Turn off grid snap' : 'Snap to a 16 px grid',
        run: () => setSnapSize(snapSize ? 0 : 16),
      },
      {
        id: 'legend',
        group: 'View',
        label: legendOpen ? 'Hide the legend' : 'Show the legend',
        run: () => setLegendOpen((open) => !open),
        disabled: !doc,
      },
      {
        id: 'undo',
        group: 'Edit',
        label: 'Undo',
        shortcut: 'Ctrl Z',
        run: history.undo,
        disabled: !history.canUndo,
      },
      {
        id: 'redo',
        group: 'Edit',
        label: 'Redo',
        shortcut: 'Ctrl Y',
        run: history.redo,
        disabled: !history.canRedo,
      },
      {
        id: 'accent',
        group: 'View',
        label: `Switch accent colour (${accent})`,
        hint: 'green → orange → purple',
        run: cycleAccent,
      },
      {
        id: 'add-host',
        group: 'Add',
        label: 'Add a host',
        run: () => handleAddNode('host'),
      },
      { id: 'add-hop', group: 'Add', label: 'Add a traceroute hop', run: () => handleAddNode('hop') },
      { id: 'add-section', group: 'Add', label: 'Add a section', run: () => handleAddNode('section') },
      { id: 'add-note', group: 'Add', label: 'Add a note', run: () => handleAddNode('note') },
      {
        id: 'risk',
        group: 'Review',
        label: 'Open the risk summary',
        run: () => setRiskSummaryOpen(true),
        disabled: !doc,
      },
    ];

    for (const layer of doc?.layers ?? []) {
      const focused = doc?.focusedLayerId === layer.id;
      list.push({
        id: `focus-${layer.id}`,
        group: 'Layers',
        label: focused ? `Stop focusing “${layer.name}”` : `Focus layer “${layer.name}”`,
        run: () =>
          history.commit((current) =>
            setFocusedLayer(current, current.focusedLayerId === layer.id ? null : layer.id),
          ),
      });
    }

    return list;
  }, [accent, cycleAccent, doc, exportDesign, fitView, handleAddNode, history, legendOpen, openFileHub, snapSize]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (!(event.ctrlKey || event.metaKey) || event.key.toLowerCase() !== 'k') return;
      event.preventDefault();
      setPaletteOpen((open) => !open);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const handleCanvasDoubleClick = useCallback(
    (event: React.MouseEvent<HTMLDivElement>) => {
      const target = event.target as HTMLElement;
      if (!target.closest('.react-flow__pane') || !doc) return;

      const pressed = recentDowns.current
        .filter((down) => event.timeStamp - down.at < 600 && down.nodeId)
        .map((down) => down.nodeId)
        .pop();
      if (pressed) {
        const node = doc.nodes.find((item) => item.id === pressed);
        if (node?.kind === 'note') {
          setSelection({ nodes: [pressed], edges: [] });
          setEditingNote(pressed);
        }
        return;
      }

      const under = document.elementFromPoint(event.clientX, event.clientY);
      if (under?.closest('.react-flow__node, .react-flow__edge, .react-flow__handle')) return;
      addNodeAt('note', screenToFlowPosition({ x: event.clientX, y: event.clientY }));
    },
    [doc, screenToFlowPosition, addNodeAt],
  );

  const startNoteEdit = useCallback(() => history.checkpoint(), [history]);
  const patchNoteText = useCallback(
    (id: string, notes: string) => history.replace((current) => patchNode(current, id, { notes })),
    [history],
  );

  const moveSelectionToLayer = useCallback(
    (layerId: string) => {
      if (!layerId) return;
      const ids = selection.nodes;
      if (ids.length === 0) return;
      history.commit((current) => {
        const target = new Set(ids);
        return {
          ...current,
          nodes: current.nodes.map((node) => {
            if (target.has(node.id)) return { ...node, layerId };
            if (node.parentId && target.has(node.parentId)) return { ...node, layerId };
            return node;
          }),
        };
      });
      const name = doc?.layers.find((layer) => layer.id === layerId)?.name ?? 'layer';
      notify(`Moved ${ids.length} ${ids.length === 1 ? 'node' : 'nodes'} to “${name}”`);
    },
    [doc, history, notify, selection.nodes],
  );

  const alignSelection = useCallback(
    (mode: 'left' | 'center' | 'right' | 'top' | 'middle' | 'bottom') => {
      if (selection.nodes.length < 2) return;
      history.commit((current) => alignNodes(current, selection.nodes, mode));
      notify(`Aligned ${selection.nodes.length} nodes`);
    },
    [history, notify, selection.nodes],
  );

  const distributeSelection = useCallback(
    (mode: 'horizontal' | 'vertical') => {
      if (selection.nodes.length < 3) return;
      history.commit((current) => distributeNodes(current, selection.nodes, mode));
      notify(`Distributed ${selection.nodes.length} nodes`);
    },
    [history, notify, selection.nodes],
  );

  const recolorSelection = useCallback(
    (color: string) => {
      history.commit((current) => patchNodes(current, selection.nodes, { accent: color }));
      notify(`Applied accent to ${selection.nodes.length} nodes`);
    },
    [history, notify, selection.nodes],
  );

  const startLink = useCallback(() => {
    if (selection.nodes.length !== 1) return;
    setLinkSource(selection.nodes[0]);
  }, [selection.nodes]);

  const cancelLink = useCallback(() => setLinkSource(null), []);

  const hideHover = useCallback(() => {
    window.clearTimeout(hoverTimer.current);
    setHoverCard(null);
  }, []);

  const handleNodeHover = useCallback((event: React.MouseEvent, node: AppNode) => {
    const element =
      (event.currentTarget as HTMLElement | null) ??
      canvasRef.current?.querySelector<HTMLElement>(`.react-flow__node[data-id="${CSS.escape(node.id)}"]`) ??
      null;
    const rect = element?.getBoundingClientRect();
    if (!rect) return;
    window.clearTimeout(hoverTimer.current);
    const anchor = { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom };
    hoverTimer.current = window.setTimeout(() => setHoverCard({ id: node.id, rect: anchor }), 280);
  }, []);

  const handleNodeHoverEnd = useCallback((_event: React.MouseEvent, node: AppNode) => {
    window.clearTimeout(hoverTimer.current);
    setHoverCard((current) => (current && current.id === node.id ? null : current));
  }, []);

  const handleNodeClick = useCallback(
    (event: React.MouseEvent, node: AppNode) => {
      const target = event.target as HTMLElement;
      if (target.closest('textarea, input, select, button')) return;
      const additive = event.shiftKey || event.ctrlKey || event.metaKey;
      hideHover();
      setEditingNote(null);
      setMenu(null);

      if (linkSource) {
        setSelection({ nodes: [node.id], edges: [] });
        const from = linkSource;
        setLinkSource(null);
        if (node.id === from) return;
        history.commit((current) => addLink(current, from, node.id));
        const name = (id: string) => {
          const target = doc?.nodes.find((item) => item.id === id);
          return target ? nodeTitle(target) : 'node';
        };
        notify(`Connected ${name(from)} → ${name(node.id)}`);
        return;
      }

      setSelection((current) => {
        if (!additive) return { nodes: [node.id], edges: [] };
        const already = current.nodes.includes(node.id);
        return {
          nodes: already ? current.nodes.filter((id) => id !== node.id) : [...current.nodes, node.id],
          edges: [],
        };
      });
    },
    [linkSource, history, notify, doc, hideHover],
  );

  const handleNodeDoubleClick = useCallback((_event: React.MouseEvent, node: AppNode) => {
    if (node.data?.node?.kind !== 'note') return;
    hideHover();
    setSelection({ nodes: [node.id], edges: [] });
    setEditingNote(node.id);
  }, [hideHover]);

  const openPaneMenu = useCallback(
    (event: React.MouseEvent | MouseEvent) => {
      event.preventDefault();
      hideHover();
      setMenu({
        type: 'pane',
        x: event.clientX,
        y: event.clientY,
        flow: screenToFlowPosition({ x: event.clientX, y: event.clientY }),
      });
    },
    [screenToFlowPosition, hideHover],
  );

  const openNodeMenu = useCallback(
    (event: React.MouseEvent, node: AppNode) => {
      event.preventDefault();
      hideHover();
      setEditingNote(null);
      setSelection((current) =>
        current.nodes.includes(node.id) ? current : { nodes: [node.id], edges: [] },
      );
      setMenu({
        type: 'node',
        x: event.clientX,
        y: event.clientY,
        id: node.id,
        flow: screenToFlowPosition({ x: event.clientX, y: event.clientY }),
      });
    },
    [screenToFlowPosition, hideHover],
  );

  const openEdgeMenu = useCallback((event: React.MouseEvent, edge: AppEdge) => {
    event.preventDefault();
    hideHover();
    setSelection((current) =>
      current.edges.includes(edge.id) ? current : { nodes: [], edges: [edge.id] },
    );
    setMenu({ type: 'edge', x: event.clientX, y: event.clientY, id: edge.id });
  }, [hideHover]);

  const deleteSelection = useCallback(() => {
    if (!doc) return;
    if (selection.nodes.length === 0 && selection.edges.length === 0) return;
    const nodes = selection.nodes;
    const edges = selection.edges;
    history.commit((current) => {
      const stripped = edges.length > 0 ? removeEdges(current, edges) : current;
      return nodes.length > 0 ? removeNodes(stripped, nodes) : stripped;
    });
    setSelection({ nodes: [], edges: [] });
    setEditingNote(null);
    const count = nodes.length + edges.length;
    notifyDeleted(`${count === 1 ? 'Item' : `${count} items`} deleted`);
  }, [doc, history, selection, notifyDeleted]);

  const withHiddenChildren = useCallback(
    (ids: string[]) => {
      if (!doc) return ids;
      const chosen = new Set(ids);
      const layers = layerMap(doc.layers);
      let grew = true;
      while (grew) {
        grew = false;
        for (const node of doc.nodes) {
          if (chosen.has(node.id) || !node.parentId || !chosen.has(node.parentId)) continue;
          if (!isLayerVisible(layers, node.layerId, doc.focusedLayerId)) continue;
          chosen.add(node.id);
          grew = true;
        }
      }
      return [...chosen];
    },
    [doc],
  );

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const tag = target?.tagName;
      const typing = tag === 'INPUT' || tag === 'TEXTAREA' || Boolean(target?.isContentEditable);
      const meta = event.ctrlKey || event.metaKey;

      if (!typing && (event.key === '/' || (meta && event.key.toLowerCase() === 'f'))) {
        event.preventDefault();
        if (window.matchMedia('(max-width: 760px)').matches) {
          setMobileSearchOpen(true);
          window.setTimeout(() => searchInputRef.current?.focus(), 0);
        } else {
          searchInputRef.current?.focus();
          searchInputRef.current?.select();
        }
        return;
      }

      if (!typing && !meta && event.key.toLowerCase() === 'f') {
        event.preventDefault();
        fitView({ padding: 0.16, duration: 320 });
        return;
      }

      if (!typing && !meta && event.key === '?') {
        event.preventDefault();
        window.dispatchEvent(new CustomEvent('nmap2flowchart:help'));
        return;
      }

      if (event.key === 'Escape') {
        if (typing) return;
        if (linkSource) setLinkSource(null);
        setMenu(null);
        setEditingNote(null);
        setGridMenu(false);
        return;
      }
      if (typing) return;

      if (event.key === 'Delete' || event.key === 'Backspace') {
        if (selection.nodes.length === 0 && selection.edges.length === 0) return;
        event.preventDefault();
        deleteSelection();
        return;
      }

      if (!meta) return;
      if (event.key.toLowerCase() === 'z') {
        event.preventDefault();
        if (event.shiftKey) history.redo();
        else history.undo();
      } else if (event.key.toLowerCase() === 'y') {
        event.preventDefault();
        history.redo();
      } else if (event.key.toLowerCase() === 'a') {
        event.preventDefault();
        const elements = canvasRef.current?.querySelectorAll<HTMLElement>('.react-flow__node') ?? [];
        const ids = [...elements]
          .map((element) => element.dataset.id)
          .filter((id): id is string => Boolean(id));
        setSelection({ nodes: withHiddenChildren(ids), edges: [] });
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [history, linkSource, selection, deleteSelection, withHiddenChildren, fitView]);

  const handleDragStop: OnNodeDrag<AppNode> = useCallback(
    (event, _node, dragged) => {
      const point = pointerOf(event);
      const target = point ? layerRowAt(point.x, point.y) : null;
      setDropLayerId(null);
      setDropSectionId(null);
      setNodeDragging(false);
      setGuides([]);

      const ids = new Set(dragged.map((node) => node.id));

      if (target) {
        const moved = dragged.some((node) => node.data.node?.layerId !== target);
        if (moved) {
          const affected =
            doc?.nodes.filter((node) => ids.has(node.id) || (node.parentId && ids.has(node.parentId))).length ??
            ids.size;
          history.commit((current) => ({
            ...current,
            nodes: current.nodes.map((node) => {
              if (ids.has(node.id)) return { ...node, layerId: target };
              if (node.parentId && ids.has(node.parentId)) return { ...node, layerId: target };
              return node;
            }),
          }));
          const layerName = doc ? (layerMap(doc.layers).get(target)?.name ?? 'layer') : 'layer';
          notify(`Moved ${affected} ${affected === 1 ? 'node' : 'nodes'} to “${layerName}”`);
        }
        return;
      }

      const grid = snapSize || 16;
      const moved = new Map(dragged.map((item) => ({
        x: snapSize ? Math.round(item.position.x / grid) * grid : item.position.x,
        y: snapSize ? Math.round(item.position.y / grid) * grid : item.position.y,
      })).map((position, index) => [dragged[index].id, position]));
      if (!doc) return;

      let next: DiagramDoc = {
        ...doc,
        nodes: doc.nodes.map((node) => {
          const position = moved.get(node.id);
          return position ? { ...node, position } : node;
        }),
      };

      let joined = new Map<string, number>();
      let left = 0;
      if (point) {
        for (const id of moved.keys()) {
          const node = next.nodes.find((item) => item.id === id);
          if (!node || node.kind === 'section') continue;
          const byId = new Map(next.nodes.map((item) => [item.id, item]));
          const absolute = absolutePosition(node, byId);
          const size = nodeSize(node);
          const hit = sectionAt(next.nodes, { x: absolute.x + size.w / 2, y: absolute.y + size.h / 2 }, { skip: id });
          if ((hit ?? null) === (node.parentId ?? null)) continue;
          next = setNodeSection(next, id, hit);
          if (hit) joined = joined.set(hit, (joined.get(hit) ?? 0) + 1);
          else left += 1;
        }
      }

      next = releaseSectionSize(
        next,
        [...moved.keys()].flatMap((id) => [
          doc.nodes.find((item) => item.id === id)?.parentId,
          next.nodes.find((item) => item.id === id)?.parentId,
        ]).filter((value): value is string => Boolean(value)),
      );

      history.commit(next);

      if (joined.size === 1) {
        const [[sectionId, count]] = [...joined.entries()];
        const section = next.nodes.find((item) => item.id === sectionId);
        notify(`Moved ${count} ${count === 1 ? 'node' : 'nodes'} into “${section ? nodeTitle(section) : 'section'}”`);
      } else if (joined.size > 1) {
        const total = [...joined.values()].reduce((sum, count) => sum + count, 0);
        notify(`Moved ${total} nodes into sections`);
      } else if (left > 0) {
        notify(`Removed ${left} ${left === 1 ? 'node' : 'nodes'} from ${left === 1 ? 'its' : 'their'} section`);
      }
    },
    [doc, history, layerRowAt, notify, snapSize],
  );

  const handleDrag: OnNodeDrag<AppNode> = useCallback(
    (event, node) => {
      const point = pointerOf(event);
      const target = point ? layerRowAt(point.x, point.y) : null;
      setDropLayerId((current) => (current === target ? current : target));

      const docNode = doc?.nodes.find((item) => item.id === node.id);
      let sectionId: string | null = null;
      if (point && !target && doc && docNode && docNode.kind !== 'section') {
        const byId = new Map(doc.nodes.map((item) => [item.id, item]));
        const absolute = absolutePosition({ ...docNode, position: node.position }, byId);
        const size = nodeSize(docNode);
        sectionId = sectionAt(
          doc.nodes,
          { x: absolute.x + size.w / 2, y: absolute.y + size.h / 2 },
          { skip: node.id },
        );
      }
      setDropSectionId((current) => (current === sectionId ? current : sectionId));

      // A hint that the card lines up with its neighbours; five screen pixels,
      // whatever the zoom level happens to be.
      if (doc && docNode) {
        setGuides(alignmentGuides(doc, docNode, node.position, 5 / Math.max(0.2, getZoom())));
      }
    },
    [doc, getZoom, layerRowAt],
  );

  const handleNodesDelete = useCallback(
    (deleted: AppNode[]) => {
      const ids = deleted.map((node) => node.id);
      history.commit((current) => removeNodes(current, ids));
      setSelection((current) => ({ ...current, nodes: current.nodes.filter((id) => !ids.includes(id)) }));
    },
    [history],
  );

  const handleEdgesDelete = useCallback(
    (deleted: AppEdge[]) => {
      const ids = deleted.map((edge) => edge.id);
      history.commit((current) => removeEdges(current, ids));
      setSelection((current) => ({ ...current, edges: current.edges.filter((id) => !ids.includes(id)) }));
    },
    [history],
  );

  const handleConnect = useCallback(
    (connection: Connection) => {
      if (!connection.source || !connection.target) return;
      history.commit((current) => addLink(current, connection.source as string, connection.target as string));
    },
    [history],
  );

  const onPatchNode = useCallback(
    (id: string, patch: Partial<DiagramNode>) => history.commit((current) => patchNode(current, id, patch)),
    [history],
  );

  const onPatchNodes = useCallback(
    (ids: string[], patch: Partial<DiagramNode>) => history.commit((current) => patchNodes(current, ids, patch)),
    [history],
  );

  const onDeleteNodes = useCallback(
    (ids: string[]) => {
      history.commit((current) => removeNodes(current, ids));
      setSelection({ nodes: [], edges: [] });
    },
    [history],
  );

  const handleDeleteNode = useCallback((id: string) => onDeleteNodes([id]), [onDeleteNodes]);

  const onDuplicateNode = useCallback(
    (id: string) => {
      const result = duplicateNode(history.doc ?? emptyDoc(), id);
      if (!result) return;
      history.commit(result.doc);
      setSelection({ nodes: [result.newId], edges: [] });
    },
    [history],
  );

  const openDesign = useCallback(() => {
    importMode.current = 'replace';
    fileInput.current?.click();
  }, []);
  const resetLayout = useCallback(() => {
    if (!doc) return;
    const fresh = createDocFromScan({
      fileName: doc.fileName,
      args: doc.args,
      hosts: doc.nodes.filter((node) => node.host).map((node) => node.host!),
    });
    const positions = new Map(fresh.nodes.map((node) => [node.id, node.position]));
    history.commit((current) => ({
      ...current,
      nodes: current.nodes.map((node) => {
        const position = positions.get(node.id);
        return position ? { ...node, position } : node;
      }),
    }));
    fitSoon();
    notify('Positions re-flowed from the scan layout');
  }, [doc, history, fitSoon, notify]);

  const menuEntries = useMemo<MenuEntry[]>(() => {
    if (!menu) return [];
    if (menu.type === 'edge') {
      const ids = selection.edges.includes(menu.id) ? selection.edges : [menu.id];
      const edge = doc?.edges.find((item) => item.id === menu.id);
      const current = edge ? edgeLine(edge) : 'solid';
      const currentPath = edge ? edgePath(edge) : 'curve';
      return [
        ...EDGE_LINES.map<MenuEntry>((line) => ({
          label: `${line[0].toUpperCase()}${line.slice(1)} line`,
          disabled: current === line,
          onSelect: () => history.commit((state) => ids.reduce((acc, id) => patchEdge(acc, id, { line }), state)),
        })),
        'separator',
        ...EDGE_PATHS.map<MenuEntry>((path) => ({
          label: `${EDGE_PATH_LABELS[path]} path`,
          disabled: currentPath === path,
          onSelect: () => history.commit((state) => ids.reduce((acc, id) => patchEdge(acc, id, { path }), state)),
        })),
        'separator',
        {
          label: ids.length > 1 ? `Delete ${ids.length} connections` : 'Delete connection',
          danger: true,
          onSelect: deleteSelection,
        },
      ];
    }
    if (menu.type === 'pane') {
      return [
        { label: 'New note here', onSelect: () => addNodeAt('note', menu.flow) },
        { label: 'New host here', onSelect: () => addNodeAt('host', menu.flow) },
        { label: 'New hop here', onSelect: () => addNodeAt('hop', menu.flow) },
        { label: 'New section here', onSelect: () => addNodeAt('section', menu.flow) },
        'separator',
        { label: 'Fit to diagram', onSelect: () => fitView({ padding: 0.16, duration: 320 }), disabled: !doc },
      ];
    }
    const node = doc?.nodes.find((item) => item.id === menu.id);
    const multi = selection.nodes.length > 1 && selection.nodes.includes(menu.id);
    const editEntry: MenuEntry[] =
      node?.kind === 'note'
        ? [
            {
              label: 'Edit note',
              onSelect: () => {
                setSelection({ nodes: [menu.id], edges: [] });
                setEditingNote(menu.id);
              },
            },
          ]
        : [];
    const sectionEntries: MenuEntry[] =
      node?.kind === 'section'
        ? [
            { label: 'Arrange cards in a grid', onSelect: () => tidySection(node.id) },
            { label: 'Auto-size frame', disabled: !node.manualSize, onSelect: () => resetSectionSize(node.id) },
          ]
        : [];
    const entries: MenuEntry[] = [...editEntry];
    entries.push(
      { label: 'Add note here', onSelect: () => addNodeAt('note', menu.flow) },
      { label: 'Duplicate', disabled: multi, onSelect: () => onDuplicateNode(menu.id) },
      'separator',
    );
    entries.push(...sectionEntries);
    if (sectionEntries.length > 0) entries.push('separator');
    entries.push(
      {
        label: node?.kind === 'section' ? 'Bring frame to front' : 'Bring to front',
        onSelect: () => stackNode(menu.id, 'front'),
      },
      {
        label: node?.kind === 'section' ? 'Send frame to back' : 'Send to back',
        onSelect: () => stackNode(menu.id, 'back'),
      },
      'separator',
      {
        label: multi ? `Delete ${selection.nodes.length} nodes` : 'Delete',
        danger: true,
        onSelect: () => (multi ? onDeleteNodes(selection.nodes) : onDeleteNodes([menu.id])),
      },
    );
    return entries;
  }, [menu, doc, selection.nodes, selection.edges, addNodeAt, deleteSelection, fitView, onDuplicateNode, onDeleteNodes, history, tidySection, resetSectionSize, stackNode]);

  const menuTitle = useMemo(() => {
    if (!menu) return '';
    if (menu.type === 'pane') return 'Canvas';
    if (menu.type === 'edge') return 'Connection';
    const node = doc?.nodes.find((item) => item.id === menu.id);
    return node ? nodeTitle(node) : 'Node';
  }, [menu, doc]);

  const hoveredNode = useMemo(() => {
    if (!hoverCard || !doc) return null;
    if (hoverCard.id === editingNote) return null;
    return doc.nodes.find((item) => item.id === hoverCard.id) ?? null;
  }, [hoverCard, doc, editingNote]);

  const hoveredChildren = useMemo(
    () => (hoveredNode ? (doc?.nodes.filter((item) => item.parentId === hoveredNode.id).length ?? 0) : 0),
    [hoveredNode, doc],
  );

  const counts = useMemo(() => (doc ? countNodesByLayer(doc) : new Map<string, number>()), [doc]);

  /** The selected section, if exactly one is selected – the dock adds hosts into it. */
  const dockSection = useMemo(() => {
    if (!doc || selection.nodes.length !== 1) return undefined;
    const node = doc.nodes.find((item) => item.id === selection.nodes[0]);
    return node?.kind === 'section' ? node : undefined;
  }, [doc, selection.nodes]);

  const stats = useMemo(() => {
    if (!doc) return null;
    const hosts = doc.nodes.filter((node) => node.host);
    const risk = riskStats(
      hosts.map((node) => node.host!),
      riskPolicy,
    );
    return {
      hosts: hosts.length,
      open: hosts.reduce((total, node) => total + openPorts(node.host!).length, 0),
      layers: doc.layers.length,
      risk,
      subnets: new Set(doc.nodes.filter((node) => node.kind === 'section' && node.cidr).map((node) => node.cidr)).size,
      services: new Set(hosts.flatMap((node) => node.host!.ports.filter((port) => openPorts(node.host!).some((open) => open === port)).map((port) => port.service ?? port.product).filter(Boolean))).size,
      routes: doc.nodes.filter((node) => node.kind === 'hop').length,
      hidden: doc.nodes.filter((node) => {
        const layer = layerMap(doc.layers).get(node.layerId);
        return !layer?.visible;
      }).length,
    };
  }, [doc, riskPolicy]);

  const graph = useMemo(
    () =>
      doc
        ? buildRfGraph(doc, {
            selectedNodeIds: selection.nodes,
            selectedEdgeIds: selection.edges,
            query,
            onlyMatches,
            riskPolicy,
            editingNoteId: editingNote,
            dropSectionId,
            onToggle: toggleSection,
            onSectionResize: resizeSection,
            onSectionTidy: tidySection,
            onNoteFocus: startNoteEdit,
            onNoteChange: patchNoteText,
            onStopEdit: () => setEditingNote(null),
            onDelete: handleDeleteNode,
          })
        : { nodes: [], edges: [] },
    [doc, selection, query, editingNote, dropSectionId, riskPolicy, toggleSection, resizeSection, tidySection, startNoteEdit, patchNoteText, handleDeleteNode],
  );

  const [nodes, setNodes, onNodesChange] = useNodesState<AppNode>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<AppEdge>([]);

  useEffect(() => {
    setNodes(graph.nodes);
    setEdges(graph.edges);
  }, [graph, setNodes, setEdges]);

  const cloudProject = account.activeProject;
  const accountTone =
    account.saveState === 'error' ? 'error' : account.saveState === 'saving' ? 'saving' : 'saved';
  const accountLabel =
    account.saveState === 'error'
      ? 'Account save failed'
      : account.saveState === 'saving'
        ? 'Saving to account…'
        : 'Saved to account';
  const accountTitle =
    account.saveState === 'error' && account.error
      ? account.error
      : cloudProject
        ? `“${cloudProject.name}” in your account · browser copy kept too`
        : undefined;

  return (
    <div
      className="app"
      onDragOver={(event) => {
        event.preventDefault();
        setDragging(true);
      }}
      onDragLeave={(event) => {
        if (event.currentTarget === event.target) setDragging(false);
      }}
      onDrop={(event) => {
        event.preventDefault();
        setDragging(false);
        importMode.current = 'merge';
        void handleFiles(event.dataTransfer.files);
      }}
    >
      <header className="topbar">
        <div className="brand">
          <button
            type="button"
            className="brand__mark"
            onClick={cycleAccent}
            title={`Accent colour: ${accent}`}
            aria-label={`Accent colour ${accent} – switch to ${ACCENTS[(ACCENTS.indexOf(accent) + 1) % ACCENTS.length]}`}
          >
            <Logo />
          </button>
          <div className="brand__text">
            <strong>NMAP2Flowchart</strong>
            <span>scan · diagram</span>
          </div>
        </div>

        <div className="topbar__stats">
          {stats && (
            <div className="topbar__counts">
              {stats.risk.levels
                .filter((entry) => entry.ports > 0)
                .slice(0, 1)
                .map((entry) => (
                  <div key={entry.level.id} className="stat" title={`${entry.level.label} ports`}>
                    <span className="stat__value" style={{ color: entry.level.color }}>
                      {entry.ports}
                    </span>
                    <span className="stat__label">{entry.level.label.toLowerCase()}</span>
                  </div>
                ))}
              <Stat label="hosts" value={stats.hosts} />
              <Stat label="open ports" value={stats.open} optional />
              <Stat label="layers" value={stats.layers} optional />
            </div>
          )}
          {doc && (
            <button
              type="button"
              className={`overview-button${overviewOpen ? ' is-on' : ''}`}
              aria-expanded={overviewOpen}
              onClick={() => {
                setRiskSummaryOpen(false);
                setOverviewOpen((open) => !open);
              }}
            >
              Overview
            </button>
          )}
          {doc && (
            <button
              type="button"
              className={`overview-button${riskSummaryOpen ? ' is-on' : ''}`}
              aria-expanded={riskSummaryOpen}
              title="Risk summary: levels, ports and hosts, with JSON/CSV export"              onClick={() => {
                setOverviewOpen(false);
                setRiskSummaryOpen((open) => !open);
              }}
            >
              Risk
            </button>
          )}
        </div>

        <div className="topbar__actions">
          {SHARE_TOKEN && (
            <span className={`share-badge${shared.readOnly ? ' is-view' : ''}`} title="You are on a share link">
              <b>{shared.title ?? 'Shared diagram'}</b>
              <em>{shared.readOnly ? 'view only' : 'live'}</em>
            </span>
          )}
          {shared.live ? (
            <PresenceChip live={shared.live} users={shared.users} status={shared.status} />
          ) : cloudProject ? (
            <span className={`autosave-status autosave-status--${accountTone}`} role="status" title={accountTitle}>
              {accountLabel}
            </span>
          ) : (
            <SaveStatus status={workspaceStatus} visible={Boolean(doc)} onSaveCopy={exportDesign} />
          )}
          {!SHARE_TOKEN && (
            <button
              type="button"
              className="btn btn--ghost btn--bordered workspace-save"
              disabled={!doc}
              title="Save the diagram as a file"
              onClick={exportDesign}
            >
              Save
            </button>
          )}
          {!SHARE_TOKEN && account.activeProject && (
            <button
              type="button"
              className={`btn btn--ghost share-button${account.activeProject.share ? ' is-on' : ''}`}
              title={
                account.activeProject.share
                  ? 'This project has a share link – manage it'
                  : 'Publish this project with a share link'
              }
              aria-haspopup="dialog"
              onClick={() => setShareProjectId(account.activeProject!.id)}
            >
              Share
            </button>
          )}
          {focusName && (
            <button
              type="button"
              className="focus-chip"
              onClick={() => doc && history.replace(setFocusedLayer(doc, null))}
              title="Stop focusing"
            >
              <span>focus</span>
              {focusName}
              <em>✕</em>
            </button>
          )}

          <div className="search">
            <input
              ref={searchInputRef}
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Filter ip, host, port…"
              spellCheck={false}
              aria-label="Filter diagram"
            />
            <kbd className="search__shortcut" aria-hidden="true">/</kbd>
            {query.trim().length > 0 && <span className="search__count">{graph.nodes.filter((node) => !node.data.dimmed).length}</span>}
            {query && (
              <button type="button" className="search__clear" aria-label="Clear diagram filter" onClick={() => setQuery('')}>
                ×
              </button>
            )}
          </div>

          <button
            type="button"
            className="btn btn--ghost btn--icon mobile-search-button"
            title="Search diagram"
            aria-label="Search diagram"
            aria-expanded={mobileSearchOpen}
            onClick={() => {
              setMobileSearchOpen(true);
              window.setTimeout(() => searchInputRef.current?.focus(), 0);
            }}
          >
            ⌕
          </button>

          {mobileSearchOpen && (
            <div className="mobile-search" role="search">
              <button
                type="button"
                className="mobile-search__back"
                aria-label="Close search"
                onClick={() => setMobileSearchOpen(false)}
              >
                ←
              </button>
              <input
                ref={searchInputRef}
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Escape') {
                    event.preventDefault();
                    setMobileSearchOpen(false);
                  }
                }}
                placeholder="Filter IP, host, port…"
                spellCheck={false}
                aria-label="Filter diagram"
              />
              <span className="mobile-search__count">
                {query ? `${graph.nodes.filter((node) => !node.data.dimmed).length} matches` : ''}
              </span>
              {query && (
                <button
                  type="button"
                  className="mobile-search__clear"
                  aria-label="Clear search"
                  onClick={() => setQuery('')}
                >
                  ×
                </button>
              )}
            </div>
          )}

          {!SHARE_TOKEN && (
            <AccountButton
              account={account}
              onOpen={() => {
                setAccountOpen(true);
              }}
            />
          )}

          <button
            type="button"
            className="btn btn--ghost"
            disabled={!doc}
            title="Fit diagram to view (F)"
            data-tooltip="Fit view (F)"
            onClick={() => fitView({ padding: 0.16, duration: 320 })}
          >
            Fit
          </button>
          <button
            type="button"
            className="btn btn--ghost btn--icon"
            disabled={!history.canUndo}
            title="Undo (Ctrl+Z)"
            data-tooltip="Undo (Ctrl+Z)"
            aria-label="Undo"
            onClick={history.undo}
          >
            ↶
          </button>
          <button
            type="button"
            className="btn btn--ghost btn--icon"
            disabled={!history.canRedo}
            title="Redo (Ctrl+Shift+Z)"
            data-tooltip="Redo (Ctrl+Shift+Z)"
            aria-label="Redo"
            onClick={history.redo}
          >
            ↷
          </button>
          <button
            type="button"
            className={`btn btn--ghost btn--icon${layersOpen ? ' is-on' : ''}`}
            title="Toggle layers panel"
            data-tooltip={layersOpen ? 'Hide layers' : 'Show layers'}
            aria-label={layersOpen ? 'Hide layers panel' : 'Show layers panel'}
            aria-expanded={layersOpen}
            onClick={() => setLayersOpen((open) => !open)}
          >
            ☰
          </button>

          <div className="menu-wrap">
            <button
              type="button"
              className="btn btn--ghost btn--icon"
              aria-label="More actions"
              aria-expanded={moreMenu}
              title="More actions"
              data-tooltip="More actions"
              onClick={() => setMoreMenu((open) => !open)}
            >
              ⋯
            </button>
            {moreMenu && (
              <>
                <div className="menu-backdrop" onClick={() => setMoreMenu(false)} />
                <div className="menu" role="menu">
                  {!SHARE_TOKEN && account.user && (
                    <>
                      <button
                        type="button"
                        role="menuitem"
                        onClick={() => {
                          closeMenus();
                          if (account.activeProject) setShareProjectId(account.activeProject.id);
                          else setAccountOpen(true);
                        }}
                      >
                        {account.activeProject ? `Share “${account.activeProject.name}”…` : 'Share a project…'}
                      </button>
                      <button
                        type="button"
                        role="menuitem"
                        onClick={() => {
                          closeMenus();
                          setAccountOpen(true);
                        }}
                      >
                        Projects – switch or create…
                      </button>
                      <div className="menu__sep" />
                    </>
                  )}
                  <p className="menu__note">{exportScope}</p>
                  {!sharedReadOnly && (
                    <>
                      <button
                        type="button"
                        role="menuitem"
                        onClick={() => {
                          closeMenus();
                          loadSample();
                        }}
                      >
                        Load sample scan
                      </button>
                      <button
                        type="button"
                        role="menuitem"
                        onClick={() => {
                          closeMenus();
                          importMode.current = 'replace';
                          fileInput.current?.click();
                        }}
                      >
                        New diagram from scan…
                      </button>
                      <button
                        type="button"
                        role="menuitem"
                        onClick={() => {
                          closeMenus();
                          importMode.current = 'layer';
                          fileInput.current?.click();
                        }}
                      >
                        Add scan as new layer…
                      </button>
                      <button
                        type="button"
                        role="menuitem"
                        disabled={!doc}
                        onClick={() => {
                          closeMenus();
                          resetLayout();
                        }}
                      >
                        Re-flow positions
                      </button>
                    </>
                  )}
                  <button
                    type="button"
                    role="menuitem"
                    disabled={!doc}
                    onClick={() => {
                      closeMenus();
                      exportDesign();
                    }}
                  >
                    Export design file (.json)
                  </button>
                  <button
                    type="button"
                    role="menuitem"
                    disabled={!doc}
                    onClick={() => {
                      closeMenus();
                      exportMermaid();
                    }}
                  >
                    Export mermaid
                  </button>
                  <button
                    type="button"
                    role="menuitem"
                    disabled={!doc}
                    onClick={() => {
                      closeMenus();
                      exportDrawio();
                    }}
                  >
                    Export draw.io
                  </button>
                  {!sharedReadOnly && (
                    <button
                      type="button"
                      role="menuitem"
                      disabled={!doc}
                      onClick={() => {
                        closeMenus();
                        setRiskOpen(true);
                      }}
                    >
                      Risk levels…
                    </button>
                  )}
                  <div className="menu__sep" />
                  <button
                    type="button"
                    role="menuitem"
                    disabled={!doc}
                    onClick={() => {
                      closeMenus();
                      exportSvgFile();
                    }}
                  >
                    Export SVG · vector print
                  </button>
                  <button
                    type="button"
                    role="menuitem"
                    disabled={!doc}
                    onClick={() => {
                      closeMenus();
                      void exportPngFile();
                    }}
                  >
                    Export PNG · 300 dpi
                  </button>
                  <button
                    type="button"
                    role="menuitem"
                    disabled={!doc}
                    onClick={() => {
                      closeMenus();
                      void exportPdfFile();
                    }}
                  >
                    Export PDF · plotter page
                  </button>
                </div>
              </>
            )}
          </div>

          <span className="topbar__divider" />
          <button
            type="button"
            className="btn btn--accent"
            disabled={imports.importing}
            aria-haspopup="dialog"
            aria-expanded={fileHubOpen}
            onClick={() => {
              // No diagram yet means the useful half of the panel is Import.
              openFileHub(doc ? 'export' : 'import');
            }}
          >
            {imports.importing ? 'Importing…' : canImport ? 'Import / Export' : 'Export'}
          </button>

          <button
            type="button"
            className="btn btn--ghost btn--icon theme-toggle"
            aria-label={theme === 'light' ? 'Switch to the dark theme' : 'Switch to the light theme'}
            aria-pressed={theme === 'light'}
            title={theme === 'light' ? 'Dark theme' : 'Light theme'}
            data-tooltip={theme === 'light' ? 'Dark theme' : 'Light theme'}
            onClick={() => setTheme((current) => (current === 'light' ? 'dark' : 'light'))}
          >
            {theme === 'light' ? (
              <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
                <path d="M20 14.4A8.4 8.4 0 0 1 9.6 4 8.6 8.6 0 1 0 20 14.4Z" />
              </svg>
            ) : (
              <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
                <circle cx="12" cy="12" r="4.2" />
                <path d="M12 3v2.2M12 18.8V21M3 12h2.2M18.8 12H21M5.6 5.6l1.6 1.6M16.8 16.8l1.6 1.6M18.4 5.6l-1.6 1.6M7.2 16.8l-1.6 1.6" />
              </svg>
            )}
          </button>

          <HelpButton shared={shared.enabled} />
          <input
            ref={fileInput}
            type="file"
            accept=".xml,.nmap,.json,application/json,application/xml,text/xml"
            multiple
            hidden
            onChange={(event) => {
              if (event.target.files) void handleFiles(event.target.files);
              event.target.value = '';
            }}
          />
        </div>
      </header>

      <main className="workspace">
        {doc && layersOpen && (
          <LayerPanel
            layers={doc.layers}
            activeLayerId={effectiveLayerId}
            focusedLayerId={doc.focusedLayerId}
            counts={counts}
            dropLayerId={dropLayerId}
            dragging={nodeDragging}
            panelRef={layerPanelRef}
            readOnly={shared.readOnly}
            onSelect={setActiveLayerId}
            onToggleVisible={(id) => history.replace(toggleLayerVisible(doc, id))}
            onFocus={(id) => history.replace(setFocusedLayer(doc, id))}
            onAdd={(parentId) => {
              const result = addLayer(doc, parentId);
              history.commit(result.doc);
              setActiveLayerId(result.id);
            }}
            onRename={(id, name) => history.commit(renameLayer(doc, id, name))}
            onRecolor={(id, color) => history.commit(recolorLayer(doc, id, color))}
            onDelete={(id, mode) => history.commit(deleteLayer(doc, id, mode))}
            onMove={shiftLayer}
          />
        )}
        {layersOpen && (
          <button
            type="button"
            className="mobile-drawer-backdrop"
            aria-label="Close layers panel"
            onClick={() => setLayersOpen(false)}
          />
        )}

        <div
          className={`canvas${narrowCanvas ? ' canvas--narrow' : ''}`}
          ref={canvasRef}
          onDoubleClick={handleCanvasDoubleClick}
          onPointerMove={(event) => {
            if (!shared.live) return;
            shared.live.sendCursor(screenToFlowPosition({ x: event.clientX, y: event.clientY }));
          }}
          onPointerLeave={() => shared.live?.sendCursor(null)}
          onClickCapture={(event) => {
            if (!marqueeClickGuard.current) return;
            marqueeClickGuard.current = false;
            event.stopPropagation();
            event.preventDefault();
          }}
          onPointerDownCapture={(event) => {
            marqueeClickGuard.current = false;
            const pressed = event.target as HTMLElement;
            recentDowns.current.push({
              at: event.timeStamp,
              nodeId: pressed.closest<HTMLElement>('.react-flow__node')?.dataset.id ?? null,
            });
            if (recentDowns.current.length > 8) recentDowns.current.shift();

            if (event.button !== 0 || !event.shiftKey) return;
            if (pressed.closest('textarea, input, select, [contenteditable="true"]')) return;
            const target = pressed;
            if (!target.closest('.react-flow__pane')) return;
            const rect = canvasRef.current?.getBoundingClientRect();
            if (!rect) return;
            event.stopPropagation();
            event.preventDefault();
            marqueeStart.current = { x0: event.clientX, y0: event.clientY, ox: rect.left, oy: rect.top };
            setMarquee({ left: event.clientX - rect.left, top: event.clientY - rect.top, width: 0, height: 0 });
            setMenu(null);
          }}
        >
          {doc && overviewOpen && stats && (
            <section className="diagram-overview" aria-label="Diagram overview">
              <div className="diagram-overview__header">
                <div>
                  <span className="diagram-overview__eyebrow" title={doc.fileName}>
                    {doc.fileName}
                  </span>
                  <strong>Diagram overview</strong>
                </div>
                <button type="button" aria-label="Close overview" onClick={() => setOverviewOpen(false)}>
                  ×
                </button>
              </div>

              <div className="overview-metrics">
                {[
                  { label: 'Hosts', value: stats.hosts, title: 'Hosts in this diagram' },
                  { label: 'Ports', value: stats.open, title: 'Open ports across every host' },
                  { label: 'Subnets', value: stats.subnets, title: 'Subnet sections' },
                  { label: 'Layers', value: stats.layers, title: 'Layers' },
                ].map((metric) => (
                  <div key={metric.label} className="overview-metric" title={metric.title}>
                    <strong>{metric.value}</strong>
                    <span>{metric.label}</span>
                  </div>
                ))}
              </div>

              <div className="overview-rows">
                <div>
                  <span>Routes / hops</span>
                  <b>{stats.routes}</b>
                </div>
                <div>
                  <span>Distinct services</span>
                  <b>{stats.services}</b>
                </div>
                <div>
                  <span>Hidden nodes</span>
                  <b>{stats.hidden}</b>
                </div>
              </div>

              <div className="overview-risk">
                <div className="overview-risk__head">
                  <span>Risk</span>
                  <b>{stats.risk.hosts} flagged</b>
                </div>
                <p className="overview-risk__scope">
                  Levels from {RISK_SCOPE_LABEL[riskScope]}
                </p>
                {stats.risk.hosts > 0 && (
                  <div className="overview-risk__bar" aria-hidden="true">
                    {stats.risk.levels
                      .filter((entry) => entry.hosts > 0)
                      .map((entry) => (
                        <span
                          key={entry.level.id}
                          style={{ background: entry.level.color, flexGrow: entry.hosts }}
                        />
                      ))}
                  </div>
                )}
                <ul className="overview-risk__levels">
                  {stats.risk.levels.map((entry) => (
                    <li key={entry.level.id} className={entry.hosts > 0 ? '' : 'is-empty'}>
                      <i style={{ background: entry.level.color }} />
                      <span className="overview-risk__label">{entry.level.label}</span>
                      <b>{entry.hosts}</b>
                      <span className="overview-risk__ports">{entry.ports} ports</span>
                    </li>
                  ))}
                  {stats.risk.levels.length === 0 && (
                    <li className="is-empty">
                      <span className="overview-risk__label">No risk levels enabled</span>
                    </li>
                  )}
                </ul>
                <button
                  type="button"
                  className="overview-risk__link"
                  onClick={() => {
                    setOverviewOpen(false);
                    setRiskSummaryOpen(true);
                  }}
                >
                  Open the risk summary →
                </button>
              </div>
            </section>
          )}
          {doc && legendOpen && (
            <section className="diagram-legend" aria-label="Diagram legend">
              <div><i className="legend-host" /> Host</div>
              <div><i className="legend-hop" /> Hop</div>
              <div><i className="legend-section" /> Section / subnet</div>
              <div><i className="legend-note" /> Note</div>
              <div><i className="legend-link" /> Link</div>
              {riskPolicy.levels
                .filter((level) => level.enabled)
                .map((level) => (
                  <div key={level.id}>
                    <i className="legend-risk" style={{ background: level.color }} />
                    {level.label} port
                  </div>
                ))}
              <button type="button" className="legend-edit" onClick={() => setRiskOpen(true)}>
                Edit risk levels…
              </button>
            </section>
          )}
          {doc && query.trim() && (
            <button
              type="button"
              className={`only-matches${onlyMatches ? ' is-on' : ''}`}
              aria-pressed={onlyMatches}
              onClick={() => setOnlyMatches((value) => !value)}
            >
              {onlyMatches ? 'Show all nodes' : 'Show only matches'}
            </button>
          )}
          <div className="canvas-tools">
            {doc && (
              <div className="menu-wrap">
                <button
                  type="button"
                  className={`grid-toggle${snapSize ? ' is-on' : ''}`}
                  aria-expanded={gridMenu}
                  aria-label={snapSize ? `Grid snap ${snapSize} px` : 'Grid snap off'}
                  title="Snap cards to the grid while dragging"
                  onClick={() => setGridMenu((open) => !open)}
                >
                  <svg viewBox="0 0 16 16" width="12" height="12" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.4">
                    <path d="M2 6h12M2 10h12M6 2v12M10 2v12" />
                  </svg>
                  {snapSize ? `${snapSize} px` : 'Off'}
                </button>
                {gridMenu && (
                  <>
                    <div className="menu-backdrop" onClick={() => setGridMenu(false)} />
                    <div className="menu grid-menu" role="menu">
                      <span className="grid-menu__title">Snap to grid</span>
                      {[0, 8, 16, 32, 64].map((size) => (
                        <button
                          key={size}
                          type="button"
                          role="menuitemradio"
                          aria-checked={snapSize === size}
                          className={snapSize === size ? 'is-active' : ''}
                          onClick={() => {
                            setSnapSize(size);
                            setGridMenu(false);
                          }}
                        >
                          {size === 0 ? 'Off – free placement' : `${size} px`}
                          {snapSize === size && <b aria-hidden="true">✓</b>}
                        </button>
                      ))}
                    </div>
                  </>
                )}
              </div>
            )}
            {doc && (
              <button
                type="button"
                className={`legend-toggle${legendOpen ? ' is-on' : ''}`}
                aria-expanded={legendOpen}
                onClick={() => setLegendOpen((open) => !open)}
              >
                Legend
              </button>
            )}
          </div>
          <ReactFlow
            nodes={nodes}
            edges={edges}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            nodeTypes={nodeTypes}
            onNodeClick={handleNodeClick}
            onNodeDoubleClick={handleNodeDoubleClick}
            onNodeMouseEnter={handleNodeHover}
            onNodeMouseLeave={handleNodeHoverEnd}
            onMoveStart={hideHover}
            onNodeContextMenu={openNodeMenu}
            onEdgeContextMenu={openEdgeMenu}
            onPaneContextMenu={openPaneMenu}
            onEdgeClick={(_event, edge) => setSelection({ nodes: [], edges: [edge.id] })}
            onPaneClick={() => {
              setSelection({ nodes: [], edges: [] });
              setLinkSource(null);
              setEditingNote(null);
              setMenu(null);
              hideHover();
            }}
            onNodeDragStart={() => {
              setNodeDragging(true);
              hideHover();
            }}
            onNodeDragStop={handleDragStop}
            onNodeDrag={handleDrag}
            autoPanOnNodeDrag={false}
            onNodesDelete={handleNodesDelete}
            onEdgesDelete={handleEdgesDelete}
            onConnect={handleConnect}
            nodesDraggable={!shared.readOnly}
            nodesConnectable={!shared.readOnly}
            onlyRenderVisibleElements
            deleteKeyCode={null}
            colorMode={theme}
            minZoom={0.08}
            maxZoom={2.2}
            snapToGrid={snapSize > 0}
            snapGrid={[snapSize || 16, snapSize || 16]}
            fitView
            panOnScroll
            panOnDrag={[0, 1]}
            selectionKeyCode={null}
            multiSelectionKeyCode={null}
            selectionOnDrag={false}
            zoomOnDoubleClick={false}
            connectionLineStyle={{ stroke: 'var(--accent)', strokeWidth: 2, strokeDasharray: '4 4' }}
            defaultEdgeOptions={{ type: 'default' }}
            proOptions={{ hideAttribution: false }}
          >
            <Background
              variant={BackgroundVariant.Dots}
              gap={24}
              size={1.5}
              color={theme === 'light' ? '#c3d0de' : '#222b38'}
            />
            <Controls showInteractive={false} position="bottom-left" />
            {!narrowCanvas && (
              <MiniMap
                pannable
                zoomable
                position="bottom-right"
                style={{ width: 176, height: 116 }}
                nodeColor={theme === 'light' ? '#c3d0de' : '#2f3d52'}
                nodeStrokeColor={theme === 'light' ? '#a9b8ca' : '#3d4d66'}
                maskColor={theme === 'light' ? 'rgba(233,239,247,0.72)' : 'rgba(6,9,14,0.78)'}
              />
            )}
            {guides.length > 0 && (
              <ViewportPortal>
                {guides.map((guide) => (
                  <div
                    key={`${guide.axis}-${Math.round(guide.at)}`}
                    className={`align-guide align-guide--${guide.axis}`}
                    style={
                      guide.axis === 'x'
                        ? { left: guide.at, top: guide.from, height: guide.to - guide.from }
                        : { top: guide.at, left: guide.from, width: guide.to - guide.from }
                    }
                  />
                ))}
              </ViewportPortal>
            )}
          </ReactFlow>

          <SharedCursors live={shared.live} />

          {marquee && (
            <div
              className="marquee"
              style={{ left: marquee.left, top: marquee.top, width: marquee.width, height: marquee.height }}
            />
          )}

          {menu && (
            <ContextMenu x={menu.x} y={menu.y} title={menuTitle} entries={menuEntries} onClose={() => setMenu(null)} />
          )}

          <CommandPalette open={paletteOpen} commands={commands} onClose={() => setPaletteOpen(false)} />

          {hoverCard && hoveredNode && (
            <HoverCard
          node={hoveredNode}
          anchor={hoverCard.rect}
          childCount={hoveredChildren}
          risk={nodeRisk(hoveredNode.host, riskPolicy)}
        />
          )}

          {linkSource && (
            <div className="canvas-banner">
              <span>Click the target node to connect it</span>
              <button type="button" className="btn btn--tiny" onClick={cancelLink}>
                Cancel
              </button>
            </div>
          )}

          {doc && !shared.readOnly && (
            <div className="canvas-dock">
              <span className="canvas-dock__label">Add</span>
              {(['host', 'hop', 'section', 'note'] as const).map((kind) => (
                <button
                  key={kind}
                  type="button"
                  className="dock-btn"
                  title={
                    kind === 'host' && dockSection
                      ? `Add a host inside ${nodeTitle(dockSection)}`
                      : `Add ${kind === 'hop' ? 'a hop' : kind === 'section' ? 'a section' : kind === 'note' ? 'a note' : 'a host'}`
                  }
                  onClick={(event) => {
                    event.currentTarget.blur();
                    handleAddNode(kind);
                  }}
                >
                  <b>+</b> {kind === 'host' ? 'Host' : kind === 'hop' ? 'Hop' : kind === 'section' ? 'Section' : 'Note'}
                </button>
              ))}
            </div>
          )}

          {doc && !shared.readOnly && (
            <SelectionToolbar
              doc={doc}
              nodeIds={selection.nodes}
              edgeIds={selection.edges}
              connecting={Boolean(linkSource)}
              onStartConnect={startLink}
              onCancelConnect={cancelLink}
              onMoveToLayer={moveSelectionToLayer}
              onAlign={alignSelection}
              onDistribute={distributeSelection}
              onRecolor={recolorSelection}
              onDuplicate={() => {
                if (selection.nodes[0]) onDuplicateNode(selection.nodes[0]);
              }}
              onDelete={deleteSelection}
              onClose={() => setSelection({ nodes: [], edges: [] })}
            />
          )}

          {onboardingOpen && !SHARE_TOKEN && (
            <div className={`onboarding${doc ? '' : ' onboarding--empty'}`} role="region" aria-label="Getting started">
              <button type="button" className="onboarding__close" onClick={dismissOnboarding} aria-label="Dismiss getting started">
                ×
              </button>
              <div className="onboarding__heading">
                <span>Quick start</span>
                <strong>Go from scan to shareable map in three steps</strong>
              </div>
              <ol>
                <li className={doc ? 'is-complete' : 'is-current'}>
                  <b>{doc ? '✓' : '1'}</b>
                  <span><strong>Import</strong>Drop XML or choose a sample</span>
                </li>
                <li className={doc && doc.nodes.length > 0 ? 'is-current' : ''}>
                  <b>2</b>
                  <span><strong>Arrange</strong>Move hosts, sections and notes</span>
                </li>
                <li>
                  <b>3</b>
                  <span><strong>Export</strong>Share as Mermaid or draw.io</span>
                </li>
              </ol>
            </div>
          )}

          {!doc && (
            <div className="empty-state">
              <Logo size={56} />
              <h1>{shared.enabled ? 'This shared diagram is empty' : 'Turn an nmap scan into a network map'}</h1>
              <p>
                {shared.enabled ? (
                  <>
                    Drop an <code>-oX</code> XML file anywhere on this page, or open a design file. It goes
                    live for everyone connected here.
                  </>
                ) : (
                  <>
                    Drop an <code>-oX</code> XML file anywhere on this page, or start from the bundled lab
                    scan. Everything on the canvas is editable afterwards.
                  </>
                )}
              </p>
              <pre>nmap -sV -sC --traceroute -oX scan.xml 10.0.0.0/24</pre>
              <div className="empty-state__actions">
                <button
                  type="button"
                  className="btn btn--accent"
                  onClick={() => openFileHub('import')}
                >
                  Import or open…
                </button>
                <button type="button" className="btn btn--ghost" onClick={loadSample}>
                  Sample scan
                </button>
                <button
                  type="button"
                  className="btn btn--ghost"
                  onClick={() => loadDoc(emptyDoc(), 'Blank diagram – use the Add dock to create nodes')}
                >
                  Blank canvas
                </button>
              </div>
              <p className="empty-state__hint">
                {shared.enabled
                  ? 'Everyone who opens this page edits the same diagram – changes appear on their screens as you make them.'
                  : account.user
                    ? `Signed in as ${account.user.username}. Diagrams save to your account and to this browser.`
                    : account.features.authEnabled
                      ? 'Everything stays in this browser tab unless you sign in. No scan data leaves your machine.'
                      : 'Everything stays in this browser tab – no scan data leaves your machine.'}
              </p>
            </div>
          )}

          {dragging && <div className="drop-overlay">Drop nmap XML or a saved diagram</div>}
        </div>

        {doc && !shared.readOnly && (
          <>
            <button
              type="button"
              className="mobile-drawer-backdrop mobile-inspector-backdrop"
              aria-label="Close inspector"
              tabIndex={-1}
              onClick={() => setSelection({ nodes: [], edges: [] })}
            />
            <Inspector
              doc={doc}
              riskPolicy={riskPolicy}
              nodeIds={selection.nodes}
              edgeIds={selection.edges}
              onPatchNode={onPatchNode}
              onPatchNodes={onPatchNodes}
              onSetSection={(id, sectionId) => history.commit(setNodeSection(doc, id, sectionId, 'append'))}
              onDeleteNodes={onDeleteNodes}
              onDuplicateNode={onDuplicateNode}
              onStackNode={stackNode}
              onArrangeSection={tidySection}
              onAutoSizeSection={resetSectionSize}
              onPatchEdge={(id, patch) => history.commit(patchEdge(doc, id, patch))}
              onPatchEdges={(ids, patch) =>
                history.commit((current) => ids.reduce((acc, id) => patchEdge(acc, id, patch), current))
              }
              onDeleteEdges={(ids) => {
                history.commit(removeEdges(doc, ids));
                setSelection({ nodes: [], edges: [] });
              }}
              onClose={() => setSelection({ nodes: [], edges: [] })}
            />
          </>
        )}
      </main>

      {toast && (
        <div className="toast" role="status">
          <span>{toast}</span>
          {toastUndo && (
            <button
              type="button"
              className="toast__undo"
              onClick={() => {
                history.undo();
                setToast(null);
                setToastUndo(false);
              }}
            >
              Undo
            </button>
          )}
        </div>
      )}

      {imports.preview && !fileHubOpen && (
        <div
          className="dialog-backdrop"
          role="presentation"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) imports.closePreview();
          }}
        >
          <section
            className="dialog import-preview"
            role="dialog"
            aria-modal="true"
            aria-labelledby="import-preview-title"
            onKeyDown={(event) => {
              if (event.key === 'Escape') {
                event.stopPropagation();
                imports.closePreview();
              }
            }}
          >
            <div className="dialog__header">
              <div>
                <span className="eyebrow">Import preview</span>
                <h2 id="import-preview-title">{imports.preview.fileName}</h2>
              </div>
              <button
                type="button"
                className="icon-button"
                aria-label="Close import preview"
                onClick={() => imports.closePreview()}
              >
                ×
              </button>
            </div>
            <ImportPreviewBody
              preview={imports.preview}
              effect={imports.previewEffect}
              hasDiagram={Boolean(doc)}
              onChooseMode={imports.chooseMode}
              onCancel={imports.closePreview}
              onConfirm={imports.confirmPreview}
            />
          </section>
        </div>
      )}

      <FileHubDialog
        open={fileHubOpen}
        tab={fileHubTab}
        onTabChange={setFileHubTab}
        hasDiagram={Boolean(doc)}
        canImport={canImport}
        preview={imports.preview}
        effect={imports.previewEffect}
        importing={imports.importing}
        exportScope={exportScope}
        onClose={() => {
          setFileHubOpen(false);
          // Dropping the panel must not leave a pending import behind, or the
          // standalone preview would pop up in its place.
          imports.cancelImport();
          imports.closePreview();
        }}
        onCancelReview={imports.closePreview}
        onChooseScan={() => {
          importMode.current = doc ? 'merge' : 'replace';
          fileInput.current?.click();
        }}
        onChooseLayers={() => {
          importMode.current = 'layer';
          fileInput.current?.click();
        }}
        onChooseDesign={openDesign}
        onBlank={() => {
          setFileHubOpen(false);
          loadDoc(emptyDoc(), 'Blank diagram – use the Add dock to create nodes');
        }}
        onSample={() => {
          setFileHubOpen(false);
          loadSample();
        }}
        onChooseMode={imports.chooseMode}
        onConfirm={imports.confirmPreview}
        onExport={exportFromHub}
        onCancelImport={imports.cancelImport}
      />
      {designPreview && (
        <DesignOpenDialog
          preview={designPreview}
          hasDoc={Boolean(doc)}
          onCancel={() => setDesignPreview(null)}
          onOpen={confirmDesign}
        />
      )}

      {shareTarget && (
        <ShareDialog
          open
          projectName={shareTarget.name}
          share={shareTarget.share ?? null}
          busy={account.busy}
          onShare={(mode, rotate) => void account.shareProject(shareTarget.id, mode, rotate)}
          onStop={() => void account.stopSharing(shareTarget.id)}
          onClose={() => setShareProjectId(null)}
        />
      )}

      <AccountDialog
        account={account}
        open={accountOpen}
        onClose={() => setAccountOpen(false)}
        doc={doc}
        onOpenProject={(project) => {
          loadDoc(project.doc, `“${project.name}” opened from your account`);
          setAccountOpen(false);
        }}
        onShareProject={(project) => {
          setAccountOpen(false);
          setShareProjectId(project.id);
        }}
      />

      <RiskLevelsDialog
        open={riskOpen}
        onClose={() => setRiskOpen(false)}
        doc={doc}
        policy={riskPolicy}
        scope={riskScope}
        diagramPolicy={diagramRisk}
        accountPolicy={accountRisk}
        serverPolicy={serverRisk}
        canUseAccount={Boolean(account.user)}
        onSaveDiagram={(policy) =>
          history.commit((current) => ({ ...current, risk: policy }))
        }
        onSaveAccount={(policy) => account.saveRiskPolicy(policy)}
      />

      <RiskSummaryDialog
        open={riskSummaryOpen}
        onClose={() => setRiskSummaryOpen(false)}
        doc={doc}
        policy={riskPolicy}
        policyScope={riskScope}
        onSelectNode={(nodeId) => {
          setSelection({ nodes: [nodeId], edges: [] });
          setRiskSummaryOpen(false);
        }}
        onExport={exportRiskReport}
      />
    </div>
  );
}

export default function App() {
  return (
    <ReactFlowProvider>
      <Canvas />
    </ReactFlowProvider>
  );
}
