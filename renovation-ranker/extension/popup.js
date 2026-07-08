const BASE = "http://localhost:8787";

const typeEl = document.getElementById("type");
const minEl = document.getElementById("min");
const statusEl = document.getElementById("status");
const tbl = document.getElementById("tbl");
const tbody = tbl.querySelector("tbody");
document.getElementById("dash").href = BASE;

async function load() {
  statusEl.textContent = "Loading…";
  statusEl.classList.remove("err");
  tbl.hidden = true;
  try {
    const res = await fetch(
      `${BASE}/api/results?type=${typeEl.value}&min=${Number(minEl.value) || 0}`,
    );
    if (!res.ok) throw new Error(`server responded ${res.status}`);
    const data = await res.json();
    tbody.replaceChildren();
    for (const r of data.rows.slice(0, 25)) {
      const tr = document.createElement("tr");
      const cells = [
        [String(r.rank), "num"],
        [r.address, ""],
        [r.score.toFixed(1), "num"],
        [r.confidence.toFixed(2), "num"],
      ];
      for (const [text, cls] of cells) {
        const td = document.createElement("td");
        td.textContent = text;
        if (cls) td.className = cls;
        tr.appendChild(td);
      }
      tr.title = r.topFindings || "";
      tbody.appendChild(tr);
    }
    if (data.rows.length === 0) {
      statusEl.textContent = "No scored addresses yet — run a scan first.";
    } else {
      statusEl.textContent = `${data.rows.length} leads (${data.contractorType})`;
      tbl.hidden = false;
    }
  } catch (e) {
    statusEl.textContent =
      `Can't reach the Renovation Ranker server at ${BASE} — start it with: bun run serve (${e.message})`;
    statusEl.classList.add("err");
  }
}

typeEl.addEventListener("change", () => {
  chrome.storage.local.set({ type: typeEl.value });
  load();
});
minEl.addEventListener("change", load);

chrome.storage.local.get("type").then(({ type }) => {
  if (type) typeEl.value = type;
  load();
});
