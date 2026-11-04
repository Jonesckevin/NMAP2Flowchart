/**
 * NMAP → draw.io import plugin.
 *
 * Adds "NMAP: import scan…" to the File and Extras menus. The chosen `nmap -oX`
 * scan is added on its own draw.io layer: one container frame per /24 (or /64)
 * subnet, one card per host, and the traceroute lane above the diagram.
 *
 * This file is self-contained: it imports nothing, needs no build step and is
 * mounted into the draw.io webapp as-is. The sample scan in ../samples/ is the
 * only other file it ever asks for, and only when the user clicks "Load sample
 * scan" in the import dialog.
 *
 * The parsing, subnet grouping, layout numbers and cell styles deliberately
 * mirror the main app so a draw.io diagram and an app diagram of the same scan
 * look the same. Those App/ paths are references for whoever maintains both —
 * nothing is loaded from them at runtime:
 *
 *   App/src/nmap/parseNmapXml.ts   → parseScanXml
 *   App/src/graph/layout.ts        → groupHosts / layoutScan
 *   App/src/doc/docFromScan.ts     → insertScan (origin, hops, sections, route edges)
 *   App/src/export/drawio.ts       → the *_STYLE constants and the labels
 *
 * draw.io calls the callback registered through Draw.loadPlugin once the editor
 * UI exists (see "Long-term supported solution for access to the EditorUi
 * instance" in drawio's js/diagramly/App.js).
 */
(function () {
  'use strict';

  // Resolved while this script is parsing, so ../samples/ can be fetched even
  // when the plugin is served from a different path (or a different host).
  var SCRIPT_URL = (typeof document !== 'undefined' && document.currentScript && document.currentScript.src) || '';

  var ACTION_ID = 'nmapImport';
  var MENU_RESOURCE = 'nmapImport=NMAP: import scan…';
  var DIAGRAM_PADDING = 40;

  // ---------------------------------------------------------------------------
  // Geometry — mirror of App/src/graph/layout.ts
  // ---------------------------------------------------------------------------
  var HOST_W = 216;
  var HOST_H = 96;
  var HOP_W = 156;
  var HOP_H = 54;
  var ORIGIN_W = 268;
  var ORIGIN_H = 68;
  var PAD = 24;
  var HEADER_H = 44;
  var H_GAP = 16;
  var V_GAP = 14;
  var SUBNET_GAP = 36;
  var MAX_ROW_W = 1760;
  var MAX_COLS = 4;

  // ---------------------------------------------------------------------------
  // Cell styles — mirror of App/src/export/drawio.ts
  // ---------------------------------------------------------------------------
  var SECTION_STYLE =
    'rounded=0;html=1;dashed=1;dashPattern=6 6;fillColor=#f6f8fb;strokeColor=#b6c1d1;verticalAlign=top;align=left;spacingLeft=12;spacingTop=6;fontColor=#5a6a7d;fontStyle=1;fontSize=12;container=1;dropTarget=1;collapsible=0;';
  var HOST_STYLE =
    'rounded=1;html=1;whiteSpace=wrap;fillColor=#ffffff;strokeColor=#c3ccd9;align=left;verticalAlign=top;spacingLeft=10;spacingTop=8;spacingRight=8;fontSize=11;fontColor=#111827;arcSize=8;';
  var HOST_DOWN_STYLE = 'strokeColor=#b6c1d1;dashed=1;fillColor=#f7f8fa;fontColor=#6b7280;';
  var HOP_STYLE =
    'rounded=1;html=1;whiteSpace=wrap;fillColor=#eef2f7;strokeColor=#b6c1d1;fontSize=11;fontColor=#334155;arcSize=40;';
  var ORIGIN_STYLE =
    'rounded=1;html=1;whiteSpace=wrap;fillColor=#1f2937;strokeColor=#0f172a;fontColor=#f8fafc;fontSize=11;align=left;spacingLeft=12;verticalAlign=middle;arcSize=12;';
  var ROUTE_EDGE =
    'html=1;dashed=1;edgeStyle=orthogonalEdgeStyle;rounded=1;strokeColor=#8ba1b8;endArrow=block;endFill=1;';

  // Risk levels, ordered highest first. This mirrors the app's built-in defaults
  // (App/src/doc/risk.ts); the app can override them per diagram, account or
  // server, which a draw.io diagram has no way to know.
  var RISK_LEVELS = [
    {
      label: 'Critical',
      color: '#e5484d',
      ports: '21, 23, 69, 111, 135, 139, 445, 512-514, 1433, 1521, 2049, 3306, 3389, 5432, 5900, 5985, 6379, 9200, 11211, 27017',
    },
    {
      label: 'Medium',
      color: '#f08c2e',
      ports: '22, 1080, 2375-2376, 3000, 3128, 5000, 5901, 7001, 8000-8100, 8443, 8888, 9090, 10000',
    },
    {
      label: 'Low',
      color: '#e3c53d',
      ports: '25, 53, 80, 110, 143, 161, 389, 443, 465, 587, 636, 873, 993, 995, 1900, 5060, 5353',
    },
  ];

  var OPEN_STATES = { open: true, 'open|filtered': true };

  // ---------------------------------------------------------------------------
  // Small helpers
  // ---------------------------------------------------------------------------
  function esc(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function attr(el, name) {
    if (!el || typeof el.getAttribute !== 'function') return undefined;
    var value = el.getAttribute(name);
    if (value == null) return undefined;
    value = String(value).trim();
    return value.length > 0 ? value : undefined;
  }

  function childrenOf(el, tagName) {
    var out = [];
    if (!el || !el.childNodes) return out;
    for (var i = 0; i < el.childNodes.length; i += 1) {
      var node = el.childNodes[i];
      if (node.nodeType === 1 && node.nodeName === tagName) out.push(node);
    }
    return out;
  }

  function firstChild(el, tagName) {
    return childrenOf(el, tagName)[0];
  }

  function openPorts(host) {
    return (host.ports || []).filter(function (port) {
      return OPEN_STATES[port.state] === true;
    });
  }

  function parsePortSpec(spec) {
    var ranges = [];
    String(spec || '')
      .split(/[,;\s]+/)
      .forEach(function (token) {
        var match = /^(\d{1,5})(?:-(\d{1,5}))?$/.exec(token.trim());
        if (!match) return;
        var from = Number(match[1]);
        var to = match[2] ? Number(match[2]) : from;
        if (from >= 1 && to <= 65535 && from <= to) ranges.push([from, to]);
      });
    return ranges;
  }

  var compiledRisk = RISK_LEVELS.map(function (level) {
    return { level: level, ranges: parsePortSpec(level.ports) };
  });

  function levelForPort(port) {
    for (var i = 0; i < compiledRisk.length; i += 1) {
      var ranges = compiledRisk[i].ranges;
      for (var j = 0; j < ranges.length; j += 1) {
        if (port >= ranges[j][0] && port <= ranges[j][1]) return compiledRisk[i].level;
      }
    }
    return null;
  }

  /**
   * Highest-priority level with a match, plus the ports it covers and a
   * per-port level map for the badge colours. Priority follows RISK_LEVELS
   * order, never the order the ports appear in the scan.
   */
  function hostRisk(host) {
    var badgeLevels = {};
    var perLevel = {};
    openPorts(host).forEach(function (port) {
      var level = levelForPort(port.port);
      if (!level) return;
      badgeLevels[port.port] = level;
      if (!perLevel[level.label]) perLevel[level.label] = [];
      perLevel[level.label].push(port.port);
    });

    var matched = compiledRisk
      .map(function (entry) {
        return entry.level;
      })
      .filter(function (level) {
        return Boolean(perLevel[level.label]);
      });
    if (matched.length === 0) return null;

    var top = matched[0];
    return {
      level: top,
      ports: perLevel[top.label],
      badges: badgeLevels,
      flagged: Object.keys(badgeLevels).length,
      detail: matched
        .map(function (level) {
          return level.label + ': ' + perLevel[level.label].join(', ');
        })
        .join(' · '),
    };
  }

  function portSummary(host, limit) {
    var open = openPorts(host);
    var shown = open.slice(0, limit).map(function (port) {
      return port.service ? port.port + '/' + port.service : String(port.port);
    });
    var rest = open.length - shown.length;
    if (rest > 0) shown.push('+' + rest);
    return shown.join(', ');
  }

  function hostTitle(host) {
    for (var i = 0; i < (host.hostnames || []).length; i += 1) {
      if (host.hostnames[i] && host.hostnames[i].trim()) return host.hostnames[i].trim();
    }
    return host.mac || host.ip;
  }

  function shortOs(host) {
    if (!host.os || !host.os.length) return '';
    return host.os[0].name.split(' ').slice(0, 2).join(' ');
  }

  var ICON_RULES = [
    [/windows/i, '🪟'],
    [/mac os|macos|apple|darwin/i, '🍎'],
    [/router|cisco|juniper|mikrotik|openwrt|pfsense|gateway/i, '📶'],
    [/printer|jetdirect/i, '🖨️'],
    [/camera|webcam/i, '📷'],
    [/\bswitch\b/i, '🔀'],
    [/nas|network storage|fileserver/i, '💾'],
    [/linux|ubuntu|debian|centos|fedora|red hat|rhel|alpine|arch|suse|kali/i, '🐧'],
  ];

  function iconFor(host) {
    var text = (host.os || [])
      .map(function (match) {
        return match.name;
      })
      .join(' ');
    text +=
      ' ' +
      (host.ports || [])
        .map(function (port) {
          return port.product || '';
        })
        .join(' ');
    for (var i = 0; i < ICON_RULES.length; i += 1) {
      if (ICON_RULES[i][0].test(text)) return ICON_RULES[i][1];
    }
    return '🖥️';
  }

  // ---------------------------------------------------------------------------
  // XML parsing — mirror of App/src/nmap/parseNmapXml.ts
  // ---------------------------------------------------------------------------
  function parseScripts(el) {
    return childrenOf(el, 'script')
      .map(function (node) {
        return { id: attr(node, 'id') || 'script', output: attr(node, 'output') || '' };
      })
      .filter(function (script) {
        return script.output.length > 0;
      });
  }

  function parsePort(el) {
    var state = firstChild(el, 'state');
    var service = firstChild(el, 'service');
    return {
      port: Number(attr(el, 'portid') || 0),
      protocol: attr(el, 'protocol') || 'tcp',
      state: attr(state, 'state') || 'unknown',
      service: attr(service, 'name'),
      product: attr(service, 'product'),
      version: attr(service, 'version'),
      scripts: parseScripts(el),
    };
  }

  function parseTrace(el) {
    return childrenOf(firstChild(el, 'trace'), 'hop')
      .map(function (node) {
        return {
          ip: attr(node, 'ipaddr') || '',
          ttl: Number(attr(node, 'ttl') || 0),
          rtt: attr(node, 'rtt') ? Number(attr(node, 'rtt')) : undefined,
          host: attr(node, 'host'),
        };
      })
      .filter(function (hop) {
        return hop.ip.length > 0 && hop.ip !== '-';
      })
      .sort(function (a, b) {
        return a.ttl - b.ttl;
      });
  }

  function parseHost(el, index) {
    var addresses = childrenOf(el, 'address');
    var ipv4 = null;
    var ipv6 = null;
    var mac = null;
    for (var i = 0; i < addresses.length; i += 1) {
      var kind = attr(addresses[i], 'addrtype');
      if (kind === 'ipv4' && !ipv4) ipv4 = addresses[i];
      else if (kind === 'ipv6' && !ipv6) ipv6 = addresses[i];
      else if (kind === 'mac' && !mac) mac = addresses[i];
    }

    var ip = attr(ipv4, 'addr') || attr(ipv6, 'addr');
    if (!ip) return null;

    var hostnames = childrenOf(firstChild(el, 'hostnames'), 'hostname')
      .map(function (node) {
        return attr(node, 'name');
      })
      .filter(function (name) {
        return Boolean(name);
      });

    // A missing <ports> element means the scan never probed ports: a discovery
    // scan or a hosthint. Never infer "no open ports" from that.
    var portsEl = firstChild(el, 'ports');
    var ports = childrenOf(portsEl, 'port')
      .map(parsePort)
      .filter(function (port) {
        return port.port > 0;
      })
      .sort(function (a, b) {
        return a.port - b.port;
      });

    var os = childrenOf(firstChild(el, 'os'), 'osmatch').map(function (node) {
      return { name: attr(node, 'name') || 'unknown', accuracy: Number(attr(node, 'accuracy') || 0) };
    });

    var macAddress = attr(mac, 'addr');

    return {
      id: 'host-' + ip.replace(/[^0-9a-zA-Z]+/g, '-') + '-' + index,
      ip: ip,
      ipv6: ipv4 ? attr(ipv6, 'addr') : undefined,
      mac: macAddress ? macAddress.toUpperCase() : undefined,
      vendor: attr(mac, 'vendor'),
      hostnames: hostnames,
      status: attr(firstChild(el, 'status'), 'state') || 'up',
      os: os,
      ports: ports,
      portsScanned: portsEl != null,
      scripts: parseScripts(firstChild(el, 'hostscript')),
      hops: parseTrace(el).map(function (hop) {
        return hop.ip;
      }),
    };
  }

  function collectTrace(hostElements) {
    var byIp = {};
    var order = [];
    hostElements.forEach(function (el) {
      parseTrace(el).forEach(function (hop) {
        var seen = byIp[hop.ip];
        if (!seen) {
          byIp[hop.ip] = { ip: hop.ip, ttl: hop.ttl, rtt: hop.rtt, host: hop.host };
          order.push(hop.ip);
          return;
        }
        if (!seen.host && hop.host) seen.host = hop.host;
        if (seen.rtt === undefined && hop.rtt !== undefined) seen.rtt = hop.rtt;
        if (hop.ttl > seen.ttl) seen.ttl = hop.ttl;
      });
    });
    return order
      .map(function (ip) {
        return byIp[ip];
      })
      .sort(function (a, b) {
        return a.ttl - b.ttl;
      });
  }

  function parseScanXml(xml, fileName) {
    var source = String(xml == null ? '' : xml);
    if (!source.trim()) throw new Error('Choose an nmap XML file or paste its contents first.');
    if (typeof window.DOMParser !== 'function') throw new Error('This browser cannot parse XML.');

    // Strip the doctype so the parser never looks for the nmap DTD/XSL reference.
    var cleaned = source.replace(/<!DOCTYPE[^>[]*(\[[\s\S]*?\])?>/gi, '');
    var doc = new window.DOMParser().parseFromString(cleaned, 'text/xml');
    var failure =
      doc.getElementsByTagName('parsererror')[0] ||
      (typeof doc.getElementsByTagNameNS === 'function'
        ? doc.getElementsByTagNameNS('*', 'parsererror')[0]
        : null);
    if (failure) throw new Error('That file is not valid XML.');

    var run = doc.documentElement;
    if (!run || run.nodeName !== 'nmaprun') {
      throw new Error('No <nmaprun> root element. Run nmap with -oX to produce XML output.');
    }

    var hostElements = childrenOf(run, 'host');
    var hintElements = childrenOf(run, 'hosthint');
    var hosts = [];
    var seenIp = {};

    function collect(elements, discoveryOnly) {
      elements.forEach(function (node) {
        var host = parseHost(node, hosts.length);
        if (!host || seenIp[host.ip]) return;
        seenIp[host.ip] = true;
        if (discoveryOnly) host.portsScanned = false;
        hosts.push(host);
      });
    }

    collect(hostElements, false);
    collect(hintElements, true);

    if (hosts.length === 0) {
      var args = attr(run, 'args') || '';
      var discoveryScan = /(^|\s)-sn(\s|$)/.test(args);
      throw new Error(
        discoveryScan
          ? 'The scan reported no live hosts. A ping scan only lists hosts that answer – try sudo for ARP discovery on a local subnet, or scan again with -Pn.'
          : 'The scan contains no hosts. Try nmap with -Pn to include hosts that block ping.',
      );
    }

    var start = attr(run, 'start');
    var elapsed = attr(firstChild(firstChild(run, 'runstats'), 'finished'), 'elapsed');
    var trace = collectTrace(hostElements);

    return {
      fileName: fileName || 'scan.xml',
      args: attr(run, 'args'),
      version: attr(run, 'version'),
      startedAt: start ? new Date(Number(start) * 1000).toISOString() : undefined,
      elapsedSeconds: elapsed ? Number(elapsed) : undefined,
      hosts: hosts,
      trace: trace.length > 0 ? trace : undefined,
    };
  }

  // ---------------------------------------------------------------------------
  // Subnet grouping and layout — mirror of App/src/graph/layout.ts
  // ---------------------------------------------------------------------------
  function ipParts(ip) {
    return String(ip)
      .replace(/::/g, ':0:')
      .split(/[.:]/)
      .map(function (part) {
        return parseInt(part, 10) || 0;
      });
  }

  function compareIp(a, b) {
    var left = ipParts(a);
    var right = ipParts(b);
    for (var i = 0; i < Math.max(left.length, right.length); i += 1) {
      var diff = (left[i] || 0) - (right[i] || 0);
      if (diff !== 0) return diff;
    }
    return String(a).localeCompare(String(b));
  }

  function subnetOf(ip) {
    if (String(ip).indexOf(':') >= 0) {
      var parts = String(ip).split(':').filter(function (part) {
        return part.length > 0;
      });
      return (parts[0] || '0000') + ':' + (parts[1] || '0000') + '::/64';
    }
    var octets = String(ip).split('.');
    if (octets.length === 4) return octets[0] + '.' + octets[1] + '.' + octets[2] + '.0/24';
    return 'unrouted';
  }

  function groupHosts(hosts) {
    var buckets = {};
    var order = [];
    hosts.forEach(function (host) {
      var cidr = subnetOf(host.ip);
      if (!buckets[cidr]) {
        buckets[cidr] = [];
        order.push(cidr);
      }
      buckets[cidr].push(host);
    });
    return order
      .map(function (cidr) {
        return {
          cidr: cidr,
          hosts: buckets[cidr].slice().sort(function (a, b) {
            return compareIp(a.ip, b.ip);
          }),
        };
      })
      .sort(function (a, b) {
        return compareIp(a.cidr.replace('/24', '.0'), b.cidr.replace('/24', '.0'));
      });
  }

  function layoutRoute(scan) {
    var depthByIp = {};
    scan.hosts.forEach(function (host) {
      (host.hops || []).forEach(function (ip, index) {
        var depth = index + 1;
        if ((depthByIp[ip] || 0) < depth) depthByIp[ip] = depth;
      });
    });

    var byDepth = {};
    var depths = [];
    Object.keys(depthByIp).forEach(function (ip) {
      var depth = depthByIp[ip];
      if (!byDepth[depth]) {
        byDepth[depth] = [];
        depths.push(depth);
      }
      byDepth[depth].push(ip);
    });

    var names = {};
    (scan.trace || []).forEach(function (hop) {
      if (hop.host) names[hop.ip] = hop.host;
    });

    var hops = [];
    var bottom = 0;
    depths
      .sort(function (a, b) {
        return a - b;
      })
      .forEach(function (depth) {
        byDepth[depth].sort(compareIp).forEach(function (ip, row) {
          var y = row * (HOP_H + 12);
          hops.push({ ip: ip, depth: depth, x: ORIGIN_W + 140 + (depth - 1) * (HOP_W + 84), y: y, hostname: names[ip] });
          bottom = Math.max(bottom, y + HOP_H);
        });
      });
    return { hops: hops, bottom: bottom };
  }

  function layoutScan(scan) {
    var route = layoutRoute(scan);
    var top = Math.max(route.bottom, ORIGIN_H) + 96;

    var subnets = [];
    var cursorX = 0;
    var cursorY = top;
    var rowHeight = 0;

    groupHosts(scan.hosts).forEach(function (group) {
      var count = group.hosts.length;
      var cols = Math.min(MAX_COLS, Math.max(1, Math.ceil(Math.sqrt(count))));
      var rows = Math.ceil(count / cols);
      var innerW = cols * HOST_W + (cols - 1) * H_GAP;
      var innerH = rows * HOST_H + (rows - 1) * V_GAP;
      var w = innerW + PAD * 2;
      var h = innerH + PAD * 2 + HEADER_H;

      if (cursorX > 0 && cursorX + w > MAX_ROW_W) {
        cursorX = 0;
        cursorY += rowHeight + SUBNET_GAP;
        rowHeight = 0;
      }

      var placed = group.hosts.map(function (host, index) {
        return {
          host: host,
          x: PAD + (index % cols) * (HOST_W + H_GAP),
          y: PAD + HEADER_H + Math.floor(index / cols) * (HOST_H + V_GAP),
        };
      });

      subnets.push({ cidr: group.cidr, x: cursorX, y: cursorY, w: w, h: h, hosts: placed });
      cursorX += w + SUBNET_GAP;
      rowHeight = Math.max(rowHeight, h);
    });

    var width = Math.max(
      ORIGIN_W,
      Math.max.apply(
        Math,
        [0].concat(
          subnets.map(function (subnet) {
            return subnet.x + subnet.w;
          }),
        ),
      ),
      Math.max.apply(
        Math,
        [0].concat(
          route.hops.map(function (hop) {
            return hop.x + HOP_W;
          }),
        ),
      ),
    );
    var height = Math.max(
      ORIGIN_H,
      Math.max.apply(
        Math,
        [0].concat(
          subnets.map(function (subnet) {
            return subnet.y + subnet.h;
          }),
        ),
      ),
    );

    return { origin: { x: 0, y: 0 }, subnets: subnets, hops: route.hops, width: width, height: height };
  }

  // ---------------------------------------------------------------------------
  // Labels — the draw.io equivalents of the app's host cards
  // ---------------------------------------------------------------------------
  function originLabel(scan) {
    var detail = (scan.args || scan.fileName || '').replace(/\s+/g, ' ').slice(0, 120);
    var discoveryOnly = scan.hosts.every(function (host) {
      return host.portsScanned === false;
    });
    var subtitle = scan.hosts.length + (scan.hosts.length === 1 ? ' host' : ' hosts');
    if (discoveryOnly) subtitle += ' · no port scan';
    return (
      '<b>SCAN ORIGIN</b><br><font color="#9fb3c8">' +
      esc(detail) +
      '</font><br><font color="#cbd5e1">' +
      esc(subtitle) +
      '</font>'
    );
  }

  function hopLabel(hop) {
    var name = hop.hostname ? '<br><font color="#64748b">' + esc(hop.hostname) + '</font>' : '';
    return '<b>hop ' + esc(hop.depth) + '</b><br>' + esc(hop.ip) + name;
  }

  function sectionLabel(subnet) {
    var count = subnet.hosts.length;
    return (
      '<b>🗄 ' +
      esc(subnet.cidr) +
      '</b><font color="#8b97a8"> · ' +
      count +
      (count === 1 ? ' host' : ' hosts') +
      '</font>'
    );
  }

  function hostLabel(host) {
    var lines = ['<b>' + esc(iconFor(host)) + ' ' + esc(hostTitle(host)) + '</b>'];

    var meta = [host.ip];
    if (host.mac) meta.push(host.mac + (host.vendor ? ' · ' + host.vendor : ''));
    var os = shortOs(host);
    if (os) meta.push(os);
    lines.push('<font color="#5a6a7d">' + esc(meta.join(' · ')) + '</font>');

    var open = openPorts(host);
    var risk = hostRisk(host);
    var summary;
    if (host.status === 'down') summary = 'host down';
    else if (host.portsScanned === false) summary = 'discovered · no port scan';
    else summary = open.length === 0 ? 'no open ports' : open.length + ' open';

    var summaryHtml = '<font color="#8b97a8">' + esc(summary) + '</font>';
    if (risk) {
      summaryHtml +=
        ' <font color="' + esc(risk.level.color) + '">' + esc(risk.level.label.toLowerCase()) + ' ' + risk.ports.length + '</font>';
    }
    lines.push(summaryHtml);

    if (open.length > 0) {
      lines.push(
        '<font color="' + esc(risk ? risk.level.color : '#2563eb') + '">' + esc(portSummary(host, 5)) + '</font>',
      );
    }
    return lines.join('<br>');
  }

  function hostStyle(host) {
    if (host.status === 'down') return HOST_STYLE + HOST_DOWN_STYLE;
    var risk = hostRisk(host);
    if (risk) return HOST_STYLE + 'strokeColor=' + risk.level.color + ';strokeWidth=2;';
    return HOST_STYLE;
  }

  function tooltipOf(host) {
    var lines = [hostTitle(host) + ' (' + host.ip + ')'];
    if (host.os.length) lines.push('OS: ' + host.os[0].name);
    var risk = hostRisk(host);
    if (risk) lines.push('Risk – ' + risk.detail);
    openPorts(host).forEach(function (port) {
      var service = [port.service, port.product, port.version].filter(Boolean).join(' ');
      lines.push(port.port + '/' + port.protocol + ' ' + port.state + (service ? ' – ' + service : ''));
    });
    host.scripts.forEach(function (script) {
      lines.push(script.id + ': ' + script.output.replace(/\s+/g, ' ').slice(0, 180));
    });
    return lines.join('\n');
  }

  // ---------------------------------------------------------------------------
  // Scan summary for the import dialog
  // ---------------------------------------------------------------------------
  function describeScan(scan) {
    var open = 0;
    var risky = 0;
    var down = 0;
    var discovery = 0;
    var byLevel = {};
    scan.hosts.forEach(function (host) {
      open += openPorts(host).length;
      var risk = hostRisk(host);
      if (risk) {
        risky += risk.flagged;
        byLevel[risk.level.label] = (byLevel[risk.level.label] || 0) + risk.ports.length;
      }
      if (host.status === 'down') down += 1;
      if (host.portsScanned === false) discovery += 1;
    });
    return {
      hosts: scan.hosts.length,
      subnets: groupHosts(scan.hosts).length,
      hops: layoutRoute(scan).hops.length,
      openPorts: open,
      riskyPorts: risky,
      riskLevels: byLevel,
      downHosts: down,
      discoveryHosts: discovery,
      args: scan.args,
      version: scan.version,
    };
  }

  // ---------------------------------------------------------------------------
  // Document insertion
  // ---------------------------------------------------------------------------
  function addLayer(graph, name) {
    var model = graph.getModel();
    var root = model.getRoot();
    // A layer is any direct child of the root; graph.addCell assigns the id.
    var layer = new mxCell(name, new mxGeometry(), '');
    graph.addCell(layer, root, model.getChildCount(root));
    return layer;
  }

  /** Reuses an empty single layer so a fresh diagram does not gain a spare one. */
  function targetLayer(graph, name) {
    var model = graph.getModel();
    var root = model.getRoot();
    if (model.getChildCount(root) === 1) {
      var only = model.getChildAt(root, 0);
      if (only != null && model.getChildCount(only) === 0) {
        model.setValue(only, name);
        return { layer: only, created: false };
      }
    }
    return { layer: addLayer(graph, name), created: true };
  }

  /** Lowest y of anything already on the page, so a new scan lands below it. */
  function contentBottom(model) {
    var root = model.getRoot();
    var bottom = 0;
    for (var i = 0; i < model.getChildCount(root); i += 1) {
      var layer = model.getChildAt(root, i);
      for (var j = 0; j < model.getChildCount(layer); j += 1) {
        var geometry = model.getGeometry(model.getChildAt(layer, j));
        if (geometry != null) bottom = Math.max(bottom, geometry.y + geometry.height);
      }
    }
    return bottom;
  }

  function routeEdges(graph, layer, nodes) {
    var depthList = [];
    nodes.hops.forEach(function (hop) {
      if (depthList.indexOf(hop.depth) < 0) depthList.push(hop.depth);
    });
    depthList.sort(function (a, b) {
      return a - b;
    });

    var edges = [];

    function connect(source, target) {
      if (!source || !target) return;
      // insertEdge(parent, id, value, source, target, style)
      edges.push(graph.insertEdge(layer, null, '', source.cell, target.cell, ROUTE_EDGE));
    }

    if (nodes.origin && depthList.length > 0) {
      nodes.hops.forEach(function (hop) {
        if (hop.depth === depthList[0]) connect(nodes.origin, hop);
      });
    }

    for (var i = 0; i < depthList.length - 1; i += 1) {
      nodes.hops.forEach(function (from) {
        if (from.depth !== depthList[i]) return;
        nodes.hops.forEach(function (to) {
          if (to.depth === depthList[i + 1]) connect(from, to);
        });
      });
    }

    var hopByIp = {};
    nodes.hops.forEach(function (hop) {
      hopByIp[hop.ip] = hop;
    });
    nodes.hosts.forEach(function (entry) {
      var chain = entry.host.hops || [];
      var last = chain[chain.length - 1];
      var hop = last ? hopByIp[last] : undefined;
      if (hop) connect(hop, entry);
    });

    return edges;
  }

  /**
   * Adds the scan to the current page on a layer of its own.
   * Returns { layer, cells, bounds } so callers can select and fit the new content.
   */
  function insertScan(ui, scan, layerName) {
    var graph = ui.editor.graph;
    var model = graph.getModel();
    var layout = layoutScan(scan);
    var cells = [];
    var nodes = { origin: null, hops: [], hosts: [] };
    var layer = null;
    var offsetY = 0;

    model.beginUpdate();
    try {
      var target = targetLayer(graph, layerName || 'nmap scan');
      layer = target.layer;
      // A second scan on the same page goes below the first one, exactly like the
      // app's "new layer" import, instead of stacking on top of it.
      if (target.created) {
        var existingBottom = contentBottom(model);
        if (existingBottom > 0) offsetY = existingBottom + 140;
      }

      var originCell = graph.insertVertex(
        layer,
        null,
        originLabel(scan),
        layout.origin.x,
        layout.origin.y + offsetY,
        ORIGIN_W,
        ORIGIN_H,
        ORIGIN_STYLE,
      );
      nodes.origin = { cell: originCell };
      cells.push(originCell);

      layout.hops.forEach(function (hop) {
        var cell = graph.insertVertex(layer, null, hopLabel(hop), hop.x, hop.y + offsetY, HOP_W, HOP_H, HOP_STYLE);
        nodes.hops.push({ ip: hop.ip, depth: hop.depth, cell: cell });
        cells.push(cell);
      });

      layout.subnets.forEach(function (subnet) {
        var section = graph.insertVertex(
          layer,
          null,
          sectionLabel(subnet),
          subnet.x,
          subnet.y + offsetY,
          subnet.w,
          subnet.h,
          SECTION_STYLE,
        );
        cells.push(section);

        subnet.hosts.forEach(function (placed) {
          var hostCell = graph.insertVertex(
            section,
            null,
            hostLabel(placed.host),
            placed.x,
            placed.y,
            HOST_W,
            HOST_H,
            hostStyle(placed.host),
          );
          // mxGraph asks the cell first: getTooltipForCell() calls cell.getTooltip()
          // when it exists. Keeps the full nmap record off the card itself.
          var details = tooltipOf(placed.host);
          if (details) {
            hostCell.getTooltip = function () {
              return details;
            };
          }
          nodes.hosts.push({ host: placed.host, cell: hostCell });
          cells.push(hostCell);
        });
      });

      cells = cells.concat(routeEdges(graph, layer, nodes));
      graph.setDefaultParent(layer);
    } finally {
      model.endUpdate();
    }

    return {
      layer: layer,
      cells: cells,
      // The scan is always laid out from (0, offsetY); mxGraph's getCellBounds
      // takes a single cell, so the layout knows the bounds better than the view.
      bounds: new mxRectangle(layout.origin.x, layout.origin.y + offsetY, layout.width, layout.height),
    };
  }

  function fitAndSelect(graph, result) {
    if (!result.cells.length) return;
    graph.setSelectionCells(result.cells);
    if (typeof graph.fitWindow === 'function' && result.bounds != null) {
      // Third argument caps the zoom: a two-host scan should not fill the screen.
      graph.fitWindow(result.bounds, DIAGRAM_PADDING, 1);
    }
  }

  // ---------------------------------------------------------------------------
  // Import dialog
  // ---------------------------------------------------------------------------
  function el(tag, cssText, html) {
    var node = document.createElement(tag);
    if (cssText) node.style.cssText = cssText;
    if (html != null) node.innerHTML = html;
    return node;
  }

  function defaultLayerName(fileName) {
    var base = String(fileName || 'scan').replace(/\.[^.]+$/, '') || 'scan';
    return base.slice(0, 42);
  }

  /** The bundled demo scan, served next to this script in samples/. */
  function sampleUrl() {
    var base = SCRIPT_URL || (typeof document !== 'undefined' ? document.baseURI : '');
    if (!base) return null;
    try {
      return new URL('samples/lab-scan.xml', base).href;
    } catch (error) {
      return null;
    }
  }

  function summaryHtml(scan, fileName) {
    var info = describeScan(scan);
    var rows = ['<b>' + esc(fileName) + '</b>'];
    rows.push(
      info.hosts +
        (info.hosts === 1 ? ' host' : ' hosts') +
        ' in ' +
        info.subnets +
        (info.subnets === 1 ? ' subnet' : ' subnets') +
        (info.hops > 0 ? ' · ' + info.hops + (info.hops === 1 ? ' route hop' : ' route hops') : ' · no traceroute'),
    );

    var facts = [];
    if (info.discoveryHosts > 0) {
      facts.push(
        info.discoveryHosts === info.hosts
          ? 'discovery only – the scan lists hosts without port data'
          : info.discoveryHosts + ' host(s) discovered without a port scan',
      );
    } else {
      facts.push(info.openPorts + ' open port' + (info.openPorts === 1 ? '' : 's'));
    }
    RISK_LEVELS.forEach(function (level) {
      var count = info.riskLevels[level.label];
      if (count > 0) {
        facts.push('<b style="color:' + esc(level.color) + ';">' + count + ' ' + esc(level.label.toLowerCase()) + '</b>');
      }
    });
    if (info.downHosts > 0) facts.push(info.downHosts + ' down');
    rows.push(facts.join(' · '));

    if (info.args) rows.push('<font color="#5a6a7d">' + esc(info.args.replace(/\s+/g, ' ').slice(0, 140)) + '</font>');
    return rows.join('<br>');
  }

  function openImportDialog(ui) {
    var graph = ui.editor.graph;
    var state = { scan: null };

    var root = el(
      'div',
      'box-sizing:border-box;width:100%;padding:16px 18px;display:flex;flex-direction:column;gap:10px;' +
        'font:13px/1.45 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;color:#1f2937;',
    );

    root.appendChild(
      el(
        'div',
        '',
        '<div style="font-size:15px;font-weight:600;color:#111827;">Import an nmap scan</div>' +
          '<div style="color:#5a6a7d;margin-top:2px;">Run <code>nmap -oX scan.xml …</code> and pick the XML file, or paste ' +
          'it below. The scan is added on a new layer, so the diagram you have open is left untouched.</div>',
      ),
    );

    var fileRow = el('div', 'display:flex;align-items:center;gap:8px;');
    fileRow.appendChild(el('label', 'min-width:92px;color:#5a6a7d;', 'Scan file'));
    var fileInput = el('input', 'flex:1;font-size:13px;');
    fileInput.type = 'file';
    fileInput.accept = '.xml,text/xml,application/xml';
    fileRow.appendChild(fileInput);
    root.appendChild(fileRow);

    var textarea = el(
      'textarea',
      'width:100%;height:100px;box-sizing:border-box;resize:vertical;padding:8px;font:12px/1.4 ui-monospace,Consolas,monospace;' +
        'border:1px solid #c3ccd9;border-radius:6px;background:#fff;color:#111827;',
    );
    textarea.placeholder = '<?xml version="1.0"?>  <nmaprun …>';
    textarea.spellcheck = false;
    textarea.setAttribute('aria-label', 'nmap XML');
    root.appendChild(textarea);

    var sampleRow = el('div', 'display:flex;align-items:center;gap:8px;color:#5a6a7d;font-size:12px;');
    var sampleBtn = mxUtils.button('Load sample scan', function () {
      loadSample();
    });
    sampleBtn.className = 'geBtn';
    sampleRow.appendChild(sampleBtn);
    sampleRow.appendChild(el('span', '', 'a 12-host lab scan that ships with the plugin'));
    root.appendChild(sampleRow);

    var preview = el(
      'div',
      'min-height:76px;box-sizing:border-box;padding:10px 12px;border-radius:6px;background:#f6f8fb;' +
        'border:1px solid #dde3ec;color:#5a6a7d;overflow:auto;',
      'Nothing loaded yet.',
    );
    root.appendChild(preview);

    var layerRow = el('div', 'display:flex;align-items:center;gap:8px;');
    layerRow.appendChild(el('label', 'min-width:92px;color:#5a6a7d;', 'Layer name'));
    var layerInput = el(
      'input',
      'flex:1;box-sizing:border-box;padding:5px 8px;border:1px solid #c3ccd9;border-radius:6px;font-size:13px;',
    );
    layerInput.type = 'text';
    layerInput.value = 'nmap scan';
    layerRow.appendChild(layerInput);
    root.appendChild(layerRow);

    var buttons = el('div', 'display:flex;justify-content:flex-end;gap:8px;padding-top:4px;');
    var cancelBtn = mxUtils.button(mxResources.get('cancel') || 'Cancel', function () {
      ui.hideDialog(panel);
    });
    cancelBtn.className = 'geBtn';
    var importBtn = mxUtils.button('Import', function () {
      performImport();
    });
    importBtn.className = 'geBtn gePrimaryBtn';
    buttons.appendChild(cancelBtn);
    buttons.appendChild(importBtn);
    root.appendChild(buttons);

    var panel = ui.showDialog(root, 560, 510, true, true);

    function setImportEnabled(enabled) {
      importBtn.disabled = !enabled;
      importBtn.style.opacity = enabled ? '1' : '0.55';
      importBtn.style.cursor = enabled ? 'pointer' : 'default';
    }
    setImportEnabled(false);

    function showMessage(html, isError) {
      preview.innerHTML = html;
      preview.style.color = isError ? '#b91c1c' : '#5a6a7d';
      preview.style.borderColor = isError ? '#f0b4b4' : '#dde3ec';
      preview.style.background = isError ? '#fff6f6' : '#f6f8fb';
    }

    function load(xml, fileName) {
      try {
        var scan = parseScanXml(xml, fileName);
        state.scan = scan;
        showMessage(summaryHtml(scan, fileName), false);
        if (layerInput.getAttribute('data-dirty') !== 'true') layerInput.value = defaultLayerName(fileName);
        setImportEnabled(true);
      } catch (error) {
        state.scan = null;
        showMessage('<b>Cannot read that scan</b><br>' + esc(error.message || error), true);
        setImportEnabled(false);
      }
    }

    function loadSample() {
      var url = sampleUrl();
      if (!url) {
        showMessage('This copy of the plugin does not ship the sample scan.', true);
        setImportEnabled(false);
        return;
      }
      showMessage('Loading the sample scan…', false);
      setImportEnabled(false);
      var request = new XMLHttpRequest();
      request.open('GET', url, true);
      request.onload = function () {
        if (request.status >= 200 && request.status < 300) {
          textarea.value = '';
          load(request.responseText, 'lab-scan.xml');
          return;
        }
        showMessage('The sample scan was not found next to the plugin.<br><font color="#5a6a7d">' + esc(url) + '</font>', true);
      };
      request.onerror = function () {
        showMessage('The sample scan could not be loaded.<br><font color="#5a6a7d">' + esc(url) + '</font>', true);
      };
      request.send();
    }

    fileInput.addEventListener('change', function () {
      var file = fileInput.files && fileInput.files[0];
      if (!file) return;
      var reader = new FileReader();
      reader.onload = function () {
        textarea.value = '';
        load(String(reader.result == null ? '' : reader.result), file.name);
      };
      reader.onerror = function () {
        state.scan = null;
        showMessage('That file could not be read.', true);
        setImportEnabled(false);
      };
      reader.readAsText(file);
    });

    var pasteTimer = null;
    textarea.addEventListener('input', function () {
      window.clearTimeout(pasteTimer);
      pasteTimer = window.setTimeout(function () {
        var text = textarea.value;
        if (!text.trim()) {
          state.scan = null;
          showMessage('Nothing loaded yet.', false);
          setImportEnabled(false);
          return;
        }
        load(text, defaultLayerName(layerInput.value) + '.xml');
      }, 350);
    });

    layerInput.addEventListener('input', function () {
      layerInput.setAttribute('data-dirty', 'true');
    });

    function performImport() {
      if (!state.scan) return;
      var name = (layerInput.value || '').trim() || defaultLayerName(state.scan.fileName);
      ui.hideDialog(panel);
      try {
        var result = insertScan(ui, state.scan, name);
        if (typeof ui.editor.setModified === 'function') ui.editor.setModified(true);
        fitAndSelect(graph, result);
      } catch (error) {
        if (window.console && window.console.error) window.console.error('[nmap2drawio]', error);
        mxUtils.alert('NMAP import failed: ' + (error.message || error));
      }
    }

    return panel;
  }

  // ---------------------------------------------------------------------------
  // Plugin registration
  // ---------------------------------------------------------------------------
  function hookMenu(ui, menuId) {
    var menu = ui.menus.get(menuId);
    if (!menu || typeof menu.funct !== 'function') return;
    var original = menu.funct;
    menu.funct = function (menu, parent) {
      original.apply(this, arguments);
      ui.menus.addMenuItems(menu, ['-', ACTION_ID], parent);
    };
  }

  function install(ui) {
    if (!ui || ui.__nmap2drawioInstalled) return;
    ui.__nmap2drawioInstalled = true;
    // Handy from the browser console: Nmap2Drawio.insertScan(Nmap2Drawio.ui, scan, 'layer').
    window.Nmap2Drawio.ui = ui;

    mxResources.parse(MENU_RESOURCE);

    var action = ui.actions.addAction(ACTION_ID, function () {
      openImportDialog(ui);
    });
    action.label = 'NMAP: import scan…';

    hookMenu(ui, 'file');
    hookMenu(ui, 'extras');

    if (window.console && window.console.info) {
      window.console.info('[nmap2drawio] plugin ready – File → NMAP: import scan…');
    }
  }

  // Exposed for the browser console, scripted tests and the README examples.
  window.Nmap2Drawio = {
    version: '1.0.0',
    parseScanXml: parseScanXml,
    describeScan: describeScan,
    layoutScan: layoutScan,
    groupHosts: groupHosts,
    insertScan: insertScan,
    openImportDialog: openImportDialog,
    install: install,
    riskLevels: RISK_LEVELS,
  };

  /**
   * Fallback for ?offline=1 (and ?plugins=0), where draw.io never calls
   * App.initPluginCallback and so never defines Draw.loadPlugin at all
   * (js/diagramly/App.js: "Loads plugins" is skipped). The App constructor ends
   * with this.load(), so wrapping that gives us the EditorUi instance anyway.
   */
  function hookAppConstructor() {
    var App = window.App;
    if (typeof App !== 'function' || !App.prototype) return false;
    if (typeof App.prototype.load !== 'function') return false;
    if (App.prototype.load.__nmap2drawioHooked) return true;

    var originalLoad = App.prototype.load;
    var patchedLoad = function () {
      var result = originalLoad.apply(this, arguments);
      try {
        install(this);
      } catch (error) {
        if (window.console && window.console.error) window.console.error('[nmap2drawio]', error);
      }
      return result;
    };
    patchedLoad.__nmap2drawioHooked = true;
    App.prototype.load = patchedLoad;
    return true;
  }

  function register() {
    if (window.Draw && typeof window.Draw.loadPlugin === 'function') {
      window.Draw.loadPlugin(install);
      return true;
    }
    return hookAppConstructor();
  }

  if (!register()) {
    // Loaded before draw.io finished booting: retry until the editor API exists.
    var attempts = 0;
    var timer = window.setInterval(function () {
      attempts += 1;
      if (register() || attempts > 200) window.clearInterval(timer);
    }, 50);
  }
})();
