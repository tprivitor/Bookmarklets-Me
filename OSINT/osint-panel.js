if (!document.getElementById("osint-panel")) {
(function () {

  // ================= CONFIG =================
  // Central configuration for branding, crawling speed, UI refresh,
  // and third-party phone parsing library.
  var CONFIG = {
    panelId: "osint-panel",
    outputTitle: "OSINTERKLAAS",

    // Primary logo: real remote image.
    // Fallback logo: inline SVG that survives strict CSP environments.
    logoPrimary: "https://avatars.githubusercontent.com/u/260715981",
    logoFallback: "data:image/svg+xml;utf8," + encodeURIComponent(
      '<svg xmlns="http://www.w3.org/2000/svg" width="96" height="96" viewBox="0 0 96 96">' +
      '<defs>' +
      '<linearGradient id="bg" x1="0" y1="0" x2="0" y2="1">' +
      '<stop offset="0%" stop-color="#1a1f27"/>' +
      '<stop offset="100%" stop-color="#0c1016"/>' +
      '</linearGradient>' +
      '<linearGradient id="hat" x1="0" y1="0" x2="1" y2="1">' +
      '<stop offset="0%" stop-color="#ff5b4d"/>' +
      '<stop offset="100%" stop-color="#b30f19"/>' +
      '</linearGradient>' +
      '<linearGradient id="gold" x1="0" y1="0" x2="1" y2="1">' +
      '<stop offset="0%" stop-color="#ffe08a"/>' +
      '<stop offset="100%" stop-color="#c9961a"/>' +
      '</linearGradient>' +
      '</defs>' +
      '<rect width="96" height="96" rx="48" fill="url(#bg)"/>' +
      '<circle cx="48" cy="48" r="44" fill="none" stroke="#2b3440" stroke-width="2"/>' +
      '<path d="M24 34 C28 14, 68 14, 72 34 L67 48 H29 Z" fill="url(#hat)" stroke="url(#gold)" stroke-width="2"/>' +
      '<path d="M43 18 L53 18 L51 28 L59 28 L50 34 L52 45 L43 37 L34 45 L37 34 L28 28 L45 28 Z" fill="url(#gold)" opacity="0.9"/>' +
      '<ellipse cx="48" cy="58" rx="24" ry="18" fill="#222831"/>' +
      '<ellipse cx="39" cy="56" rx="5" ry="4" fill="#8cff6a"/>' +
      '<ellipse cx="57" cy="56" rx="5" ry="4" fill="#8cff6a"/>' +
      '<circle cx="39" cy="56" r="2" fill="#0d1117"/>' +
      '<circle cx="57" cy="56" r="2" fill="#0d1117"/>' +
      '<path d="M36 66 C42 72, 54 72, 60 66" stroke="#f2f2f2" stroke-width="4" stroke-linecap="round" fill="none"/>' +
      '<path d="M34 70 C40 78, 56 78, 62 70" stroke="#d7dce2" stroke-width="3" stroke-linecap="round" fill="none"/>' +
      '<rect x="36" y="72" width="24" height="10" rx="3" fill="#11161d" stroke="#344252"/>' +
      '<rect x="41" y="76" width="14" height="2" rx="1" fill="#58a6ff"/>' +
      '</svg>'
    ),

    // Number of simultaneous page scans after discovery is complete.
    scanConcurrency: 10,

    // How often the UI should fully redraw result tables during scanning.
    uiRefreshEvery: 5,

    // Browser-friendly libphonenumber bundle used to validate and normalize phones.
    phoneLibUrl: "https://unpkg.com/libphonenumber-js@1.11.10/bundle/libphonenumber-max.js"
  };

  // ================= STATE =================
  // Runtime state for the current scan session.
  // This keeps crawl info, output window handles, and collected results.
  var state = {
    domain: location.hostname,
    baseDomain: location.hostname.replace(/^www\./i, "").toLowerCase(),
    encodedURL: encodeURIComponent(location.href),
    startUrl: location.href.replace(/\/+$/, "").toLowerCase(),
    maxDepth: 2,
    status: "Idle",
    links: [],
    discovered: 0,
    scanned: 0,
    startTime: 0,
    outputWin: null,
    outputDoc: null,
    lastStatsHTML: "",
    phoneLibPromise: null,
    stopRequested: false,
    results: {
      email: new Map(),
      phone: new Map(),
      external: new Map(),
      social: new Map()
    }
  };

  // Regex patterns for lightweight extraction.
  // Phones are handled separately because they need validation/normalization.
  var PATTERNS = {
    email: /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-z]{2,}/g,
    social: /https?:\/\/[^\s"'<>]*(facebook|instagram|linkedin|twitter|tiktok|youtube)[^\s"'<>]*/gi,
    external: new RegExp("https?:\\/\\/(?!(?:[^\\/\\s\"'<>]+\\.)?" + state.baseDomain.replace(/\./g, "\\.") + "(?:[\\/\\s\"'<>?:#]|$))[^\\s\"'<>]+", "gi")
  };

  // Broad phone candidate matcher.
  // Intentionally permissive; proper filtering happens later with heuristics and libphonenumber.
  var PHONE_CANDIDATE_RE = /(?:(?:\+|00)?\d[\d\s().\/-]{4,}\d)/g;

  // ================= LOGO =================
  /**
   * Tries to load the real remote logo first.
   * If the site blocks remote images via CSP, it automatically swaps to the inline SVG fallback.
   * If even that fails, the image element gets hidden cleanly.
   *
   * This keeps the panel visually stable on strict sites without breaking the layout.
   */
  function setupLogo(img) {
    if (!img) return;

    img.src = CONFIG.logoPrimary;

    img.onerror = function () {
      if (img.src !== CONFIG.logoFallback) {
        img.src = CONFIG.logoFallback;
      } else {
        img.style.display = "none";
      }
    };
  }

  // ================= SEARCH HELPERS =================
  /**
   * Reads the custom site-search query from the panel input.
   *
   * Returns:
   * - the trimmed input if present
   * - otherwise the current domain
   *
   * This keeps the feature usable out of the box while allowing quick
   * expansion with custom search terms such as:
   * - contact
   * - login
   * - pdf
   * - "privacy policy"
   */
  function getSiteSearchQuery() {
    var input = document.getElementById("osint-site-search-input");
    var value = "";

    if (input && typeof input.value === "string") {
      value = input.value.trim();
    }

    return value || state.domain;
  }

  /**
   * Opens a Google site-restricted search using the current domain plus
   * an optional custom query from the panel input field.
   *
   * Examples:
   * - site:example.com
   * - site:example.com contact
   * - site:example.com "privacy policy"
   *
   * This replaces the old fixed site-search button with something more
   * useful while preserving the same external-search feature.
   */
  function openSiteSearch() {
    var customQuery = getSiteSearchQuery();
    var query = "site:" + state.domain;

    if (customQuery && customQuery !== state.domain) {
      query += " " + customQuery;
    }

    window.open("https://www.google.com/search?q=" + encodeURIComponent(query), "_blank");
  }

  // ================= PANEL =================
  /**
   * Builds the floating control panel that appears on the current page.
   *
   * Responsibilities:
   * - inject scoped CSS for the panel UI
   * - render all operational buttons and inputs
   * - wire up button actions
   * - initialize the panel logo with graceful fallback behavior
   *
   * This function only creates the control surface.
   * Actual crawling/scanning happens later in runOSINTScraper().
   */
  function buildPanel() {
    var panel = document.createElement("div");
    panel.id = CONFIG.panelId;
    panel.style = [
      "position:fixed",
      "top:20px",
      "right:20px",
      "z-index:9999999",
      "width:340px",
      "max-height:calc(100vh - 40px)",
      "background:linear-gradient(180deg,rgba(14,18,24,0.96),rgba(8,11,16,0.96))",
      "border:1px solid rgba(255,255,255,0.08)",
      "border-radius:22px",
      "box-shadow:0 30px 80px rgba(0,0,0,0.50), 0 0 0 1px rgba(255,255,255,0.02) inset",
      "backdrop-filter:blur(16px)",
      "color:#e6f7ef",
      "font-family:Inter,system-ui,-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif",
      "overflow:hidden"
    ].join(";");

    var style = document.createElement("style");
    style.textContent = ""
      + "#osint-panel, #osint-panel *{box-sizing:border-box;line-height:normal !important;}"
      + "#osint-panel .osint-shell{position:relative;}"
      + "#osint-panel .osint-topbar{display:flex;align-items:center;justify-content:space-between;padding:16px 16px 12px 16px;background:linear-gradient(180deg,rgba(255,255,255,0.04),rgba(255,255,255,0));border-bottom:1px solid rgba(255,255,255,0.06);}"
      + "#osint-panel .osint-brand{display:flex;align-items:center;gap:12px;min-width:0;}"
      + "#osint-panel .osint-brand img{width:44px;height:44px;border-radius:50%;box-shadow:0 0 0 1px rgba(255,255,255,0.06),0 0 20px rgba(0,255,156,0.18);flex-shrink:0;background:#0d1117;object-fit:cover;}"
      + "#osint-panel .osint-brand-text{min-width:0;}"
      + "#osint-panel .osint-title{font-size:14px;font-weight:700;letter-spacing:0.6px;color:#f3fbf7;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}"
      + "#osint-panel .osint-subtitle{font-size:11px;color:#8fb7a5;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;margin-top:2px;}"
      + "#osint-panel .osint-actions{display:flex;gap:8px;align-items:center;}"
      + "#osint-panel .osint-icon-btn{width:30px;height:30px;border-radius:10px;border:1px solid rgba(255,255,255,0.08);background:rgba(255,255,255,0.04);display:flex;align-items:center;justify-content:center;color:#d9e6df;cursor:pointer;user-select:none;font-size:14px;line-height:1;transition:all .18s ease;}"
      + "#osint-panel .osint-icon-btn:hover{background:rgba(255,255,255,0.08);border-color:rgba(255,255,255,0.14);}"
      + "#osint-panel .osint-close:hover{color:#ff8f8f;border-color:rgba(255,95,86,0.22);background:rgba(255,95,86,0.08);}"
      + "#osint-panel .osint-min:hover{color:#ffe38b;border-color:rgba(245,196,81,0.22);background:rgba(245,196,81,0.08);}"
      + "#osint-panel .osint-body{padding:16px;max-height:calc(100vh - 120px);overflow-y:auto;overflow-x:hidden;scrollbar-width:thin;scrollbar-color:#24303d #0a0e13;}"
      + "#osint-panel .osint-body::-webkit-scrollbar{width:8px;}"
      + "#osint-panel .osint-body::-webkit-scrollbar-track{background:#0a0e13;}"
      + "#osint-panel .osint-body::-webkit-scrollbar-thumb{background:#24303d;border-radius:8px;}"
      + "#osint-panel .osint-domain-chip{display:flex;align-items:center;gap:8px;padding:10px 12px;border-radius:14px;background:linear-gradient(180deg,rgba(255,255,255,0.035),rgba(255,255,255,0.015));border:1px solid rgba(255,255,255,0.06);margin-bottom:14px;}"
      + "#osint-panel .osint-domain-dot{width:8px;height:8px;border-radius:50%;background:#00ff9c;box-shadow:0 0 10px rgba(0,255,156,0.65);flex-shrink:0;}"
      + "#osint-panel .osint-domain-text{font-size:12px;color:#d7f7e8;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}"
      + "#osint-panel .osint-section{margin-bottom:14px;padding:13px;border-radius:16px;background:linear-gradient(180deg,rgba(255,255,255,0.03),rgba(255,255,255,0.01));border:1px solid rgba(255,255,255,0.06);box-shadow:inset 0 1px 0 rgba(255,255,255,0.03);}"
      + "#osint-panel .osint-section:last-child{margin-bottom:0;}"
      + "#osint-panel .osint-section-title{font-size:11px;font-weight:700;letter-spacing:1px;text-transform:uppercase;color:#8fb7a5;margin-bottom:10px;}"
      + "#osint-panel .osint-label{font-size:11px;color:#94a9a0;margin-bottom:6px;display:block;}"
      + "#osint-panel .osint-input{width:100%;border:none;outline:none;padding:11px 12px;border-radius:12px;background:#0b1016;color:#e8fff4;border:1px solid rgba(255,255,255,0.07);font-size:13px;box-shadow:inset 0 1px 0 rgba(255,255,255,0.03);}"
      + "#osint-panel .osint-input:focus{border-color:rgba(0,255,156,0.25);box-shadow:0 0 0 3px rgba(0,255,156,0.08), inset 0 1px 0 rgba(255,255,255,0.03);}"
      + "#osint-panel .osint-btn{width:100%;border:none;outline:none;padding:11px 12px;border-radius:12px;font-size:13px;font-weight:600;cursor:pointer;transition:all .18s ease;}"
      + "#osint-panel .osint-btn-primary{margin-top:10px;background:linear-gradient(180deg,#123022,#0d2219);color:#b7ffd9;border:1px solid rgba(0,255,156,0.22);box-shadow:0 10px 22px rgba(0,255,156,0.08), inset 0 1px 0 rgba(255,255,255,0.04);}"
      + "#osint-panel .osint-btn-primary:hover{transform:translateY(-1px);background:linear-gradient(180deg,#153727,#0f281d);}"
      + "#osint-panel .osint-grid{display:grid;grid-template-columns:1fr 1fr;gap:8px;}"
      + "#osint-panel .osint-btn-soft{background:linear-gradient(180deg,#121923,#0e141c);color:#d9e4f1;border:1px solid rgba(255,255,255,0.08);}"
      + "#osint-panel .osint-btn-soft:hover{background:linear-gradient(180deg,#16202b,#111923);transform:translateY(-1px);}"
      + "#osint-panel .osint-divider{height:1px;background:linear-gradient(90deg,rgba(255,255,255,0),rgba(255,255,255,0.07),rgba(255,255,255,0));margin:2px 0 14px 0;}";

    document.head.appendChild(style);

    panel.innerHTML = ""
      + "<div class='osint-shell'>"
      +   "<div class='osint-topbar'>"
      +     "<div class='osint-brand'>"
      +       "<img id='osint-logo-panel' alt='logo'>"
      +       "<div class='osint-brand-text'>"
      +         "<div class='osint-title'>OSINTERKLAAS</div>"
      +         "<div class='osint-subtitle'>OSINT Panel</div>"
      +       "</div>"
      +     "</div>"
      +     "<div class='osint-actions'>"
      +       "<div id='osint-min-btn' class='osint-icon-btn osint-min'>—</div>"
      +       "<div id='osint-close-btn' class='osint-icon-btn osint-close'>✕</div>"
      +     "</div>"
      +   "</div>"

      +   "<div id='osint-body' class='osint-body'>"
      +     "<div class='osint-domain-chip'>"
      +       "<div class='osint-domain-dot'></div>"
      +       "<div class='osint-domain-text'>" + state.domain + "</div>"
      +     "</div>"

      +     "<div class='osint-section'>"
      +       "<div class='osint-section-title'>Scraper</div>"
      +       "<label class='osint-label' for='osint-depth'>Crawl depth</label>"
      +       "<input id='osint-depth' class='osint-input' value='2'>"
      +       "<button id='osint-scan-btn' class='osint-btn osint-btn-primary'>Scan site</button>"
      +     "</div>"

      +     "<div class='osint-divider'></div>"

      +     "<div class='osint-section'>"
      +       "<div class='osint-section-title'>Archive</div>"
      +       "<div class='osint-grid'>"
      +         "<button id='osint-wayback' class='osint-btn osint-btn-soft'>Wayback history</button>"
      +         "<button id='osint-save' class='osint-btn osint-btn-soft'>Save snapshot</button>"
      +       "</div>"
      +     "</div>"

      +     "<div class='osint-section'>"
      +       "<div class='osint-section-title'>Page</div>"
      +       "<div class='osint-grid'>"
      +         "<button id='osint-view-text' class='osint-btn osint-btn-soft'>View text</button>"
      +       "</div>"
      +     "</div>"

      +     "<div class='osint-section'>"
      +       "<div class='osint-section-title'>Domain</div>"
      +       "<div class='osint-grid'>"
      +         "<button id='osint-whois' class='osint-btn osint-btn-soft'>WHOIS lookup</button>"
      +         "<button id='osint-builtwith' class='osint-btn osint-btn-soft'>BuiltWith</button>"
      +       "</div>"
      +     "</div>"

      +     "<div class='osint-section'>"
      +       "<div class='osint-section-title'>Search</div>"
      +       "<label class='osint-label' for='osint-site-search-input'>Site search query</label>"
      +       "<input id='osint-site-search-input' class='osint-input' placeholder='contact, pdf, &quot;privacy policy&quot; ...'>"
      +       "<div class='osint-grid' style='margin-top:10px;'>"
      +         "<button id='osint-site-query' class='osint-btn osint-btn-soft'>Site search</button>"
      +       "</div>"
      +     "</div>"
      +   "</div>"
      + "</div>";

    document.body.appendChild(panel);

    setupLogo(document.getElementById("osint-logo-panel"));

    document.getElementById("osint-close-btn").onclick = function () {
      panel.remove();
    };

    document.getElementById("osint-min-btn").onclick = function () {
      var body = document.getElementById("osint-body");
      var btn = document.getElementById("osint-min-btn");
      body.style.display = body.style.display === "none" ? "block" : "none";
      btn.innerHTML = body.style.display === "none" ? "+" : "—";
    };

    // Pressing Enter in the site search field should immediately run the site search.
    document.getElementById("osint-site-search-input").onkeydown = function (event) {
      if (event.key === "Enter") {
        event.preventDefault();
        openSiteSearch();
      }
    };

    // Pressing Enter in the crawl depth field should immediately start the scan.
    document.getElementById("osint-depth").onkeydown = function (event) {
      if (event.key === "Enter") {
        event.preventDefault();
        runOSINTScraper();
      }
    };

    document.getElementById("osint-scan-btn").onclick = function () {
      runOSINTScraper();
    };
    document.getElementById("osint-wayback").onclick = function () {
      window.open("https://web.archive.org/web/*/" + location.href);
    };
    document.getElementById("osint-save").onclick = function () {
      window.open("https://web.archive.org/save/" + location.href);
    };
    document.getElementById("osint-view-text").onclick = function () {
      window.open("https://textise.net/showtext.aspx?strURL=" + state.encodedURL);
    };
    document.getElementById("osint-whois").onclick = function () {
      window.open("https://who.is/whois/" + state.domain);
    };
    document.getElementById("osint-builtwith").onclick = function () {
      window.open("https://builtwith.com/" + state.domain);
    };
    document.getElementById("osint-site-query").onclick = function () {
      openSiteSearch();
    };
  }

  function stopOSINTScraper() {
    state.stopRequested = true;
    state.status = "Stopped";
    renderStats();

    if (state.outputDoc) {
      var btn = state.outputDoc.getElementById("osint-stop-btn");
      if (btn) {
        btn.disabled = true;
        btn.textContent = "Stopped";
      }

      var loader = state.outputDoc.getElementById("loader");
      if (loader) {
        loader.style.display = "none";
      }
    }
  }

  // ================= OUTPUT UI =================
  /**
   * Opens the separate output/results window and renders its full shell.
   *
   * Responsibilities:
   * - create a dedicated result dashboard in a new tab/window
   * - inject the output-specific monospace styling
   * - render the stats bar, loading spinner, and result cards
   * - initialize the logo in the output window
   *
   * The output window is intentionally isolated from the main page so the
   * results remain readable and stable while the crawl continues.
   */
  function openOutputWindow() {
    state.outputWin = window.open("", "_blank");
    state.outputDoc = state.outputWin.document;

    state.outputDoc.body.innerHTML = ""
      + "<style>"
      + ":root{"
      + "--bg:#05070a;"
      + "--bg2:#0b0f14;"
      + "--panel:#0a0e13;"
      + "--panel2:#0d1218;"
      + "--line:#1b2430;"
      + "--line2:#263240;"
      + "--text:#d7dce2;"
      + "--muted:#7f8a96;"
      + "--blue:#8eb8ff;"
      + "--green:#8bd8b0;"
      + "--code:#0c1117;"
      + "}"
      + "*{box-sizing:border-box}"
      + "html,body{margin:0;padding:0}"
      + "body{background:linear-gradient(180deg,var(--bg2),var(--bg));color:var(--text);font-family:ui-monospace,SFMono-Regular,Menlo,Monaco,Consolas,'Liberation Mono','Courier New',monospace;letter-spacing:0.01em;}"
      + ".header{display:flex;align-items:center;gap:14px;padding:18px 22px;border-bottom:1px solid var(--line);position:sticky;top:0;background:rgba(5,7,10,0.96);backdrop-filter:blur(6px);z-index:30;}"
      + ".header img{width:42px;height:42px;border-radius:50%;border:1px solid var(--line2);box-shadow:0 0 0 1px rgba(255,255,255,0.02);background:#0d1117;object-fit:cover;}"
      + ".header-text{display:flex;flex-direction:column;gap:3px;min-width:0;}"
      + ".header-title{font-size:15px;font-weight:700;color:#eef3f7;letter-spacing:0.08em;text-transform:uppercase;}"
      + ".header-sub{font-size:11px;color:var(--muted);word-break:break-all;}"
      + ".header-actions{margin-left:auto;}"
      + ".stop-btn{display:none;padding:8px 12px;border:1px solid #5a2323;background:#1a0d0d;color:#ffb3b3;border-radius:4px;font-size:12px;cursor:pointer;}"
      + ".stats{display:flex;gap:10px;flex-wrap:wrap;padding:12px 22px;border-bottom:1px solid var(--line);background:#080b0f;}"
      + ".stat{padding:7px 10px;border:1px solid var(--line2);background:var(--panel);border-radius:4px;font-size:11px;color:#cfd7df;text-transform:uppercase;}"
      + "#loader{border:3px solid #1a2430;border-top:3px solid #7ea5d4;border-radius:50%;width:28px;height:28px;animation:spin 0.9s linear infinite;margin:18px auto 0 auto;}"
      + "@keyframes spin{100%{transform:rotate(360deg)}}"
      + ".grid{display:grid;grid-template-columns:1fr 1fr;gap:18px;padding:22px;width:100%;}"
      + ".card{background:linear-gradient(180deg,var(--panel2),var(--panel));border:1px solid var(--line);border-radius:6px;display:flex;flex-direction:column;height:520px;overflow:hidden;}"
      + ".card h2{margin:0;padding:12px 14px;border-bottom:1px solid var(--line);font-size:12px;font-weight:700;color:#ecf1f6;text-transform:uppercase;letter-spacing:0.08em;background:#0c1117;}"
      + ".table-container{flex:1;overflow:auto;background:var(--code);}"
      + ".table-container::-webkit-scrollbar{width:8px;height:8px}"
      + ".table-container::-webkit-scrollbar-track{background:#0a0e13}"
      + ".table-container::-webkit-scrollbar-thumb{background:#24303d;border-radius:0}"
      + "table{width:100%;border-collapse:collapse}"
      + "th,td{padding:9px 8px;border-bottom:1px solid var(--line);font-size:12px;vertical-align:top;word-break:break-word;}"
      + "th{position:sticky;top:0;background:#0d131a;color:var(--muted);text-align:left;font-weight:700;text-transform:uppercase;font-size:11px;letter-spacing:0.06em;z-index:2;}"
      + "tbody tr:nth-child(even) td{background:rgba(255,255,255,0.012)}"
      + "tbody tr:hover td{background:rgba(142,184,255,0.04)}"
      + "td:first-child{color:#e2e8ef}"
      + ".meta-cell{white-space:nowrap}"
      + ".count{display:inline-block;min-width:30px;padding:2px 7px;border:1px solid #29415b;background:#101a25;color:#9dc7ff;border-radius:3px;font-size:11px;margin-right:8px;text-align:center;}"
      + ".toggle-sources{display:inline-block;padding:2px 7px;border:1px solid #2b3642;background:#0e141a;color:#b7d6ff;border-radius:3px;font-size:11px;cursor:pointer;user-select:none;}"
      + ".toggle-sources:hover{background:#121a22;color:#d5e7ff;}"
      + ".sources-row td{background:#0a1117 !important;padding:0;border-bottom:1px solid var(--line2);}"
      + ".sources-wrap{padding:10px 12px 12px 12px;background:#0a1117;}"
      + ".sources-title{font-size:11px;color:var(--green);text-transform:uppercase;letter-spacing:0.08em;margin-bottom:8px;}"
      + ".sources-list{display:flex;flex-direction:column;gap:6px;max-height:220px;overflow:auto;}"
      + ".sources-list::-webkit-scrollbar{width:8px}"
      + ".sources-list::-webkit-scrollbar-track{background:#0a0f14}"
      + ".sources-list::-webkit-scrollbar-thumb{background:#24303d}"
      + ".source-item{display:flex;align-items:flex-start;gap:8px;padding:7px 8px;border:1px solid var(--line);background:#0d141b;border-radius:3px;color:#dbe3ea;font-size:12px;word-break:break-word;}"
      + ".source-bullet{color:#b9efd0;flex-shrink:0;}"
      + ".variant-title{font-size:11px;color:var(--blue);text-transform:uppercase;letter-spacing:0.08em;margin:12px 0 8px 0;}"
      + ".empty{color:var(--muted);}"
      + "@media (max-width:980px){.grid{grid-template-columns:1fr;}}"
      + "</style>"

      + "<div class='header'>"
      +   "<img id='osint-logo-output' alt='logo'>"
      +   "<div class='header-text'>"
      +     "<div class='header-title'>" + CONFIG.outputTitle + " / OUTPUT</div>"
      +     "<div class='header-sub'>" + state.domain + "</div>"
      +   "</div>"
      +   "<div class='header-actions'>"
      +     "<button id='osint-stop-btn' class='stop-btn'>Stop</button>"
      +   "</div>"
      + "</div>"

      + "<div class='stats' id='stats'></div>"
      + "<div id='loader'></div>"

      + "<div class='grid'>"
      +   buildCard("Emails", "emailBody")
      +   buildCard("Possible phone numbers", "phoneBody")
      +   buildCard("External Links", "externalBody")
      +   buildCard("Social Profiles", "socialBody")
      + "</div>";

    setupLogo(state.outputDoc.getElementById("osint-logo-output"));

    state.outputDoc.getElementById("osint-stop-btn").onclick = stopOSINTScraper;
  }

  /**
   * Builds one result card container for the output dashboard.
   *
   * Each card contains:
   * - a title
   * - a scrollable table
   * - a tbody placeholder that later gets filled by renderCategory()
   *
   * This is intentionally generic so all result types share the same structure.
   */
  function buildCard(title, id) {
    return ""
      + "<div class='card'>"
      +   "<h2>" + title + "</h2>"
      +   "<div class='table-container'>"
      +     "<table>"
      +       "<thead><tr><th>Value</th><th>Details</th></tr></thead>"
      +       "<tbody id='" + id + "'></tbody>"
      +     "</table>"
      +   "</div>"
      + "</div>";
  }

  // ================= STATS RENDER =================
  /**
   * Renders the live stats bar inside the output window.
   *
   * Depending on the current phase, this shows:
   * - status
   * - pages found during discovery
   * - pages scanned during the scan phase
   * - average scan speed
   *
   * When the scan has finished, speed is intentionally forced to 0.0/s
   * so the UI does not keep implying ongoing throughput after completion.
   *
   * To avoid unnecessary DOM churn, the stats area only updates when the
   * generated HTML actually changes.
   */
  function renderStats() {
    var doc = state.outputDoc;
    var speed;
    var html;

    if (!doc) return;

    // Hide or disable the Stop button based on the current status.
    var stopBtn = doc.getElementById("osint-stop-btn");
      var canStop = state.status === "Discovering" || state.status === "Scanning";

      if (stopBtn) {
        stopBtn.style.display = canStop ? "inline-block" : "none";
        stopBtn.disabled = !canStop;
        stopBtn.textContent = state.status === "Stopped" ? "Stopped" : "Stop";
      }

    if (state.status === "Done") {
      speed = "0.0";
    } else {
      speed = (state.scanned / ((Date.now() - state.startTime) / 1000 || 1)).toFixed(1);
    }

    html = "<div class='stat'>Status: " + state.status + "</div>";

    if (state.status === "Discovering") {
      html += "<div class='stat'>Pages Found: " + state.discovered + "</div>";
    } else {
      html += "<div class='stat'>Pages: " + state.links.length + "</div>";
      html += "<div class='stat'>Scanned: " + state.scanned + "/" + state.links.length + "</div>";
    }

    html += "<div class='stat'>Speed: " + speed + "/s</div>";

    if (html !== state.lastStatsHTML) {
      doc.getElementById("stats").innerHTML = html;
      state.lastStatsHTML = html;
    }
  }

  // ================= PHONE HELPERS =================

// Broad candidate matcher for possible phone numbers.
// OSINT-style: we prefer recall over strict validation.
var PHONE_CANDIDATE_RE = /(?:\+|00)?\d(?:[\d\s().\/-]{5,}\d)/g;

function chooseBestPhoneDisplay(currentDisplay, newDisplay) {
  if (!currentDisplay) return newDisplay;
  if (newDisplay.charAt(0) === "+" && currentDisplay.charAt(0) !== "+") return newDisplay;
  if (newDisplay.length > currentDisplay.length) return newDisplay;
  return currentDisplay;
}

function looksTooFakeAsPhone(raw) {
  var digits = (raw || "").replace(/\D/g, "");

  if (digits.length < 7 || digits.length > 15) return true;
  if (/^(\d)\1+$/.test(digits)) return true;
  if (/^0+$/.test(digits)) return true;
  if (/^\d{4}-\d{2}-\d{2}$/.test((raw || "").trim())) return true;
  if (/^\d+\.\d+$/.test((raw || "").trim())) return true;

  return false;
}

function normalizeLoosePhone(raw) {
  var value = (raw || "").trim();
  var normalized;

  if (!value) return null;

  normalized = value.replace(/[^\d+]/g, "");

  if (normalized.indexOf("00") === 0) {
    normalized = "+" + normalized.slice(2);
  }

  if (normalized.charAt(0) === "+") {
    normalized = "+" + normalized.slice(1).replace(/\D/g, "");
  } else {
    normalized = normalized.replace(/\D/g, "");
  }

  if (normalized.replace(/\D/g, "").length < 7 || normalized.replace(/\D/g, "").length > 15) {
    return null;
  }

  return normalized;
}

function addPossiblePhoneResult(rawValue, url) {
  var bucket = state.results.phone;
  var raw = (rawValue || "").trim();
  var normalized = normalizeLoosePhone(raw);
  var key = normalized || raw;
  var entry;

  if (!raw || looksTooFakeAsPhone(raw)) return;

  if (bucket.has(key)) {
    entry = bucket.get(key);
    entry.count++;
    entry.sources.add(url);
    entry.variants.add(raw);
    entry.display = chooseBestPhoneDisplay(entry.display, raw);
    return;
  }

  bucket.set(key, {
    count: 1,
    sources: new Set([url]),
    variants: new Set([raw]),
    display: raw,
    raw: raw,
    normalized: normalized,
    expanded: false
  });
}

function extractPhonesFromText(text, url) {
  var matches;
  var i;
  var raw;

  if (!text) return;

  matches = text.match(PHONE_CANDIDATE_RE);
  if (!matches || !matches.length) return;

  for (i = 0; i < matches.length; i++) {
    raw = matches[i].trim();
    addPossiblePhoneResult(raw, url);
  }
}

function extractPhonesFromTelLinks(doc, url) {
  var links;
  var i;
  var href;
  var raw;

  if (!doc || !doc.querySelectorAll) return;

  links = doc.querySelectorAll('a[href^="tel:"], a[href^="TEL:"]');

  for (i = 0; i < links.length; i++) {
    href = links[i].getAttribute("href") || "";
    raw = href.replace(/^tel:/i, "").trim();

    if (raw) {
      addPossiblePhoneResult(raw, url);
    }
  }
}

function extractPhonesFromDoc(doc, url) {
  var text = ((doc.body && doc.body.textContent) || "").replace(/\u00A0/g, " ");
  extractPhonesFromText(text, url);
  extractPhonesFromTelLinks(doc, url);
}

  // ================= COLLECTOR =================
  /**
   * Generic result collector for non-phone result types.
   *
   * Used for:
   * - emails
   * - external links
   * - social links
   *
   * Deduplicates by value and tracks:
   * - total count
   * - source pages
   * - expanded row state
   */
  function addResult(type, value, url) {
    var bucket = state.results[type];
    var entry;

    if (typeof value !== "string") return;
    value = value.trim();
    if (!value) return;

    if (bucket.has(value)) {
      entry = bucket.get(value);
      entry.count++;
      entry.sources.add(url);
      return;
    }

    bucket.set(value, {
      count: 1,
      sources: new Set([url]),
      expanded: false
    });
  }

  /**
   * Batch helper that feeds a regex match array into addResult().
   *
   * This exists to keep extractMatches() short and predictable.
   */
  function addMatches(type, matches, url) {
    var i;
    if (!matches || !matches.length) return;
    for (i = 0; i < matches.length; i++) {
      addResult(type, matches[i], url);
    }
  }

  /**
   * Runs all extractors against a page's text content.
   *
   * Current extraction pipeline:
   * - email regex
   * - external URL regex
   * - social URL regex
   * - phone candidate regex + validation
   *
   * This is the single entry point for per-page data extraction.
   */
  function extractMatches(doc, url) {
    var text = ((doc.body && doc.body.textContent) || "").replace(/\u00A0/g, " ");

    addMatches("email", text.match(PATTERNS.email), url);
    addMatches("external", text.match(PATTERNS.external), url);
    addMatches("social", text.match(PATTERNS.social), url);

    extractPhonesFromDoc(doc, url);
}

  // ================= EXPANDABLE ROWS =================
  /**
   * Toggles the expanded state for a single result row and re-renders
   * that result category table.
   *
   * Expanded rows are used instead of tooltips because:
   * - they scale to long lists
   * - text stays selectable/copyable
   * - there is no hover flicker
   */
  function toggleExpanded(type, value) {
    var bucket = state.results[type];
    if (!bucket.has(value)) return;
    var entry = bucket.get(value);
    entry.expanded = !entry.expanded;
    renderCategory(type, getBodyIdForType(type));
  }

  /**
   * Maps a logical result type to the corresponding tbody id
   * inside the output dashboard.
   */
  function getBodyIdForType(type) {
    if (type === "email") return "emailBody";
    if (type === "phone") return "phoneBody";
    if (type === "external") return "externalBody";
    if (type === "social") return "socialBody";
    return "";
  }

  /**
   * Builds the expanded details block shown under a result row.
   *
   * It always shows:
   * - source pages where the value was found
   *
   * For phones it also shows:
   * - all raw format variants encountered
   *
   * This keeps the main table clean while preserving evidence and context.
   */
  function buildSourcesRow(doc, type, entry) {
    var wrapper = doc.createElement("div");
    wrapper.className = "sources-wrap";

    var title = doc.createElement("div");
    title.className = "sources-title";
    title.textContent = "Found on";
    wrapper.appendChild(title);

    var listEl = doc.createElement("div");
    listEl.className = "sources-list";

    var sources = Array.from(entry.sources);
    var i;
    var item;
    var bullet;
    var text;
    var variantsTitle;
    var variantsList;
    var variants;
    var variantItem;
    var variantBullet;
    var variantText;

    for (i = 0; i < sources.length; i++) {
      item = doc.createElement("div");
      item.className = "source-item";

      bullet = doc.createElement("span");
      bullet.className = "source-bullet";
      bullet.textContent = ">";
      item.appendChild(bullet);

      text = doc.createElement("span");
      text.textContent = sources[i];
      item.appendChild(text);

      listEl.appendChild(item);
    }

    wrapper.appendChild(listEl);

    if (type === "phone") {
      if (entry.normalized) {
        var normalizedTitle = doc.createElement("div");
        normalizedTitle.className = "variant-title";
        normalizedTitle.textContent = "Normalized key";
        wrapper.appendChild(normalizedTitle);

        var normalizedList = doc.createElement("div");
        normalizedList.className = "sources-list";

        var normalizedItem = doc.createElement("div");
        normalizedItem.className = "source-item";

        var normalizedBullet = doc.createElement("span");
        normalizedBullet.className = "source-bullet";
        normalizedBullet.textContent = ">";
        normalizedItem.appendChild(normalizedBullet);

        var normalizedText = doc.createElement("span");
        normalizedText.textContent = entry.normalized;
        normalizedItem.appendChild(normalizedText);

        normalizedList.appendChild(normalizedItem);
        wrapper.appendChild(normalizedList);
      }
    }

    if (type === "phone" && entry.variants && entry.variants.size > 1) {
      variantsTitle = doc.createElement("div");
      variantsTitle.className = "variant-title";
      variantsTitle.textContent = "Raw data seen";
      wrapper.appendChild(variantsTitle);

      variantsList = doc.createElement("div");
      variantsList.className = "sources-list";

      variants = Array.from(entry.variants);

      for (i = 0; i < variants.length; i++) {
        variantItem = doc.createElement("div");
        variantItem.className = "source-item";

        variantBullet = doc.createElement("span");
        variantBullet.className = "source-bullet";
        variantBullet.textContent = ">";
        variantItem.appendChild(variantBullet);

        variantText = doc.createElement("span");
        variantText.textContent = variants[i];
        variantItem.appendChild(variantText);

        variantsList.appendChild(variantItem);
      }

      wrapper.appendChild(variantsList);
    }

    return wrapper;
  }

  // ================= TABLE RENDER =================
  /**
   * Renders one category table in the output window.
   *
   * Behavior:
   * - sorts results by count descending
   * - shows either the normalized display or raw value
   * - adds expandable "sources" control
   * - injects the expanded detail row when needed
   *
   * Phone rows intentionally display the chosen best human-readable number
   * instead of the normalized map key.
   */
  function renderCategory(type, bodyId) {
    var doc = state.outputDoc;
    var body = doc.getElementById(bodyId);
    var entries = Array.from(state.results[type].entries());
    var i;
    var tr;
    var tdValue;
    var tdMeta;
    var countEl;
    var toggleEl;
    var value;
    var meta;
    var sourcesRow;
    var sourcesTd;
    var label;

    body.innerHTML = "";

    if (!entries.length) {
      body.innerHTML = "<tr><td colspan='2' class='empty'>No results yet</td></tr>";
      return;
    }

    entries.sort(function (a, b) {
      return b[1].count - a[1].count;
    });

    for (i = 0; i < entries.length; i++) {
      value = entries[i][0];
      meta = entries[i][1];

      tr = doc.createElement("tr");
      tdValue = doc.createElement("td");
      tdMeta = doc.createElement("td");
      tdMeta.className = "meta-cell";

      tdValue.textContent = type === "phone" ? meta.display : value;

      countEl = doc.createElement("span");
      countEl.className = "count";
      countEl.textContent = "x" + meta.count;

      toggleEl = doc.createElement("span");
      toggleEl.className = "toggle-sources";
      label = meta.expanded ? "hide" : "sources";
      if (type === "phone" && meta.variants && meta.variants.size > 1 && !meta.expanded) {
        label = "sources+";
      }
      toggleEl.textContent = label;
      toggleEl.onclick = (function (currentType, currentValue) {
        return function () {
          toggleExpanded(currentType, currentValue);
        };
      }(type, value));

      tdMeta.appendChild(countEl);
      tdMeta.appendChild(toggleEl);

      tr.appendChild(tdValue);
      tr.appendChild(tdMeta);
      body.appendChild(tr);

      if (meta.expanded) {
        sourcesRow = doc.createElement("tr");
        sourcesRow.className = "sources-row";

        sourcesTd = doc.createElement("td");
        sourcesTd.colSpan = 2;
        sourcesTd.appendChild(buildSourcesRow(doc, type, meta));

        sourcesRow.appendChild(sourcesTd);
        body.appendChild(sourcesRow);
      }
    }
  }

  /**
   * Re-renders all four result categories.
   *
   * This is called during:
   * - first output initialization
   * - incremental refreshes while scanning
   * - final completion refresh
   */
  function renderAllTables() {
    renderCategory("email", "emailBody");
    renderCategory("phone", "phoneBody");
    renderCategory("external", "externalBody");
    renderCategory("social", "socialBody");
  }

  /**
   * Full UI refresh helper for the output window.
   *
   * This updates:
   * - stats bar
   * - all result tables
   *
   * Used sparingly during scanning to avoid unnecessary heavy redraws.
   */
  function refreshUI() {
    renderStats();
    renderAllTables();
  }

  function isInternalUrl(urlString) {
    var hostname;

    try {
      hostname = new URL(urlString).hostname.toLowerCase();
    } catch (err) {
      return false;
    }

    return hostname === state.baseDomain || hostname.endsWith("." + state.baseDomain);
}

  // ================= DISCOVERY =================
  /**
   * Discovers all internal links up to the selected crawl depth.
   *
   * - discovery is done first
   * - scanning/extraction is done second
   *
   * - "Pages Found" belongs to discovery
   * - "Scanned" belongs to extraction
   *
   * This returns a deduplicated list of discovered internal URLs.
   */
  async function discoverLinks() {
    var visited = new Set();

    async function crawl(url, depth) {
      var res;
      var html;
      var docParsed;
      var pageLinks;
      var tasks;
      var i;
      var next;

      // Stop crawl if stop button is clicked
      if (state.stopRequested) return;

      url = url.replace(/\/+$/, "").toLowerCase();

      if (depth > state.maxDepth || visited.has(url)) return;

      visited.add(url);
      state.discovered = visited.size;
      renderStats();

      try {
        res = await fetch(url);
        html = await res.text();

        docParsed = new DOMParser().parseFromString(html, "text/html");
        pageLinks = docParsed.querySelectorAll("a");
        tasks = [];

        for (i = 0; i < pageLinks.length; i++) {
          try {
            next = new URL(pageLinks[i].href, url);
            next.hash = "";
            next = next.href.replace(/\/+$/, "").toLowerCase();

            if (isInternalUrl(next) && !visited.has(next)) {
              tasks.push(crawl(next, depth + 1));
            }

          } catch (err) {}
        }

        await Promise.all(tasks);
      } catch (err) {}
    }

    await crawl(state.startUrl, 0);
    return Array.from(visited);
  }

  // ================= SCANNER =================
  /**
   * Scans the already-discovered URL list in parallel.
   *
   * Workflow:
   * - take discovered URLs as input
   * - distribute them across N workers
   * - fetch page HTML
   * - extract matches from text
   * - update scan counters
   * - refresh UI periodically
   *
   * This phase is intentionally parallelized for speed while keeping the
   * stats and result rendering stable.
   */
  async function scanLinks(urls) {
    var index = 0;
    var workerCount = Math.min(CONFIG.scanConcurrency, urls.length);
    var workers = [];
    var i;

    async function worker() {
      var currentIndex;
      var url;
      var res;
      var html;
      var text;

      while (true) {
        if (state.stopRequested || index >= urls.length) break;
        currentIndex = index;
        index++;

        url = urls[currentIndex];

        // For the current page, check 'document',
        // for the other pages we do the actual fetch. 
        try {
          if (url === state.startUrl) {
            extractMatches(document, url);
          } else {
            res = await fetch(url);
            html = await res.text();
            var docParsed = new DOMParser().parseFromString(html, "text/html");
            extractMatches(docParsed, url);
          }
        } catch (err) {}

        state.scanned++;

        if (state.scanned % CONFIG.uiRefreshEvery === 0 || state.scanned === urls.length) {
          refreshUI();
        } else {
          renderStats();
        }
      }
    }

    for (i = 0; i < workerCount; i++) {
      workers.push(worker());
    }

    await Promise.all(workers);
  }

  // ================= RESET =================
  /**
   * Resets all scan-related runtime state before a fresh run starts.
   *
   * This ensures no previous session data leaks into the next one:
   * - counters reset
   * - timers reset
   * - result maps recreated
   * - crawl depth re-read from the current input field
   */
  function resetState() {
    state.maxDepth = parseInt(document.getElementById("osint-depth").value, 10) || 2;
    state.status = "Discovering";
    state.links = [];
    state.discovered = 0;
    state.scanned = 0;
    state.startTime = Date.now();
    state.lastStatsHTML = "";
    state.phoneLibPromise = null;
    state.stopRequested = false;
    state.results = {
      email: new Map(),
      phone: new Map(),
      external: new Map(),
      social: new Map()
    };
  }

  // ================= START =================
  /**
   * Main entry point for the scraper run.
   *
   * End-to-end flow:
   * 1. reset state
   * 2. open the output dashboard
   * 3. load phone parsing library
   * 4. discover internal pages
   * 5. scan those pages for data
   * 6. mark run as done and hide loader
   *
   * This is the only function the panel calls directly for a scan.
   */
  async function runOSINTScraper() {
    resetState();
    openOutputWindow();
    refreshUI();

    state.links = await discoverLinks();

    state.status = "Scanning";
    refreshUI();

    await scanLinks(state.links);

    state.status = "Done";
    refreshUI();

    state.outputDoc.getElementById("loader").style.display = "none";
  }

  // Initial bootstrapping:
  // build the floating panel and expose the main scan runner globally
  // so the panel button can invoke it.
  buildPanel();
  window.runOSINTScraper = runOSINTScraper;

}());
}
