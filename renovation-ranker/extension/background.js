// Right-click any highlighted address text -> scan it via the local server.
const BASE = "http://localhost:8787";

chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({
    id: "rr-scan",
    title: 'Scan "%s" with Renovation Ranker',
    contexts: ["selection"],
  });
});

function notify(title, message) {
  chrome.notifications.create({
    type: "basic",
    iconUrl: "icon.png",
    title,
    message,
  });
}

chrome.contextMenus.onClicked.addListener(async (info) => {
  if (info.menuItemId !== "rr-scan" || !info.selectionText) return;
  const address = info.selectionText.trim().slice(0, 200);
  notify("Renovation Ranker", `Scanning: ${address}…`);
  try {
    const res = await fetch(`${BASE}/api/scan`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ address }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || `server ${res.status}`);
    if (data.kind === "scored" || data.kind === "already_scored") {
      const s = data.scan.scores;
      notify(
        "Renovation Ranker — scored",
        `${data.scan.address}\nGeneral: ${s.byContractor.general} | Roof: ${s.categories.roof} | Conf: ${s.confidence}`,
      );
    } else if (data.kind === "no_reliable_imagery") {
      notify("Renovation Ranker", `No reliable imagery for ${address}`);
    } else {
      notify("Renovation Ranker — error", data.scan?.error ?? "scan failed");
    }
  } catch (e) {
    notify(
      "Renovation Ranker — can't reach server",
      `Start it with: bun run serve\n(${e.message})`,
    );
  }
});
