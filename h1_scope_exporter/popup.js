document.getElementById("exportBtn").addEventListener("click", async () => {
  const status = document.getElementById("message");
  const spinner = document.getElementById("spinner");

  status.textContent = "Scraping...";
  spinner.classList.remove("hidden");

  try {
    let [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

    // Execute the scraping function inside the page context
    const results = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: scrapeScopeTable
    });

    // results is an array of one result for the frame; get returned object
    const data = results?.[0]?.result ?? {};
    const keys = Object.keys(data);

    if (keys.length === 0) {
      status.textContent = "No assets found (make sure the scope table is visible).";
      spinner.classList.add("hidden");
      return;
    }

    // For each group, create and download a single txt file
    let filesCreated = 0;
    for (const groupName of keys) {
      const list = Array.from(new Set(data[groupName].map(s => s.trim()).filter(Boolean))); // unique & non-empty
      if (list.length === 0) continue;
      const blob = new Blob([list.join("\n")], { type: "text/plain" });
      const url = URL.createObjectURL(blob);
      const filename = sanitizeFilename(groupName) + ".txt";

      // Use anchor click to download
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      a.style.display = "none";
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);

      filesCreated++;
    }

    spinner.classList.add("hidden");
    status.textContent = filesCreated > 0 ? `Downloaded ${filesCreated} file(s)` : "No matching assets to export.";
  } catch (err) {
    spinner.classList.add("hidden");
    status.textContent = "Error: " + (err.message || err);
    console.error(err);
  }
});

function sanitizeFilename(name) {
  return name.replace(/[^a-z0-9\-_.]/gi, "_").toLowerCase();
}

/**
 * This function runs inside the webpage (as a content script execution).
 * It scrapes the scope table and returns an object keyed by the allowed types.
 *
 * Allowed groups (exact output keys):
 *  - domain
 *  - ios_app
 *  - android
 *  - github
 *
 * The function is defensive: it looks for table rows, but will also scan the page text
 * if the table structure is slightly different.
 */
function scrapeScopeTable() {
  const allowed = {
    domain: ["domain"],
    ios_app: ["ios", "app store", "iOS: App Store"],
    android: ["android", "play store", "playstore"],
    github: ["github"]
  };

  const grouped = { domain: [], ios_app: [], android: [], github: [] };

  // Helper to map a type string to allowed key (or null if not allowed)
  function mapType(typeStr) {
    if (!typeStr) return null;
    const t = typeStr.toLowerCase();
    for (const [key, patterns] of Object.entries(allowed)) {
      for (const p of patterns) {
        if (t.includes(p)) return key;
      }
    }
    return null;
  }

  // Attempt 1: structured table rows (tds)
  const rows = Array.from(document.querySelectorAll("table tr"))
    .map(tr => Array.from(tr.querySelectorAll("td")).map(td => td.innerText.trim()))
    .filter(cols => cols.length >= 2);

  if (rows.length > 0) {
    for (const cols of rows) {
      const asset = cols[0].trim();
      const type = cols[1].trim();
      const key = mapType(type);
      if (key) grouped[key].push(asset);
    }
    return grouped;
  }

  // Attempt 2: fallback - look for lines containing known patterns (from pasted text)
  const text = document.body.innerText || "";
  const lines = text.split(/\r?\n/).map(l => l.trim()).filter(Boolean);

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    // Many scope lists put asset then type on same or adjacent lines.
    // Check current line for an asset-looking token (contains '.' or 'http' or 'github.com')
    if (/\.\w{2,}|https?:\/\//.test(line) || /github\.com/i.test(line)) {
      // Look ahead for a type token in the same line or next 2 lines
      const look = (lines[i] + " " + (lines[i+1] || "") + " " + (lines[i+2] || "")).toLowerCase();
      let key = null;
      for (const [k, patterns] of Object.entries(allowed)) {
        for (const p of patterns) {
          if (look.includes(p)) { key = k; break; }
        }
        if (key) break;
      }
      if (key) grouped[key].push(line);
    }
  }

  return grouped;
}
