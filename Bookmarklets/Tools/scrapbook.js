/************************************************************
 * Scrapbook: Bookmarklet to scrape emails & phone numbers
 ************************************************************
 * This script scrapes the current site for emails and phone numbers.
 *
 * Features:
 *  - Recursive link crawling up to a user-specified depth
 *  - Concurrency control to avoid browser crashes
 *  - Real-time progress and loader
 *  - Results tables for Emails and Phones
 *  - Export to PDF, CSV, JSON
 ************************************************************/

/******************************
 * 1. USER SETTINGS
 ******************************/

// Ask user for crawl depth
var userDepth = prompt("Going to scrape the site for URL. How deep should I look?");

// Convert input to a number
userDepth = Number(userDepth);

// Safety fallback
if (!userDepth || isNaN(userDepth) || userDepth > 10) {
    userDepth = 2; // default depth
}

// Maximum concurrent fetches
const MAX_CONCURRENT = 5;

// Maximum retries for failed fetches (future use)
const MAX_RETRIES = 3;

// Get current domain
const domain = location.hostname;

/******************************
 * 2. DATA STORAGE
 ******************************/

// Track URLs that have been visited
const seen = new Set();

// Store collected emails with their source URLs
const emails = new Map();

// Store collected phone numbers with their source URLs
const phones = new Map();

// Regex patterns
const patterns = {
  // Email regex
  email: /\b[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-z]{2,}\b/g,
  // Phone regex (broad to capture various formats)
  // TODO: improve regex
  phone: /(?:\+|00)?[\d\s\-().]{8,30}/g
};

/******************************
 * 3. OPEN RESULTS WINDOW
 ******************************/

var win = window.open("", "_blank");
var doc = win.document;

// Write initial HTML
doc.open();
doc.write("<!DOCTYPE html><html><head><title>Initializing...</title></head><body></body></html>");
doc.close();

// Set page title
doc.title = `Results for ${domain}`;

// Inject CSS styles
const style = doc.createElement("style");
style.textContent = `
  body { background-color: #0d0d0d; color: #33ff33; font-family: 'Courier New', Courier, monospace; margin: 0; padding: 20px; }
  h1 { text-align: center; color: #00ff00; }
  .timestamp { text-align: center; margin-bottom: 10px; color: #999; }
  .progress { text-align: center; margin: 10px 0; font-size: 14px; }
  .loader { border: 6px solid #222; border-top: 6px solid #33ff33; border-radius: 50%; width: 40px; height: 40px; animation: spin 1s linear infinite; margin: 10px auto; }
  @keyframes spin { 100% { transform: rotate(360deg); } }
  table { width: 100%; border-collapse: collapse; margin-top: 20px; }
  th, td { border-bottom: 1px solid #222; padding: 6px; }
  th { color: #66ff66; }
  td a { color: #00ccff; text-decoration: none; }
  .faded { opacity: 0.5; }
  .actions { display:flex; justify-content:center; gap:10px; margin-top:20px; }
  .actions button { background:#111; color:#33ff33; border:1px solid #33ff33; padding:8px 16px; cursor:pointer; border-radius:6px; font-size:14px; }
  .actions button:hover { background:#33ff33; color:#000; box-shadow:0 0 8px #33ff33; }
`;
doc.head.appendChild(style);

/******************************
 * 4. PAGE STRUCTURE
 ******************************/

// Header
const h1 = doc.createElement("h1");
h1.textContent = `Results for ${domain}`;
doc.body.appendChild(h1);

// Timestamp
const timestampDiv = doc.createElement("div");
timestampDiv.className = "timestamp";
timestampDiv.textContent = `Started on ${new Date().toLocaleString()}`;
doc.body.appendChild(timestampDiv);

// Progress indicator
const progressDiv = doc.createElement("div");
progressDiv.className = "progress";
progressDiv.id = "progress";
progressDiv.textContent = "Scanning 0 / ? pages...";
doc.body.appendChild(progressDiv);

// Loader spinner
const loaderDiv = doc.createElement("div");
loaderDiv.className = "loader";
loaderDiv.id = "loader";
doc.body.appendChild(loaderDiv);

// Helper function: create table for results
function createTable(title, id) {
  const h2 = doc.createElement("h2");
  h2.textContent = title;
  doc.body.appendChild(h2);

  const table = doc.createElement("table");
  const thead = doc.createElement("thead");
  thead.innerHTML = `<tr><th>${title.includes("Email") ? "Email" : "Phone"}</th><th>Source URL</th></tr>`;
  table.appendChild(thead);

  const tbody = doc.createElement("tbody");
  tbody.id = id;
  const row = doc.createElement("tr");
  row.innerHTML = `<td colspan="2" class="faded">Waiting for results...</td>`;
  tbody.appendChild(row);
  table.appendChild(tbody);

  doc.body.appendChild(table);
}

// Create tables for emails and phones
createTable("📧 Emails", "emailBody");
createTable("📞 Phone Numbers", "phoneBody");

/******************************
 * 5. EXPORT FUNCTIONS
 ******************************/

const script = doc.createElement("script");
script.textContent = `
  // Define domain inside the new window
  const domain = "${domain}";

  // Export to HTML/PDF
  window.exportPDF = function() {
    const emailTable = document.getElementById("emailBody");
    const phoneTable = document.getElementById("phoneBody");
    const htmlContent = "<!DOCTYPE html><html><head><meta charset='UTF-8'><title>Results for "+domain+"</title><style>body{font-family:Arial,sans-serif;padding:20px;}h1,h2{color:#333;}table{border-collapse:collapse;width:100%;margin-bottom:20px;}th,td{border:1px solid #ccc;padding:6px;text-align:left;}th{background:#f0f0f0;}</style></head><body><h1>Results for "+domain+"</h1><h2>📧 Emails</h2>"+(emailTable?emailTable.outerHTML:"<tr><td>No results</td></tr>")+"<h2>📞 Phones</h2>"+(phoneTable?phoneTable.outerHTML:"<tr><td>No results</td></tr>")+"</body></html>";
    const blob = new Blob([htmlContent], {type:"text/html"});
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = \`results-\${domain}.html\`;
    a.click();
  };

  // Export to CSV
  window.exportCSV = function() {
    let rows = [["Type","Value","Source URL"]];
    [...document.querySelectorAll("#emailBody tr")].forEach(tr=>{
      if(tr.cells.length>=2) rows.push(["Email",tr.cells[0].innerText,tr.cells[1].innerText]);
    });
    [...document.querySelectorAll("#phoneBody tr")].forEach(tr=>{
      if(tr.cells.length>=2) rows.push(["Phone",tr.cells[0].innerText,tr.cells[1].innerText]);
    });
    let csv = rows.map(r=>r.map(v=>'\"'+v.replace(/"/g,'""')+'\"').join(",")).join("\\n");
    let blob = new Blob([csv],{type:"text/csv"});
    let a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = \`results-\${domain}.csv\`;
    a.click();
  };

  // Export to JSON
  window.exportJSON = function() {
    let data = {emails:[],phones:[]};
    [...document.querySelectorAll("#emailBody tr")].forEach(tr=>{
      if(tr.cells.length>=2) data.emails.push({email:tr.cells[0].innerText,url:tr.cells[1].innerText});
    });
    [...document.querySelectorAll("#phoneBody tr")].forEach(tr=>{
      if(tr.cells.length>=2) data.phones.push({phone:tr.cells[0].innerText,url:tr.cells[1].innerText});
    });
    let blob = new Blob([JSON.stringify(data,null,2)],{type:"application/json"});
    let a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = \`results-\${domain}.json\`;
    a.click();
  };
`;
doc.body.appendChild(script);

/**
 * storeAndUpdate(matches, url, map, type)
 *
 * Stores extracted emails or phone numbers and updates the results table in the UI.
 *
 * Parameters:
 *  - matches: Array of matched strings (emails or phone numbers) from a page.
 *  - url: The URL where the matches were found.
 *  - map: Map object to track unique matches and avoid duplicates.
 *  - type: "email" or "phone" – determines which results table to update.
 *
 * How it works:
 * 1. Selects the appropriate table body in the DOM based on the type.
 * 2. Checks if there are any matches:
 *    - If none, displays "No results" in a placeholder row.
 * 3. Iterates over matches:
 *    - Trims whitespace.
 *    - For phones, filters out invalid numbers (less than 8 or more than 15 digits).
 * 4. Creates a unique key combining the value and URL to prevent duplicates.
 * 5. Adds new matches to the Map.
 * 6. Updates the results table dynamically:
 *    - Removes placeholder row if it exists.
 *    - Appends a new row with the value and clickable URL.
 */
function storeAndUpdate(matches, url, map, type) {
  const tbody = doc.getElementById(type + "Body");
  const waitingRow = tbody.querySelector(".faded");

  if (!matches || matches.length === 0) {
    if (waitingRow) {
      waitingRow.style.opacity = "1";
      waitingRow.textContent = "No results";
    }
    return;
  }

  for (let raw of matches) {
    const value = raw.trim();

    if (type === "phone") {
      const digits = value.replace(/\D/g, "");
      if (digits.length < 8 || digits.length > 15) continue; // filter junk numbers
    }

    const key = value + "|" + url;
    if (!map.has(key)) {
      map.set(key, { value, url });
      if (waitingRow) waitingRow.remove();

      const row = doc.createElement("tr");
      row.innerHTML = `<td>${value}</td><td><a href="${url}" target="_blank">${url}</a></td>`;
      tbody.appendChild(row);
    }
  }
}

/**
 * fetchAndScan(url, total, progressEl)
 *
 * Fetches a page at the given URL, extracts emails and phone numbers,
 * and updates the progress indicator.
 *
 * Parameters:
 *  - url: The page URL to fetch and scan.
 *  - total: Total number of pages being scanned (used for progress display).
 *  - progressEl: DOM element where scanning progress is shown.
 *
 * How it works:
 * 1. Skips URLs already scanned (tracked in the `seen` Set).
 * 2. Fetches the page content using `fetch`.
 * 3. Normalizes non-breaking spaces to regular spaces.
 * 4. Extracts emails and phone numbers using predefined regex patterns.
 * 5. Stores results via `storeAndUpdate` function for each type.
 * 6. Updates progress text in the provided DOM element.
 * 7. Catches and logs any fetch errors to avoid breaking the scan.
 *
 * This function is asynchronous and can be called concurrently for multiple URLs.
 */
async function fetchAndScan(url, total, progressEl) {
  if (seen.has(url)) return;
  seen.add(url);

  try {
    const response = await fetch(url);
    const html = await response.text();
    const text = html.replace(/\u00A0/g, " "); // normalize spaces

    storeAndUpdate(text.match(patterns.email), url, emails, "email");
    storeAndUpdate(text.match(patterns.phone), url, phones, "phone");
  } catch (error) {
    console.warn("Failed to fetch:", url, error);
  } finally {
    progressEl.textContent = `Scanning ${seen.size} / ${total} pages...`;
  }
}

/**
 * Crawl function explores links recursively from a starting page.
 *
 * The `depth` parameter represents how many "clicks away" the current page is
 * from the starting URL:
 *   - depth = 0 → the starting page (e.g., homepage).
 *   - depth = 1 → links found directly on the starting page.
 *   - depth = 2 → links found on those pages, and so on.
 *
 * Crawling stops when `depth` exceeds `maxDepth`.
 * This prevents infinite recursion and controls how far the crawler explores
 * into the site’s link structure.
 */
function getLinks() {
  var domain = location.hostname;
  var visited = new Set();
  var foundLinks = new Set();
  var maxDepth = userDepth;

  async function crawl(url, depth) {
    if (depth > maxDepth || visited.has(url)) return;
    visited.add(url);

    try {
      var res = await fetch(url);
      var html = await res.text();
      var docParsed = new DOMParser().parseFromString(html, "text/html");
      var links = docParsed.querySelectorAll("a");
      var childPromises = [];

      for (var i = 0; i < links.length; i++) {
        try {
          var nextUrl = new URL(links[i].href, url);
          nextUrl.hash = "";
          nextUrl = nextUrl.href.replace(/\/+$/, "").toLowerCase();

          if (nextUrl.indexOf(domain) !== -1 && !visited.has(nextUrl)) {
            foundLinks.add(nextUrl);
            childPromises.push(crawl(nextUrl, depth + 1));
          }
        } catch (e) { }
      }

      await Promise.all(childPromises);
    } catch (e) {
      console.warn("Failed to fetch:", url, e);
    }
  }

  return crawl(location.href, 0).then(() => Array.from(foundLinks));
}

/**
 * run(urls)
 *
 * Main function to orchestrate scanning of multiple URLs concurrently.
 *
 * Parameters:
 *  - urls: Array of URLs to be fetched and scanned.
 *
 * How it works:
 * 1. Determines the total number of pages and selects the progress element in the UI.
 * 2. Copies the list of URLs into a queue for processing.
 * 3. Defines an asynchronous worker function:
 *    - Continuously takes URLs from the queue.
 *    - Calls `fetchAndScan` for each URL, updating progress in real-time.
 * 4. Spawns multiple workers (up to MAX_CONCURRENT) to process URLs concurrently.
 * 5. Waits for all workers to complete using `Promise.all`.
 * 6. Updates the progress element to indicate scanning is finished.
 * 7. Hides the loader element once scanning is complete.
 * 8. Creates and inserts action buttons for exporting results in PDF, CSV, or JSON format.
 *
 * Notes:
 * - Concurrency control ensures the browser doesn’t get overloaded by too many simultaneous fetch requests.
 * - Progress updates are shown dynamically as pages are scanned.
 */
async function run(urls) {
  const total = urls.length;
  const progressEl = doc.getElementById("progress");
  const queue = [...urls];

  async function worker() {
    while (queue.length > 0) {
      const url = queue.shift();
      if (!url) break;
      await fetchAndScan(url, total, progressEl);
    }
  }

  const workers = [];
  for (let i = 0; i < MAX_CONCURRENT; i++) workers.push(worker());
  await Promise.all(workers);

  progressEl.textContent = `✅ Finished scanning ${total} pages.`;

  const loader = doc.getElementById("loader");
  if (loader) loader.style.display = "none";

  const actions = doc.createElement("div");
  actions.className = "actions";
  actions.innerHTML = `
    <button onclick="window.exportPDF()">⬇️ PDF</button>
    <button onclick="window.exportCSV()">⬇️ CSV</button>
    <button onclick="window.exportJSON()">⬇️ JSON</button>
  `;
  loader.insertAdjacentElement("afterend", actions);
}

/**
 * startScraping()
 *
 * Entry point for the scraping workflow.
 * 1. Retrieves all internal links from the current site.
 * 2. Initializes the progress display in the UI.
 * 3. Runs the concurrent scanning process on all discovered links.
 * 4. Logs a message when scanning is complete.
 */
async function startScraping() {
  const links = await getLinks(); // get all links from the current site
  const progressEl = doc.getElementById("progress");
  progressEl.textContent = `Scanning 0 / ${links.length} pages...`;
  await run(links); // scan all links concurrently
  console.log("✅ Done scanning.");
}

// Start scanning
startScraping();
