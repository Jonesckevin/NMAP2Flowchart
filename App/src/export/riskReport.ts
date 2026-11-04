import type { RiskSummary } from '../doc/risk';

export type RiskReportScope = 'view' | 'diagram';

export type RiskReportMeta = {
  /** Source scan / workspace name, used in the header and the file name. */
  diagram: string;
  scope: RiskReportScope;
  /** Human sentence describing the scope, e.g. `current view · 3 cards hidden`. */
  scopeLabel: string;
  /** Which layer supplied the risk levels in force. */
  policyScope: string;
  /** ISO timestamp. */
  generated: string;
};

export type RiskReportRow = {
  level: string;
  priority: number;
  color: string;
  port: number;
  service: string;
  host: string;
  hostname: string;
  layer: string;
};

/** One row per flagged card/port pair – the shape both formats are built from. */
export function riskReportRows(summary: RiskSummary): RiskReportRow[] {
  const rows: RiskReportRow[] = [];
  for (const entry of summary.levels) {
    for (const port of entry.ports) {
      for (const host of port.hosts) {
        rows.push({
          level: entry.level.label,
          priority: entry.priority,
          color: entry.level.color,
          port: port.port,
          service: port.service,
          host: host.label,
          hostname: host.hostname,
          layer: host.layer,
        });
      }
    }
  }
  return rows;
}

const csvCell = (value: string | number) => {
  const text = String(value ?? '');
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
};

export function toRiskCsv(summary: RiskSummary, meta: RiskReportMeta): string {
  const header = ['level', 'priority', 'color', 'port', 'service', 'host', 'hostname', 'layer'];
  const lines = riskReportRows(summary).map((row) =>
    [row.level, row.priority, row.color, row.port, row.service, row.host, row.hostname, row.layer]
      .map(csvCell)
      .join(','),
  );
  // CRLF keeps Excel happy; the header row is what most reports key on.
  return [`# ${meta.diagram} · risk summary · ${meta.scopeLabel} · levels: ${meta.policyScope}`, header.join(','), ...lines].join(
    '\r\n',
  );
}

export function toRiskJson(summary: RiskSummary, meta: RiskReportMeta): string {
  return `${JSON.stringify(
    {
      generated: meta.generated,
      diagram: meta.diagram,
      scope: meta.scope,
      scopeLabel: meta.scopeLabel,
      riskLevelsSource: meta.policyScope,
      totals: { hosts: summary.hosts, openPorts: summary.open, distinctPorts: summary.ports },
      levels: summary.levels.map((entry) => ({
        id: entry.level.id,
        label: entry.level.label,
        priority: entry.priority,
        color: entry.level.color,
        spec: entry.level.ports,
        hosts: entry.topHosts,
        ports: entry.ports.map((port) => ({
          port: port.port,
          service: port.service || undefined,
          hosts: port.hosts.map((host) => ({
            label: host.label,
            hostname: host.hostname || undefined,
            layer: host.layer || undefined,
          })),
        })),
      })),
    },
    null,
    2,
  )}\n`;
}
