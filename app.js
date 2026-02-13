// ============================================
// CONFIGURATION - EDIT THIS LINE:
// ============================================
const CSV_URL = "https://docs.google.com/spreadsheets/d/e/2PACX-1vRNfjgC4FQwiXqitxylLUVD7GiCdEHkFqlC0I0gFiD6_msxEI8vbKjh2LBygOUkzw/pub?gid=110465285&single=true&output=csv";

// Match these to your sheet values
const CRITICAL_LABELS = ["Critical", "CRITICAL", "Crit"];
const QUALITY_FLAG_LABELS = ["FLAG", "Flag", "Quality Flag", "QualityFlag", "QF"];

let allRows = [];
let enumerators = [];
let selectedEnumeratorKey = null;

// Keep last rendered rows for download
let currentRenderedRows = [];

const elSearch = document.getElementById("searchInput");
const elResults = document.getElementById("results");
const elEnumCard = document.getElementById("enumCard");
const elErrorsSection = document.getElementById("errorsSection");
const elErrorsTbody = document.querySelector("#errorsTable tbody");
const elSurveyFilter = document.getElementById("surveyFilter");
const elSeverityFilter = document.getElementById("severityFilter");
const elStatsBar = document.getElementById("statsBar");
const elTopErrors = document.getElementById("topErrors");
const elCountLine = document.getElementById("countLine");
const elEmpty = document.getElementById("emptyState");
const elStatus = document.getElementById("statusPill");
const elDownloadBtn = document.getElementById("downloadBtn");

// toast (optional, if you added it in HTML)
const elToast = document.getElementById("copyToast");

init();

async function init(){
  try{
    setStatus("Loading data", "neutral");

    if (!CSV_URL || CSV_URL.trim() === ""){
      setStatus("CSV_URL not configured", "warn");
      elResults.innerHTML = `<div class="resultItem" style="padding: 20px;">
        Please set your Google Sheets CSV URL in app.js (line 4)
      </div>`;
      return;
    }

    const normalizedUrl = normalizeGoogleSheetUrl(CSV_URL);
    const csvText = await fetchText(normalizedUrl);

    if (looksLikeHtml(csvText)){
      throw new Error(
        "Google returned HTML instead of CSV. Please re-check Publish to web OR use a normal sheet link. " +
        "Tip: open the link in a browser, it must download/show CSV, not a Google page."
      );
    }

    const raw = parseCSV(csvText);

    allRows = raw.map(r => ({
      recordKey: (r["Record Key"] || "").trim(),
      submissionDate: (r["Submission Date"] || "").trim(),
      survey: (r["Survey"] || "").trim(),
      severity: (r["Severity"] || "").trim(),
      ruleId: (r["Rule ID"] || "").trim(),
      title: (r["Title"] || "").trim(),
      message: (r["Message"] || "").trim(),
      value: (r["Value"] || "").trim(),
      enumeratorName: (r["Enumerator Name"] || "").trim(),
      enumeratorId: String(r["Enumerator ID"] || "").trim(),
      district: (r["District"] || "").trim()
    }));

    buildEnumeratorsIndex();
    wireEvents();
    setStatus("Ready", "good");
  } catch(err){
    setStatus("Data load failed", "warn");
    elResults.innerHTML = `<div class="resultItem" style="padding: 20px;">
      <strong>Error loading data:</strong><br>
      ${escapeHtml(err.message)}<br><br>
      Please verify:<br>
      1. Your Google Sheet is <b>published to web</b> (File → Share → Publish to web)<br>
      2. The CSV URL opens as <b>CSV text</b> (not a Google HTML page)<br>
      3. The sheet has these columns:<br>
      <code>Record Key, Submission Date, Survey, Severity, Rule ID, Title, Message, Value, Enumerator Name, Enumerator ID, District</code>
    </div>`;
    console.error("Full error:", err);
  }
}

function setStatus(text, kind){
  elStatus.textContent = text;
  elStatus.className = `pill ${kind}`;
}

function wireEvents(){
  elSearch.addEventListener("input", () => {
    const q = elSearch.value.trim().toLowerCase();
    if (!q){
      clearResults();
      return;
    }

    const matches = enumerators
      .filter(e =>
        (e.enumeratorId || "").toLowerCase().includes(q) ||
        (e.enumeratorName || "").toLowerCase().includes(q)
      )
      .slice(0, 12);

    renderResults(matches);
  });

  document.addEventListener("click", (e) => {
    if (!elResults.contains(e.target) && e.target !== elSearch) clearResults();
  });

  elSurveyFilter.addEventListener("change", renderErrorsForSelected);
  elSeverityFilter.addEventListener("change", renderErrorsForSelected);

  elDownloadBtn.addEventListener("click", () => {
    if (!currentRenderedRows.length) return;
    downloadCurrentCSV();
  });

  // ✅ IMPORTANT: DO NOT block touchstart (it breaks scrolling)
  // Block only mouse selection + right-click menus on copyable cells.

  elErrorsTbody.addEventListener("mousedown", (e) => {
    const cell = e.target.closest(".copyable");
    if (!cell) return;
    e.preventDefault(); // stops text selecting when dragging with mouse
  });

  elErrorsTbody.addEventListener("dragstart", (e) => {
    const cell = e.target.closest(".copyable");
    if (!cell) return;
    e.preventDefault();
  });

  elErrorsTbody.addEventListener("contextmenu", (e) => {
    const cell = e.target.closest(".copyable");
    if (!cell) return;
    e.preventDefault(); // reduces "Search Google" / context menu
  });

  // ✅ Click-to-copy for table cells
  elErrorsTbody.addEventListener("click", (e) => {
    const cell = e.target.closest(".copyable");
    if (!cell) return;

    const val = cell.getAttribute("data-copy") || "";
    if (!val) return;

    copyToClipboard(val);
  });
}

function buildEnumeratorsIndex(){
  const map = new Map();

  for (const r of allRows){
    const key = r.enumeratorId || r.enumeratorName;
    if (!key) continue;

    if (!map.has(key)){
      map.set(key, {
        key,
        enumeratorId: r.enumeratorId,
        enumeratorName: r.enumeratorName,
        district: r.district
      });
    }
  }

  enumerators = Array.from(map.values())
    .sort((a, b) => (a.enumeratorName || "").localeCompare(b.enumeratorName || ""));
}

function renderResults(items){
  if (items.length === 0){
    elResults.innerHTML = `<div class="resultItem">No match found</div>`;
    return;
  }

  elResults.innerHTML = items.map(i => `
    <div class="resultItem" data-key="${escapeHtml(i.key)}">
      <div class="resultTitle">${escapeHtml(i.enumeratorName || "(No Name)")}</div>
      <div class="resultMeta">ID: ${escapeHtml(i.enumeratorId || "-")} , District: ${escapeHtml(i.district || "-")}</div>
    </div>
  `).join("");

  Array.from(elResults.querySelectorAll(".resultItem")).forEach(div => {
    div.addEventListener("click", () => {
      const key = div.getAttribute("data-key");
      selectEnumerator(key);
      clearResults();
    });
  });
}

function selectEnumerator(key){
  selectedEnumeratorKey = key;
  const e = enumerators.find(x => x.key === key);
  if (!e) return;

  elEnumCard.classList.remove("hidden");
  elEnumCard.innerHTML = `
    <h2 style="margin:0;font-size:18px;">Enumerator Details</h2>
    <div class="kv">
      <div class="k">Enumerator ID</div>
      <div class="v copyable" data-copy="${attrEscape(e.enumeratorId || "")}">${escapeHtml(e.enumeratorId || "-")}</div>

      <div class="k">Name</div>
      <div class="v copyable" data-copy="${attrEscape(e.enumeratorName || "")}">${escapeHtml(e.enumeratorName || "-")}</div>

      <div class="k">District</div>
      <div class="v copyable" data-copy="${attrEscape(e.district || "")}">${escapeHtml(e.district || "-")}</div>
    </div>
  `;

  // ✅ Copy in enum card without breaking scroll
  elEnumCard.querySelectorAll(".copyable").forEach(node => {
    node.addEventListener("mousedown", (ev) => ev.preventDefault());
    node.addEventListener("dragstart", (ev) => ev.preventDefault());
    node.addEventListener("contextmenu", (ev) => ev.preventDefault());
    node.addEventListener("click", () => {
      const v = node.getAttribute("data-copy") || "";
      if (v) copyToClipboard(v);
    });
  });

  const rows = allRowsForSelected();

  const surveys = Array.from(new Set(rows.map(r => r.survey).filter(Boolean))).sort();
  elSurveyFilter.innerHTML =
    `<option value="">All</option>` +
    surveys.map(s => `<option value="${escapeHtml(s)}">${escapeHtml(s)}</option>`).join("");

  const sevs = Array.from(new Set(rows.map(r => r.severity).filter(Boolean))).sort();
  elSeverityFilter.innerHTML =
    `<option value="">All</option>` +
    sevs.map(s => `<option value="${escapeHtml(s)}">${escapeHtml(s)}</option>`).join("");

  elErrorsSection.classList.remove("hidden");
  renderErrorsForSelected();
}

function allRowsForSelected(){
  const e = enumerators.find(x => x.key === selectedEnumeratorKey);
  if (!e) return [];

  return allRows.filter(r =>
    (e.enumeratorId && r.enumeratorId === e.enumeratorId) ||
    (!e.enumeratorId && r.enumeratorName === e.enumeratorName)
  );
}

function renderErrorsForSelected(){
  if (!selectedEnumeratorKey) return;

  const survey = elSurveyFilter.value;
  const sev = elSeverityFilter.value;

  let rows = allRowsForSelected();
  if (survey) rows = rows.filter(r => r.survey === survey);
  if (sev) rows = rows.filter(r => r.severity === sev);

  rows.sort((a, b) => (b.submissionDate || "").localeCompare(a.submissionDate || ""));

  currentRenderedRows = rows;
  elDownloadBtn.disabled = rows.length === 0;

  const totalErrors = rows.length;
  const totalCritical = rows.filter(r => CRITICAL_LABELS.includes(r.severity)).length;
  const totalQualityFlags = rows.filter(r => QUALITY_FLAG_LABELS.includes(r.severity)).length;

  elStatsBar.innerHTML = `
    ${statCard("Total errors", totalErrors)}
    ${statCard("Critical", totalCritical)}
    ${statCard("Quality flags", totalQualityFlags)}
    ${statCard("Surveys", new Set(rows.map(r => r.survey).filter(Boolean)).size)}
  `;

  elCountLine.textContent = `${totalErrors} record(s) shown`;
  renderTop3(rows);

  elErrorsTbody.innerHTML = rows.map(r => `
    <tr>
      <td data-label="Record Key" class="copyable" data-copy="${attrEscape(r.recordKey)}">${escapeHtml(r.recordKey)}</td>
      <td data-label="Submission Date" class="copyable" data-copy="${attrEscape(r.submissionDate)}">${escapeHtml(r.submissionDate)}</td>
      <td data-label="Survey" class="copyable" data-copy="${attrEscape(r.survey)}">${escapeHtml(r.survey)}</td>
      <td data-label="Severity" class="copyable" data-copy="${attrEscape(r.severity)}">${severityTag(r.severity)}</td>
      <td data-label="Error ID" class="copyable" data-copy="${attrEscape(r.ruleId)}">${escapeHtml(r.ruleId)}</td>
      <td data-label="Title" class="copyable" data-copy="${attrEscape(r.title)}">${escapeHtml(r.title)}</td>
      <td data-label="Message" class="copyable" data-copy="${attrEscape(r.message)}">${escapeHtml(r.message)}</td>
      <td data-label="Value" class="copyable" data-copy="${attrEscape(r.value)}">${escapeHtml(r.value)}</td>
    </tr>
  `).join("");

  if (rows.length === 0){
    elEmpty.classList.remove("hidden");
  } else {
    elEmpty.classList.add("hidden");
  }
}

function renderTop3(rows){
  if (!rows.length){
    elTopErrors.innerHTML = `<div class="empty">No data to calculate top errors.</div>`;
    return;
  }

  const map = new Map();
  for (const r of rows){
    const key = `${r.ruleId}|||${r.title}`;
    map.set(key, (map.get(key) || 0) + 1);
  }

  const items = Array.from(map.entries())
    .map(([key, count]) => {
      const [ruleId, title] = key.split("|||");
      return { ruleId, title, count };
    })
    .sort((a,b) => b.count - a.count)
    .slice(0, 3);

  elTopErrors.innerHTML = items.map((it, idx) => `
    <div class="topItem">
      <div class="topLeft">
        <div class="topTitle">${idx + 1}. ${escapeHtml(it.title || "Untitled")}</div>
        <div class="topMeta">Error ID: ${escapeHtml(it.ruleId || "-")}</div>
      </div>
      <div class="topCount">${it.count} time(s)</div>
    </div>
  `).join("");
}

function downloadCurrentCSV(){
  const e = enumerators.find(x => x.key === selectedEnumeratorKey);
  const survey = elSurveyFilter.value || "All";
  const sev = elSeverityFilter.value || "All";

  const headers = [
    "Enumerator ID","Enumerator Name","District",
    "Record Key","Submission Date","Survey","Severity","Rule ID","Title","Message","Value"
  ];

  const lines = [headers.join(",")];

  for (const r of currentRenderedRows){
    const row = [
      e?.enumeratorId || "",
      e?.enumeratorName || "",
      e?.district || "",
      r.recordKey,
      r.submissionDate,
      r.survey,
      r.severity,
      r.ruleId,
      r.title,
      r.message,
      r.value
    ].map(csvEscape);

    lines.push(row.join(","));
  }

  const csv = lines.join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);

  const safeName = (e?.enumeratorName || "Enumerator").replace(/[^a-z0-9]+/gi, "_");
  const fileName = `ErrorLog_${safeName}_${e?.enumeratorId || ""}_Survey-${survey}_Severity-${sev}.csv`.replace(/__+/g, "_");

  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();

  URL.revokeObjectURL(url);
}

function copyToClipboard(text){
  const t = String(text ?? "");
  if (!t) return;

  if (navigator.clipboard && window.isSecureContext){
    navigator.clipboard.writeText(t)
      .then(() => showToast("Copied"))
      .catch(() => fallbackCopy(t));
    return;
  }

  fallbackCopy(t);
}

function fallbackCopy(text){
  const ta = document.createElement("textarea");
  ta.value = text;
  ta.style.position = "fixed";
  ta.style.left = "-9999px";
  document.body.appendChild(ta);
  ta.select();
  try{
    document.execCommand("copy");
    showToast("Copied");
  } catch {
    showToast("Copy failed");
  }
  ta.remove();
}

let toastTimer = null;
function showToast(msg){
  if (!elToast) return;
  elToast.textContent = msg;
  elToast.classList.add("show");
  if (toastTimer) clearTimeout(toastTimer);
  toastTimer = setTimeout(() => elToast.classList.remove("show"), 300);
}

function csvEscape(v){
  const s = String(v ?? "");
  if (/[",\n]/.test(s)){
    return `"${s.replaceAll('"', '""')}"`;
  }
  return s;
}

function statCard(label, value){
  return `
    <div class="statCard">
      <div class="statLabel">${escapeHtml(label)}</div>
      <div class="statValue">${escapeHtml(value)}</div>
    </div>
  `;
}

function severityTag(sev){
  const s = (sev || "").trim();
  const isCrit = CRITICAL_LABELS.includes(s);
  const isFlag = QUALITY_FLAG_LABELS.includes(s);

  let dotClass = "other";
  if (isCrit) dotClass = "critical";
  else if (isFlag) dotClass = "flag";

  return `
    <span class="sevTag">
      <span class="dot ${dotClass}"></span>
      ${escapeHtml(s || "-")}
    </span>
  `;
}

function clearResults(){
  elResults.innerHTML = "";
}

// ============================================
// DATA LOADING HELPERS
// ============================================
async function fetchText(url){
  const res = await fetch(url, { cache: "no-store" });
  const txt = await res.text();
  if (!res.ok) throw new Error(`Fetch failed: ${res.status}\n${txt.slice(0, 200)}`);
  return txt;
}

function looksLikeHtml(text){
  const t = (text || "").trim().toLowerCase();
  return t.startsWith("<!doctype html") || t.startsWith("<html") || t.includes("<head") || t.includes("googleusercontent");
}

function normalizeGoogleSheetUrl(url){
  const u = String(url || "").trim();
  if (!u) return u;

  if (u.includes("output=csv") || u.includes("tqx=out:csv")) return u;

  const m1 = u.match(/https:\/\/docs\.google\.com\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
  if (m1){
    const sheetId = m1[1];
    const gidMatch = u.match(/gid=([0-9]+)/);
    const gid = gidMatch ? gidMatch[1] : "0";
    return `https://docs.google.com/spreadsheets/d/${sheetId}/gviz/tq?tqx=out:csv&gid=${gid}`;
  }

  const m2 = u.match(/https:\/\/docs\.google\.com\/spreadsheets\/d\/e\/([a-zA-Z0-9-_]+)/);
  if (m2){
    const pubId = m2[1];
    const gidMatch = u.match(/gid=([0-9]+)/);
    const gid = gidMatch ? gidMatch[1] : "0";
    return `https://docs.google.com/spreadsheets/d/e/${pubId}/pub?gid=${gid}&single=true&output=csv`;
  }

  return u;
}

// ============================================
// CSV PARSER
// ============================================
function parseCSV(text){
  const rows = [];
  const lines = text.replace(/\r/g, "").split("\n").filter(Boolean);
  if (lines.length === 0) return rows;

  const headers = splitCSVLine(lines[0]).map(h => h.trim());
  for (let i = 1; i < lines.length; i++){
    const cols = splitCSVLine(lines[i]);
    const obj = {};
    headers.forEach((h, idx) => obj[h] = (cols[idx] ?? "").trim());
    rows.push(obj);
  }
  return rows;
}

function splitCSVLine(line){
  const out = [];
  let cur = "";
  let inQuotes = false;

  for (let i = 0; i < line.length; i++){
    const ch = line[i];

    if (ch === '"'){
      if (inQuotes && line[i + 1] === '"'){
        cur += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }

    if (ch === "," && !inQuotes){
      out.push(cur);
      cur = "";
      continue;
    }

    cur += ch;
  }

  out.push(cur);
  return out;
}

// ============================================
// ESCAPING HELPERS
// ============================================
function escapeHtml(s){
  return String(s ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function attrEscape(s){
  return String(s ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;")
    .replaceAll("\n", " ");
}

