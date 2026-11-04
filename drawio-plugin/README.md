# NMAP import plugin for draw.io

A [draw.io](https://www.drawio.com/) plugin that reads `nmap -oX` output and draws it as an
editable diagram on a new layer: one frame per subnet, one card per host, the traceroute lane above
it, and dashed routed links from the scan origin down to every host.

## Quick start

```bash
cd drawio-plugin
docker compose up -d
```

Then open **http://localhost:8088/?offline=1** and use **File → NMAP: import scan…** (the same item
is in the **Extras** menu).

No repository clone needed: every build publishes the whole folder as
**`nmap2drawio-plugin.zip`** on the rolling
[`portable-latest` release](https://github.com/Jonesckevin/NMAP2Flowchart/releases) alongside the app's
`app.cjs` and portable folders – unzip it and run the same two commands.

`?offline=1` keeps the self-hosted editor away from all cloud storage; the plugin works with or
without it. Port 8088 is the default because the app's own `docker-compose.yml` already publishes
8080 – set `DRAWIO_PORT=9090` (or `.env`) to change it. The container is called `nmap2drawio`; set
`DRAWIO_CONTAINER` to run a second copy beside it (for example the packaged
`release/nmap2drawio-plugin/` next to this repository checkout).

```bash
docker compose logs -f              # watch tomcat start
curl -fsS http://localhost:8088/plugins/nmap2drawio.js | head -n 2
docker compose down                 # stop
```

## Using the plugin for Draw.io in Docker Compose

```yaml
services:
  drawio:
    image: jgraph/drawio:latest
    volumes:
      - ./plugins/nmap2drawio.js:/usr/local/tomcat/webapps/draw/plugins/nmap2drawio.js:ro
      - ./samples/lab-scan.xml:/usr/local/tomcat/webapps/draw/plugins/samples/lab-scan.xml:ro
      - ./webapp/js/PostConfig.js:/usr/local/tomcat/webapps/draw/js/PostConfig.js:ro
```

`webapp/js/PostConfig.js` in this folder is that override: the stock file's two icon-search nulls
plus the loader. If you would rather keep the stock file, append only the loader block from
`install-plugin.ps1` / `install-plugin.sh` instead of mounting the whole file.

### Other draw.io deployments

- **app.diagrams.net / draw.io Desktop / Atlassian integrations:** plugins are only supported by the
  web editor you host yourself, and a plugin URL must be on the same domain as the editor, so a
  remote URL cannot be added there.
- **A plugin added by hand** is stored in the browser (`localStorage`, `.drawio-config` → `plugins`)
  and evaluated on the next page load. The *Load sample scan* button resolves `samples/lab-scan.xml`
  next to the plugin file; if that file is not deployed the dialog says so and every other path in
  the dialog keeps working.

### How the plugin is loaded

`webapp/js/PostConfig.js` is draw.io's documented extension point
(`js/bootstrap.js` loads `js/PreConfig.js` before `app.min.js` and `js/PostConfig.js` after it). The
stock file only clears the remote icon-search endpoints; that behaviour is kept and a script tag for
`plugins/nmap2drawio.js` is added.

The plugin then registers itself in whichever way the running editor allows:

- `Draw.loadPlugin(...)` when draw.io exposed it (the documented entry point, used whenever plugins
  are enabled, including embed mode).
- `App.prototype.load`, the last call of the editor constructor, when draw.io did not define
  `Draw` at all – which is what happens with `?offline=1`, where `App.initPluginCallback()` and the
  whole plugin loader in `js/diagramly/App.js` are skipped. Without this fallback the menu entry
  would never appear in the offline editor.

Registration is idempotent (`ui.__nmap2drawioInstalled`), so both paths can fire without adding the
menu twice.


`.\build-release.ps1` (repository root) enforces that. It runs
[check-plugin.mjs](./check-plugin.mjs), which loads the plugin the way draw.io does – no DOM, no
editor – and fails when the risk tiers, the layout sizes or a cell style drift from `App/`, or when
the bundled sample scan stops parsing:

```powershell
node drawio-plugin/check-plugin.mjs      # 8 checks, ~0.1s
```

## Troubleshooting

| Symptom | Check |
| --- | --- |
| No *NMAP: import scan…* menu item | `curl -fsS http://localhost:8088/plugins/nmap2drawio.js` returns 200, then hard-reload (<kbd>Ctrl</kbd>+<kbd>F5</kbd>) so the browser refetches `app.min.js` and `PostConfig.js`. |
| Menu item missing only in your own deployment | Your `PostConfig.js` mount replaced the loader, or the deployment blocks custom plugin code. |
| *Cannot read that scan* | The file is not `nmap -oX` output – `-oN` and `-oG` are not XML, and the root element must be `<nmaprun>`. |
| Import went to an existing layer | A blank diagram reuses its single empty layer; anywhere else a new layer is created. |
