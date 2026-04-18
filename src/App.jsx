import { useState, useCallback } from "react";

const BLOCK_TIME_S = 6;
const WINDOW_MINUTES = 3;
const WINDOW_LEVELS = Math.round((WINDOW_MINUTES * 60) / BLOCK_TIME_S); // 18

async function fetchAllRights(baker, startLevel, endLevel, onProgress) {
  const PAGE = 10000;
  let rights = [];
  let offset = 0;
  while (true) {
    const url = `https://api.tzkt.io/v1/rights?baker=${baker}&level.ge=${startLevel}&level.le=${endLevel}&limit=${PAGE}&offset=${offset}`;
    const resp = await fetch(url);
    if (!resp.ok) throw new Error(`TzKT API error ${resp.status}: ${resp.statusText}`);
    const page = await resp.json();
    rights = rights.concat(page);
    onProgress(rights.length);
    if (page.length < PAGE) break;
    offset += PAGE;
  }
  return rights;
}

async function getLevelRange(dateStart, dateEnd) {
  const [firstRes, lastRes] = await Promise.all([
    fetch(`https://api.tzkt.io/v1/blocks?timestamp.ge=${dateStart}&timestamp.le=${dateEnd}&limit=1&sort=level&select=level,timestamp`),
    fetch(`https://api.tzkt.io/v1/blocks?timestamp.ge=${dateStart}&timestamp.le=${dateEnd}&limit=1&sort.desc=level&select=level,timestamp`)
  ]);
  const [first, last] = await Promise.all([firstRes.json(), lastRes.json()]);
  
  // For future dates, estimate levels from the current head block
  if (!first.length || !last.length) {
    const headRes = await fetch("https://api.tzkt.io/v1/blocks?limit=1&sort.desc=level&select=level,timestamp");
    const [head] = await headRes.json();
    if (!head) throw new Error("Cannot fetch current block.");
    const headTime = new Date(head.timestamp).getTime();
    const startTime = new Date(dateStart).getTime();
    const endTime = new Date(dateEnd).getTime();
    const startLevel = head.level + Math.round((startTime - headTime) / (BLOCK_TIME_S * 1000));
    const endLevel = head.level + Math.round((endTime - headTime) / (BLOCK_TIME_S * 1000));
    return { startLevel, endLevel, startTs: dateStart, endTs: dateEnd };
  }
  
  return { startLevel: first[0].level, endLevel: last[0].level, startTs: first[0].timestamp, endTs: last[0].timestamp };
}

async function getTimestamp(level, fallbackTs, fallbackLevel) {
  try {
    const r = await fetch(`https://api.tzkt.io/v1/blocks/${level}?select=timestamp`);
    const d = await r.json();
    return new Date(d.timestamp);
  } catch {
    const base = new Date(fallbackTs);
    return new Date(base.getTime() + (level - fallbackLevel) * BLOCK_TIME_S * 1000);
  }
}

function formatLocal(d) {
  if (!d) return "--:--";
  return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: true });
}

function RankBadge({ rank }) {
  const colors = ["#b8860b", "#7a8a98", "#a0622a"];
  const color = rank <= 3 ? colors[rank - 1] : "#aaa";
  return (
    <span style={{ fontSize: 20, fontWeight: 600, color, minWidth: 32, textAlign: "center" }}>
      #{rank}
    </span>
  );
}

export default function App() {
  const todayStr = new Date().toISOString().slice(0, 10);
  const [baker, setBaker] = useState("tz1NZXxWG8bBL1YGzeLRfh2uia3JGkD4NcQ2");
  const [date, setDate] = useState(todayStr);
  const [windowMinutes, setWindowMinutes] = useState(3);
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");
  const [results, setResults] = useState(null);
  const [loading, setLoading] = useState(false);

  const run = useCallback(async () => {
    setError("");
    setResults(null);
    setLoading(true);

    try {
      if (!baker.trim()) throw new Error("Enter a baker address.");
      if (!date) throw new Error("Select a date.");
      if (windowMinutes < 1) throw new Error("Minimum outage interval is 1 minute.");

      setStatus(`Fetching block range for ${date}…`);
      const tzOffset = new Date(date + "T00:00:00").getTimezoneOffset();
      const pad = (n) => String(Math.abs(n)).padStart(2, "0");
      const sign = tzOffset <= 0 ? "+" : "-";
      const tzStr = `${sign}${pad(Math.floor(Math.abs(tzOffset) / 60))}:${pad(Math.abs(tzOffset) % 60)}`;
      const dayStart = `${date}T00:00:00${tzStr}`;
      const dayEnd = `${date}T23:59:59${tzStr}`;
      const { startLevel, endLevel, startTs } = await getLevelRange(dayStart, dayEnd);
      const totalLevels = endLevel - startLevel + 1;

      setStatus(`Fetching rights across ${totalLevels.toLocaleString()} levels…`);
      const rights = await fetchAllRights(baker.trim(), startLevel, endLevel, (n) =>
        setStatus(`Loaded ${n.toLocaleString()} rights entries…`)
      );

      setStatus(`Analyzing ${rights.length.toLocaleString()} entries…`);

      if (!rights.length) {
        setResults({ empty: true, baker, date });
        setStatus("");
        setLoading(false);
        return;
      }

      const levelMap = {};
      for (const r of rights) {
        if (!levelMap[r.level]) levelMap[r.level] = { attestations: 0, blocks: 0 };
        if (r.type === "attestation" || r.type === "attesting") levelMap[r.level].attestations += (r.slots || 1);
        else if (r.type === "baking") levelMap[r.level].blocks++;
      }

      const MIN_GAP_LEVELS = Math.round((windowMinutes * 60) / BLOCK_TIME_S);
      const windowScores = [];
      for (let l = startLevel; l <= endLevel - WINDOW_LEVELS; l++) {
        let score = 0, att = 0, blk = 0;
        for (let i = 0; i < WINDOW_LEVELS; i++) {
          const d = levelMap[l + i];
          if (d) { score += d.attestations + d.blocks * 3; att += d.attestations; blk += d.blocks; }
        }
        windowScores.push({ level: l, score, attestCount: att, blockCount: blk });
      }

      windowScores.sort((a, b) => a.score - b.score || a.level - b.level);

      const top = [];
      for (const w of windowScores) {
        if (top.length >= 5) break;
        if (!top.some(t => Math.abs(t.level - w.level) < MIN_GAP_LEVELS)) top.push(w);
      }

      const maxScore = Math.max(...windowScores.map(w => w.score)) || 1;

      setStatus("Fetching timestamps…");
      const levels = [...new Set(top.flatMap(w => [w.level, w.level + WINDOW_LEVELS]))];
      const tsMap = {};
      await Promise.all(levels.map(async (lvl) => {
        tsMap[lvl] = await getTimestamp(lvl, startTs, startLevel);
      }));

      const enriched = top.map((w, i) => ({
        ...w,
        rank: i + 1,
        tStart: tsMap[w.level],
        tEnd: tsMap[w.level + WINDOW_LEVELS],
        quietness: Math.max(0, Math.round(100 - (w.score / maxScore) * 100)),
      }));

      const dayTotal = Object.values(levelMap).reduce((s, v) => s + v.attestations + v.blocks, 0);
      setResults({ windows: enriched, dayTotal, totalRights: rights.length, baker, date, startLevel, endLevel });
      setStatus("");
    } catch (e) {
      setError(e.message);
      setStatus("");
    }
    setLoading(false);
  }, [baker, date, windowMinutes]);

  const labelStyle = { display: "block", fontSize: 12, fontWeight: 600, letterSpacing: "0.04em", color: "#888", marginBottom: 4, textTransform: "uppercase" };
  const inputStyle = { width: "100%", padding: "8px 10px", fontSize: 14, border: "0.5px solid #ccc", borderRadius: 8, outline: "none", background: "transparent", color: "inherit", fontFamily: "inherit" };
  const monoInput = { ...inputStyle, fontFamily: "monospace", fontSize: 13 };

  return (
    <div style={{ maxWidth: 660, padding: "1.5rem 0", fontFamily: "system-ui, sans-serif" }}>
      <h2 style={{ fontSize: 20, fontWeight: 600, marginBottom: 4 }}>Baker quiet window finder</h2>
      <p style={{ fontSize: 14, color: "#777", marginBottom: 20 }}>
        Find the 5 calmest 3-minute slots in a baker's schedule for a given day
      </p>

      <div style={{ marginBottom: 12 }}>
        <label style={labelStyle}>Baker address (Mainnet)</label>
        <input style={monoInput} value={baker} onChange={e => setBaker(e.target.value)} placeholder="tz1..." />
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 16 }}>
        <div>
          <label style={labelStyle}>Date</label>
          <input type="date" style={inputStyle} value={date} max={(() => { const d = new Date(); d.setDate(d.getDate() + 2); return d.toISOString().slice(0, 10); })()} onChange={e => setDate(e.target.value)} />
        </div>
        <div>
          <label style={labelStyle}>Outage Time Interval (min)</label>
          <input type="number" style={inputStyle} value={windowMinutes} min={1} max={720} step={1}
            onChange={e => setWindowMinutes(Number(e.target.value))} />
        </div>
      </div>

      <button
        onClick={run}
        disabled={loading}
        style={{ width: "100%", padding: "10px 0", fontSize: 15, fontWeight: 600, borderRadius: 8, border: "0.5px solid #ccc", cursor: loading ? "not-allowed" : "pointer", opacity: loading ? 0.5 : 1, background: "transparent", color: "inherit" }}
      >
        {loading ? "Analyzing…" : "Analyze schedule ↗"}
      </button>

      {status && (
        <p style={{ fontSize: 13, color: "#888", marginTop: 12, display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ display: "inline-block", width: 12, height: 12, border: "2px solid #ccc", borderTopColor: "#888", borderRadius: "50%", animation: "spin 0.7s linear infinite" }} />
          {status}
        </p>
      )}
      {error && <p style={{ fontSize: 13, color: "#c0392b", marginTop: 12 }}>⚠ {error}</p>}

      {results?.empty && (
        <div style={{ marginTop: 20, padding: "12px 16px", background: "#f5f5f5", borderRadius: 10, fontSize: 14, color: "#555" }}>
          No rights found for <code>{results.baker.slice(0, 16)}…</code> on {results.date}. Try a different baker or date.
        </div>
      )}

      {results?.windows && (
        <div style={{ marginTop: 24 }}>
          <div style={{ display: "flex", alignItems: "baseline", gap: 10, marginBottom: 12 }}>
            <h3 style={{ fontSize: 16, fontWeight: 600 }}>Top 5 quiet windows</h3>
            <span style={{ fontSize: 12, color: "#888", border: "0.5px solid #ddd", borderRadius: 20, padding: "2px 10px" }}>
              {results.date} · outage interval {windowMinutes}min
            </span>
          </div>

          <div style={{ fontSize: 13, color: "#777", background: "#f8f8f8", borderRadius: 8, padding: "10px 14px", marginBottom: 16, lineHeight: 1.6 }}>
            Analyzed <strong>{results.totalRights.toLocaleString()}</strong> rights entries across levels {results.startLevel.toLocaleString()}–{results.endLevel.toLocaleString()}.
            Score = attestations + 3×blocks. Lower = quieter. Each window is {WINDOW_MINUTES} min (~{WINDOW_LEVELS} blocks).
          </div>

          {results.windows.map((w) => (
            <div key={w.level} style={{ display: "flex", alignItems: "center", gap: 16, padding: "14px 16px", border: "0.5px solid #e0e0e0", borderRadius: 12, marginBottom: 10, background: "#fff" }}>
              <RankBadge rank={w.rank} />
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 17, fontWeight: 600, fontVariantNumeric: "tabular-nums", marginBottom: 4 }}>
                  {formatLocal(w.tStart)} – {formatLocal(w.tEnd)}
                  <span style={{ fontSize: 12, color: "#aaa", fontWeight: 400, marginLeft: 10 }}>block {w.level.toLocaleString()}</span>
                </div>
                <div style={{ display: "flex", gap: 16, fontSize: 13, color: "#777", flexWrap: "wrap", marginBottom: 6 }}>
                  <span>🟢 {w.attestCount} attestations</span>
                  <span>🟡 {w.blockCount} block proposals</span>
                  <span style={{ color: "#aaa" }}>score: {w.score}</span>
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <div style={{ flex: 1, height: 5, background: "#eee", borderRadius: 3, overflow: "hidden" }}>
                    <div style={{ width: `${w.quietness}%`, height: "100%", background: "#1D9E75", borderRadius: 3 }} />
                  </div>
                  <span style={{ fontSize: 12, color: "#888", minWidth: 70 }}>{w.quietness}% quiet</span>
                </div>
              </div>
            </div>
          ))}

          <p style={{ fontSize: 12, color: "#aaa", marginTop: 8 }}>
            Total rights that day: {results.dayTotal.toLocaleString()} · Levels {results.startLevel.toLocaleString()}–{results.endLevel.toLocaleString()}
          </p>
        </div>
      )}

      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}
