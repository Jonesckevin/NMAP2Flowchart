# NMAP2Flowchart

Turn an **nmap scan into an editable network diagram**. Drop in `nmap -oX` output and get a
grid-backed, zoomable canvas of subnets, hosts, open ports and traceroute hops – then reshape it:
layers, icons, notes, custom nodes and hand-drawn connections. Export to **Mermaid**, **draw.io**,
or as **print-ready SVG / PNG / PDF** for plotter-sized output.

![Screenshot](example.png)

## Quick start

**Docker (recommended):**

```bash
docker compose up -d --build     # http://localhost:8080
docker compose logs -f app
docker compose down
```

**Local development:**

```bash
cd App
npm install
npm run dev      # http://localhost:5173
npm run build    # static bundle in App/dist/
```

Click **Open sample scan** to see it working without running nmap, or **Blank canvas** to draw
something from scratch.

**Batch scan a set of subnets** with the helper scripts – they write one importable `-oX` file per
target into `scans/`:

```bash
sudo ./scripts/scan.sh                        # PREFIX=16 ARGS="-sV" OUT=out ./scripts/scan.sh
```

```powershell
.\scripts\scan.ps1                            # -Prefix 16 -NmapArgs '-sV' -OutDir out
```

Targets ending in `.0` are scanned as `<target>/<prefix>` (default `/24`); any other address is scanned
as a single host (`/32`). Default nmap flags are `-sV -O --traceroute` – root or an elevated shell
(plus Npcap on Windows) is needed for `-O`. The script keeps LF endings (see `.gitattributes`), so
keep your editor on LF for `.sh` files.

---

After pulling changes, `docker compose up -d --build` rebuilds and restarts in place. For a
hot-reloading dev server run Vite on the host instead (`cd App && npm run dev`, with `npm run api`
beside it if you want accounts) — see *Local development* above.

## Offline executables (Windows and Linux)

`npm run standalone` turns the app into **one executable per platform**: the compiled SPA is
embedded in the binary, so there is no Node.js install, no Docker, no nginx and no network access
involved. Start it and the editor opens in your browser.

> Could get flagged by Windows Smart App Control because the single-file build strips the Authenticode signature from `node.exe`. Use `npm run standalone:portable` to get a signed `node.exe` plus the same `standalone.cjs` bundle in a folder with a `start.cmd` / `start.sh` launcher. The portable folder is also the way to get

```powershell
cd App
npm ci
npm run standalone                  # release/nmap2flowchart-win-x64.exe and release/nmap2flowchart-linux-x64
npm run standalone -- --target all  # add the arm64 builds
```

```powershell
.\release\nmap2flowchart-portable-win-x64\start.cmd          # same flags as the .exe
```

### Using the Self contained Exe with node built in
```powershell
.\release\nmap2flowchart-win-x64.exe
```

```bash
chmod +x release/nmap2flowchart-linux-x64
./release/nmap2flowchart-linux-x64
```

| Flag | Purpose |
| --- | --- |
| `--port <n>` | Port to listen on. Default `8080`; a busy port moves to the next free one, `0` picks any. |
| `--host <addr>` | Interface to bind. Default `127.0.0.1`, so nothing is reachable from the network. |
| `--open` / `--no-open` | Force or suppress opening the browser (default: open when started from a terminal). |
| `--auth` | Enable local accounts and project autosave. |
| `--data-dir <dir>` | Where that SQLite database lives. |
| `-v`, `--version`, `-h`, `--help` | Print the build’s version or usage. |

The `NMAP_*` variables from the table below still work (`NMAP_API_PORT`, `NMAP_API_HOST`,
`NMAP_DATA_DIR`, `NMAP_AUTH_ENABLED`, …), so the executable can be run from a service manager with
the same configuration as the containers.


### Using the portable app.cjs

```powershell
cd App
npm run standalone:portable
```

`app.cjs` is the whole app — compiled SPA plus accounts API — as a 1 MB script, so on any machine that
already has **Node.js 24+** it is a one-file download:

```bash
node app.cjs        # http://127.0.0.1:8080/
```

## Which NMAP scans work

Any `nmap -oX` output imports, from a two-second ping sweep to a full audit. More detail simply
means more detail on the cards:

| Command | What you get on the canvas |
| --- | --- |
| `nmap -sn -oX ping.xml 10.0.0.0/24` | Live hosts only (with MAC and vendor when ARP answers). Cards read **discovered · no port scan** – nmap never looked at ports, so the app doesn't pretend they are closed. |
| `nmap -Pn -oX file.xml 10.0.0.0/24` | Hosts plus the default top-1000 port table. Service *names* come from nmap's table, so cards show `22/ssh` – no versions or scripts. |
| `nmap -sS -oX file.xml 10.0.0.0/24` | The same as `-Pn`, driven by SYN replies instead of ping. Needs root; without it use `-sT`, which produces the same XML. |
| `nmap -sV -sC --traceroute -oX full.xml …` | Everything: service versions, NSE script output, OS guesses and a traceroute lane. |
