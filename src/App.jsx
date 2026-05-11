import { useState, useCallback } from "react";

const BLOCK_TIME_S = 6;
const DEFAULT_WINDOW_MINUTES = 3;

async function fetchAllRights(baker, startLevel, endLevel, onProgress, tsStart, tsEnd) {
  const PAGE = 10000;
  let rights = [];
  let offset = 0;
  const useTimestamp = tsStart && tsEnd;
  while (true) {
    const url = useTimestamp
      ? `https://api.tzkt.io/v1/rights?baker=${baker}&timestamp.ge=${tsStart}&timestamp.le=${tsEnd}&limit=${PAGE}&offset=${offset}`
      : `https://api.tzkt.io/v1/rights?baker=${baker}&level.ge=${startLevel}&level.le=${endLevel}&limit=${PAGE}&offset=${offset}`;
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
    return { startLevel, endLevel, startTs: dateStart, endTs: dateEnd, isFuture: true };
  }
  
  // If the day hasn't ended yet, estimate endLevel for the remaining hours
  const endTime = new Date(dateEnd).getTime();
  const lastBlockTime = new Date(last[0].timestamp).getTime();
  let endLevel = last[0].level;
  if (endTime > lastBlockTime) {
    endLevel = last[0].level + Math.round((endTime - lastBlockTime) / (BLOCK_TIME_S * 1000));
  }
  return { startLevel: first[0].level, endLevel, startTs: first[0].timestamp, endTs: last[0].timestamp, isFuture: false };
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
  const todayStr = (() => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`; })();
  const [baker, setBaker] = useState("");
  const [date, setDate] = useState(todayStr);
  const [windowMinutes, setWindowMinutes] = useState(3);
  const [gapMinutes, setGapMinutes] = useState(60);
  const [topN, setTopN] = useState(5);
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

      // Step 1: Get current head block and its timestamp
      setStatus(`Fetching current block…`);
      const headRes = await fetch("https://api.tzkt.io/v1/blocks?limit=1&sort.desc=level&select=level,timestamp");
      const headData = await headRes.json();
      const head = Array.isArray(headData) ? headData[0] : headData;
      const headLevel = typeof head === "object" ? head.level : head;
      const headTimeUTC = typeof head === "object" && head.timestamp ? new Date(head.timestamp).getTime() : Date.now();

      // Step 2: Define the selected day boundaries in LOCAL time
      const dayStartLocal = new Date(date + "T00:00:00"); // midnight local start
      const dayEndLocal = new Date(date + "T23:59:59");   // 11:59:59 PM local end
      const nowLocal = new Date();
      const isToday = date === todayStr;

      // Step 3: Determine the actual time range to analyze
      // For today: from NOW to end of day local
      // For future days: from midnight to 11:59 PM local
      const rangeStartTime = isToday ? nowLocal.getTime() : dayStartLocal.getTime();
      const rangeEndTime = dayEndLocal.getTime();

      if (rangeStartTime >= rangeEndTime) throw new Error("No time remaining in the selected day.");

      // Step 4: Estimate block levels for the time range
      const startLevel = headLevel + Math.round((rangeStartTime - headTimeUTC) / (BLOCK_TIME_S * 1000));
      const endLevel = headLevel + Math.round((rangeEndTime - headTimeUTC) / (BLOCK_TIME_S * 1000));
      const startTs = new Date(rangeStartTime).toISOString();
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
      let maxRightsLevel = startLevel;
      for (const r of rights) {
        if (!levelMap[r.level]) levelMap[r.level] = { attestations: 0, blocks: 0 };
        if (r.type === "attestation" || r.type === "attesting") levelMap[r.level].attestations += (r.slots || 1);
        else if (r.type === "baking") levelMap[r.level].blocks++;
        if (r.level > maxRightsLevel) maxRightsLevel = r.level;
      }

      // Cap analysis at the last level with actual rights data
      const effectiveEndLevel = Math.min(endLevel, maxRightsLevel);

      const WINDOW_LEVELS = Math.round((windowMinutes * 60) / BLOCK_TIME_S);
      const MIN_GAP_LEVELS = Math.round((gapMinutes * 60) / BLOCK_TIME_S);
      const windowScores = [];
      for (let l = startLevel; l <= effectiveEndLevel - WINDOW_LEVELS; l++) {
        let score = 0, att = 0, blk = 0;
        for (let i = 0; i < WINDOW_LEVELS; i++) {
          const d = levelMap[l + i];
          if (d) { score += d.attestations + d.blocks * 10000; att += d.attestations; blk += d.blocks; }
        }
        windowScores.push({ level: l, score, attestCount: att, blockCount: blk });
      }

      windowScores.sort((a, b) => a.score - b.score || a.level - b.level);

      let candidates = windowScores;

      const top = [];
      for (const w of candidates) {
        if (top.length >= topN) break;
        if (!top.some(t => Math.abs(t.level - w.level) < MIN_GAP_LEVELS)) top.push(w);
      }

      const maxScore = Math.max(...windowScores.map(w => w.score)) || 1;

      setStatus("Calculating timestamps…");
      const levels = [...new Set(top.flatMap(w => [w.level, w.level + WINDOW_LEVELS]))];
      const tsMap = {};
      for (const lvl of levels) {
        // Estimate time from head block: headTimeUTC + (lvl - headLevel) * blockTime
        tsMap[lvl] = new Date(headTimeUTC + (lvl - headLevel) * BLOCK_TIME_S * 1000);
      }

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
  }, [baker, date, windowMinutes, gapMinutes, topN]);

  const labelStyle = { display: "block", fontSize: 12, fontWeight: 600, letterSpacing: "0.04em", color: "#6a8da8", marginBottom: 4, textTransform: "uppercase" };
  const inputStyle = { width: "100%", padding: "8px 10px", fontSize: 14, border: "1px solid #1e3a5f", borderRadius: 8, outline: "none", background: "transparent", color: "inherit", fontFamily: "inherit" };
  const monoInput = { ...inputStyle, fontFamily: "monospace", fontSize: 13 };

  return (
    <div style={{ maxWidth: 660, padding: "1.5rem 0", fontFamily: "system-ui, sans-serif" }}>
      <h2 style={{ fontSize: 20, fontWeight: 600, marginBottom: 12 }}>Baker Quiet Window Finder</h2>
      <p style={{ fontSize: 14, color: "#7a9bb5", marginBottom: 20 }}>
        Find the 5 calmest slots in a baker's schedule for a given day — useful for planning maintenance windows, upgrades, or any downtime where missing attestations or block proposals should be minimized.
      </p>
      <p style={{ fontSize: 13, color: "#5a8a9f", marginBottom: 4 }}>
        <strong>Outage Window</strong> — the duration (in minutes) of each quiet slot to find.
      </p>
      <p style={{ fontSize: 13, color: "#5a8a9f", marginBottom: 4 }}>
        <strong>Results Gap</strong> — minimum time (in minutes) between results so they are spread throughout the day.
      </p>
      <p style={{ fontSize: 13, color: "#5a8a9f", marginBottom: 20 }}>
        <strong>Top Results</strong> — how many of the best quiet windows to show.
      </p>

      <div style={{ marginBottom: 12 }}>
        <label style={labelStyle}>Baker address (Mainnet)</label>
        <input style={monoInput} value={baker} onChange={e => setBaker(e.target.value)} placeholder="tz1..." />
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr", gap: 12, marginBottom: 16 }}>
        <div>
          <label style={labelStyle}>Date</label>
          <input type="date" style={inputStyle} value={date} min={todayStr} max={(() => { const d = new Date(); d.setDate(d.getDate() + 2); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`; })()} onChange={e => setDate(e.target.value)} />
        </div>
        <div>
          <label style={labelStyle}>Outage Window</label>
          <input type="number" style={inputStyle} value={windowMinutes} min={1} max={720} step={1}
            onChange={e => setWindowMinutes(Number(e.target.value))} />
        </div>
        <div>
          <label style={labelStyle}>Results Gap</label>
          <input type="number" style={inputStyle} value={gapMinutes} min={1} max={720} step={1}
            onChange={e => setGapMinutes(Number(e.target.value))} />
        </div>
        <div>
          <label style={labelStyle}>Top Results</label>
          <input type="number" style={inputStyle} value={topN} min={1} max={20} step={1}
            onChange={e => setTopN(Number(e.target.value))} />
        </div>
      </div>

      <button
        onClick={run}
        disabled={loading}
        style={{ width: "100%", padding: "10px 0", fontSize: 15, fontWeight: 600, borderRadius: 8, border: "1px solid #1e3a5f", cursor: loading ? "not-allowed" : "pointer", opacity: loading ? 0.5 : 1, background: "transparent", color: "inherit" }}
      >
        {loading ? "Analyzing…" : "Analyze schedule ↗"}
      </button>

      {status && (
        <p style={{ fontSize: 13, color: "#6a8da8", marginTop: 12, display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ display: "inline-block", width: 12, height: 12, border: "2px solid #ccc", borderTopColor: "#888", borderRadius: "50%", animation: "spin 0.7s linear infinite" }} />
          {status}
        </p>
      )}
      {error && <p style={{ fontSize: 13, color: "#c0392b", marginTop: 12 }}>⚠ {error}</p>}

      {results?.empty && (
        <div style={{ marginTop: 20, padding: "12px 16px", background: "#162736", borderRadius: 10, fontSize: 14, color: "#8aa4b8" }}>
          {results.pastMessage || <>No rights found for <code>{results.baker.slice(0, 16)}…</code> on {results.date}. Try a different baker or date.</>}
        </div>
      )}

      {results?.windows && (
        <div style={{ marginTop: 24 }}>
          <div style={{ display: "flex", alignItems: "baseline", gap: 10, marginBottom: 12 }}>
            <h3 style={{ fontSize: 16, fontWeight: 600 }}>Top {topN} quiet windows</h3>
            <span style={{ fontSize: 12, color: "#6a8da8", border: "1px solid #1e3a5f", borderRadius: 20, padding: "2px 10px" }}>
              {results.date} · outage interval {windowMinutes}min
            </span>
          </div>

          <div style={{ fontSize: 12, color: "#6a8da8", marginBottom: 12 }}>
            Credit to <a href="https://tzkt.io" target="_blank" rel="noopener noreferrer" style={{ color: "#4a9eff", textDecoration: "none" }}>TzKT APIs</a> for enabling this tool
          </div>

          <div style={{ fontSize: 13, color: "#7a9bb5", background: "#162736", borderRadius: 8, padding: "10px 14px", marginBottom: 16, lineHeight: 1.6 }}>
            Analyzed <strong>{results.totalRights.toLocaleString()}</strong> rights entries across levels {results.startLevel.toLocaleString()}–{results.endLevel.toLocaleString()}.
            Windows with no block proposals are always preferred. Lower score = quieter. Each window is {windowMinutes} min (~{Math.round((windowMinutes * 60) / BLOCK_TIME_S)} blocks).
          </div>

          {results.windows.map((w) => (
            <div key={w.level} style={{ display: "flex", alignItems: "center", gap: 16, padding: "14px 16px", border: "1px solid #1e3a5f", borderRadius: 12, marginBottom: 10, background: "#162736" }}>
              <RankBadge rank={w.rank} />
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 17, fontWeight: 600, fontVariantNumeric: "tabular-nums", marginBottom: 4 }}>
                  {formatLocal(w.tStart)} – {formatLocal(w.tEnd)}
                  <a href={`https://tzkt.io/${w.level}/operations`} target="_blank" rel="noopener noreferrer" style={{ fontSize: 12, color: "#4fc3f7", fontWeight: 400, marginLeft: 10, textDecoration: "none" }}>Starts at block {w.level.toLocaleString()}</a>
                </div>
                <div style={{ display: "flex", gap: 16, fontSize: 13, color: "#7a9bb5", flexWrap: "wrap", marginBottom: 6 }}>
                  <span>🟢 {w.attestCount} attestations</span>
                  <span>🟡 {w.blockCount} block proposals</span>
                  <span style={{ color: "#4a6a82" }}>score: {w.score}</span>
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <div style={{ flex: 1, height: 5, background: "#1e3a5f", borderRadius: 3, overflow: "hidden" }}>
                    <div style={{ width: `${w.quietness}%`, height: "100%", background: "#1D9E75", borderRadius: 3 }} />
                  </div>
                  <span style={{ fontSize: 12, color: "#6a8da8", minWidth: 70 }}>{w.quietness}% quiet</span>
                </div>
              </div>
            </div>
          ))}

          <p style={{ fontSize: 12, color: "#4a6a82", marginTop: 8 }}>
            Total rights that day: {results.dayTotal.toLocaleString()} · Levels {results.startLevel.toLocaleString()}–{results.endLevel.toLocaleString()}
          </p>
        </div>
      )}

      <p style={{ textAlign: "center", fontSize: 13, color: "#4a6a82", marginTop: 40, paddingTop: 16, borderTop: "1px solid #1e3a5f" }}>
        Powered by <a href="https://tzkt.io/tz1NZXxWG8bBL1YGzeLRfh2uia3JGkD4NcQ2" target="_blank" rel="noopener noreferrer" style={{ color: "#1D9E75", textDecoration: "none" }}>Dulo Stakery</a>
      </p>

      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}
