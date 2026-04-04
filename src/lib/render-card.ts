import { mergedSectionsHtml, type CardPayload } from "@/lib/static-payload";

function esc(value: unknown): string {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function num(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function fmt(value: unknown, suffix = "", digits = 1): string {
  const parsed = num(value);
  if (parsed === null) return "N/A";
  return `${parsed.toFixed(digits)}${suffix}`;
}

function pctBadge(value: unknown): string {
  const parsed = num(value);
  if (parsed === null) return "";
  return `${Math.round(parsed)}%`;
}

function buildSubtitleHtml(
  payload: CardPayload,
  input: { mode?: string; destinationConference?: string } = {},
): string {
  const bio = payload.bio ?? {};
  const bits: string[] = [
    esc(payload.team),
    esc(payload.season),
    `Position: ${esc(bio.position || "N/A")}`,
  ];

  const age = String(bio.age_june25 ?? "").trim();
  if (age) bits.push(`Age: ${esc(age)}`);

  bits.push(`Height: ${esc(bio.height || "N/A")}`);

  const statHeightRaw = String(
    bio.statistical_height_text ??
      bio.statistical_height ??
      bio.stat_height ??
      bio.statisticalHeight ??
      "N/A",
  ).trim();
  const statHeightDelta = num(
    bio.statistical_height_delta ??
      bio.stat_height_delta ??
      bio.statisticalHeightDelta,
  );
  let statHeightClass = "stat-height-at";
  let statHeightText = statHeightRaw || "N/A";

  if (statHeightDelta !== null) {
    if (statHeightDelta > 1.0) statHeightClass = "stat-height-above";
    else if (statHeightDelta < -1.0) statHeightClass = "stat-height-below";
  }

  bits.push(
    `Statistical Height: <span class="${statHeightClass}">${esc(statHeightText)}</span>`,
  );

  const rsci = String(bio.rsci ?? "").trim();
  if (rsci) bits.push(`RSCI: ${esc(rsci)}`);

  if (String(input.mode || "").toLowerCase() === "transfer") {
    bits.push(`Transfer: ${esc(input.destinationConference || "N/A")}`);
  }

  return bits.join(" | ");
}

function shotSvg(shots: Array<Record<string, unknown>>): string {
  const width = 355;
  const height = 250;
  const dots = shots
    .filter((shot) => Number.isFinite(Number(shot.x)) && Number.isFinite(Number(shot.y)))
    .slice(0, 400)
    .map((shot) => {
      const x = Math.max(10, Math.min(width - 10, Number(shot.x)));
      const y = Math.max(10, Math.min(height - 10, Number(shot.y)));
      const made = Boolean(shot.made);
      const fill = made ? "#22c55e" : "#ef4444";
      return `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="3.2" fill="${fill}" fill-opacity="0.85" />`;
    })
    .join("");

  return `<svg viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg" aria-label="Shot chart">
    <rect x="1" y="1" width="${width - 2}" height="${height - 2}" fill="#0f0f0f" stroke="#3b3b3b" stroke-width="2"/>
    <rect x="${width * 0.25}" y="20" width="${width * 0.5}" height="80" fill="none" stroke="#3b3b3b" stroke-width="2"/>
    <path d="M ${width * 0.18} 180 A ${width * 0.32} ${width * 0.32} 0 0 0 ${width * 0.82} 180" fill="none" stroke="#3b3b3b" stroke-width="2"/>
    <line x1="${width * 0.18}" y1="180" x2="${width * 0.18}" y2="${height - 10}" stroke="#3b3b3b" stroke-width="2"/>
    <line x1="${width * 0.82}" y1="180" x2="${width * 0.82}" y2="${height - 10}" stroke="#3b3b3b" stroke-width="2"/>
    <circle cx="${width / 2}" cy="55" r="18" fill="none" stroke="#3b3b3b" stroke-width="2"/>
    ${dots}
  </svg>`;
}

export function renderCardHtmlFromPayload(
  payload: CardPayload,
  input: { mode?: string; destinationConference?: string; gender?: string } = {},
): string {
  const perGame = payload.per_game ?? {};
  const shotChart = payload.shot_chart ?? {};
  const sections = mergedSectionsHtml(payload);
  const shots = Array.isArray(shotChart.shots) ? (shotChart.shots as Array<Record<string, unknown>>) : [];
  const attempts = num(shotChart.attempts) ?? 0;
  const makes = num(shotChart.makes) ?? 0;
  const fgPct = attempts > 0 ? (100 * makes) / attempts : num(shotChart.fg_pct) ?? 0;
  const subtitleHtml = buildSubtitleHtml(payload, input);

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${esc(payload.player)} - Player Card</title>
<style>
:root { --bg:#0a0a0a; --panel:#141414; --line:#3b3b3b; --text:#f5f5f5; --muted:#d4d4d4; --accent:#ffffff; --bar:#22c55e; --panel-alt:#1f1f1f; --bar-track:#2a2a2a; --shot-mid:#ef4444; }
body { margin:0; background:var(--bg); color:var(--text); font-family:"Segoe UI", Arial, sans-serif; }
.wrap { max-width:1100px; margin:18px auto; padding:16px; }
.card { border:2px solid var(--line); border-radius:12px; background:#000000; padding:16px; }
.title { font-size:44px; line-height:1; font-weight:800; color:var(--accent); margin:0 0 8px 0; }
.title-row { display:flex; align-items:flex-start; justify-content:space-between; gap:12px; }
.grade-strip { display:grid; grid-template-columns:repeat(5, minmax(96px, 1fr)); gap:8px; min-width:560px; margin-top:-4px; }
.grade-chip { border:1px solid var(--line); border-radius:8px; padding:6px 8px; text-align:center; background:var(--panel-alt); }
.grade-k { color:var(--muted); font-size:11px; line-height:1.1; }
.grade-v { font-size:22px; font-weight:800; line-height:1.1; color:var(--accent); }
.sub { color:var(--muted); margin-bottom:0; font-size:15px; }
.stat-height-above { color:#22c55e; font-weight:700; }
.stat-height-below { color:#ef4444; font-weight:700; }
.stat-height-at { color:#f5f5f5; font-weight:700; }
.row { display:grid; grid-template-columns:1fr 1fr; gap:14px; }
.panel { border:1px solid var(--line); border-radius:10px; padding:12px; background:var(--panel); }
.per-game-panel { margin-top:10px; }
.panel h3 { margin:0 0 4px 0; font-size:14px; }
.section-grid { display:grid; grid-template-columns:repeat(3, minmax(210px, 1fr)); gap:10px; }
.section-card { border:1px solid var(--line); border-radius:8px; padding:8px; background:var(--panel-alt); }
.section-card h4 { margin:0 0 4px 0; font-size:12px; color:var(--text); letter-spacing:0.1px; }
.kv { display:grid; grid-template-columns:repeat(3, minmax(120px, 1fr)); gap:8px; font-size:14px; }
.stat-strip { margin-top:10px; display:grid; grid-template-columns:repeat(8, 1fr); gap:8px; }
.shot-wrap { display:flex; justify-content:flex-start; gap:12px; align-items:stretch; }
.left-wrap { flex:0 0 33%; min-width:320px; display:flex; flex-direction:column; gap:12px; }
.shot-panel { min-width:0; }
.shot-panel svg { display:block; margin:0 auto; transform:translateX(-8px); }
.shot-chart-col { min-width:0; }
.chip { border:1px solid var(--line); border-radius:8px; padding:8px; text-align:center; background:var(--panel-alt); }
.chip .k { color:var(--muted); font-size:12px; }
.chip .v { font-size:20px; font-weight:700; }
.chip .p { margin-top:3px; color:var(--muted); font-size:10px; line-height:1; }
.metric-row { display:grid; grid-template-columns:72px 58px 1fr 34px; gap:6px; align-items:center; margin-bottom:5px; }
.metric-label { color:var(--muted); font-size:12px; }
.metric-val { font-weight:700; font-size:12px; }
.bar-wrap { height:12px; border-radius:999px; background:var(--bar-track); overflow:hidden; }
.bar-fill { height:12px; background:var(--bar); }
.metric-pct { text-align:right; font-weight:700; font-size:12px; }
.shot-meta { font-size:13px; color:var(--muted); margin-bottom:8px; }
.trend-wrap { margin-top:8px; }
.shotdiet-bar { width:100%; height:16px; border-radius:999px; overflow:hidden; background:var(--bar-track); border:1px solid var(--line); display:flex; }
.shotdiet-seg { height:100%; display:block; flex:0 0 auto; }
.shotdiet-rim { background:var(--bar); }
.shotdiet-mid { background:var(--shot-mid); }
.shotdiet-three { background:#60a5fa !important; box-shadow:none; }
.shotdiet-legend { margin-top:8px; display:flex; justify-content:space-between; align-items:center; gap:10px; font-size:12px; color:var(--muted); }
.shotdiet-key { display:flex; align-items:center; gap:7px; white-space:nowrap; }
.shotdiet-dot { width:9px; height:9px; border-radius:999px; display:inline-block; }
.right-wrap { flex:1 1 auto; display:grid; grid-template-columns:1fr 1fr; gap:12px; align-items:stretch; margin-top:14px; }
.right-col { display:flex; flex-direction:column; gap:12px; min-height:100%; }
.comp-table { display:grid; gap:6px; }
.comp-row { display:grid; grid-template-columns:1fr 42px 42px; gap:8px; font-size:12px; align-items:center; border:1px solid var(--line); border-radius:7px; padding:6px 8px; background:var(--panel-alt); }
.comp-name { font-weight:600; color:var(--text); }
.comp-year { color:var(--muted); text-align:right; }
.comp-score { color:var(--accent); text-align:right; font-weight:700; }
.play-grid { display:grid; gap:11px; }
.play-row { display:grid; grid-template-columns:74px 1fr; gap:6px; align-items:center; }
.play-name { font-size:12px; font-weight:700; color:var(--text); }
.play-stack { display:grid; gap:6px; }
.play-line { display:grid; grid-template-columns:1fr 82px; gap:6px; align-items:center; }
.play-track { position:relative; height:10px; background:var(--bar-track); border:1px solid var(--line); border-radius:999px; overflow:visible; }
.play-fill { height:100%; border-radius:999px; }
.play-vol { background:#60a5fa; }
.play-ppp { background:var(--bar); }
.play-badge { position:absolute; top:50%; transform:translate(-50%, -50%); width:15px; height:15px; border-radius:999px; border:1px solid var(--line); background:#0e0e0e; color:#fff; font-size:8px; font-weight:700; line-height:15px; text-align:center; }
.play-tag { color:var(--muted); font-size:9px; white-space:nowrap; }
.play-head { display:flex; align-items:center; justify-content:space-between; gap:10px; margin-bottom:6px; }
.play-head h3 { margin:0; }
.play-legend { display:flex; align-items:center; gap:10px; font-size:11px; color:var(--muted); }
.play-legend-item { display:inline-flex; align-items:center; gap:6px; }
.play-legend-dot { width:9px; height:9px; border-radius:999px; display:inline-block; }
.playstyles-wrap { flex:1 1 auto; display:flex; }
.playstyles-wrap .panel { width:100%; }
.team-impact-wrap { margin-top:2px; }
.comp-bottom { margin-top:0; }
.draft-proj-main { font-size:22px; font-weight:800; color:var(--accent); margin-top:2px; }
.draft-proj-panel { flex:1 1 auto; display:flex; flex-direction:column; }
.draft-proj-sub { margin-top:4px; color:var(--muted); font-size:11px; }
.draft-proj-credit { margin-top:auto; padding-top:8px; color:#60a5fa; font-size:15px; font-weight:700; }
.play-credit { margin-top:8px; color:#60a5fa; font-size:15px; font-weight:700; }
.draft-odds-grid { margin-top:8px; display:grid; gap:4px; flex:1 1 auto; align-content:start; }
.transfer-two-col { grid-template-columns:1fr 1fr; gap:6px; }
.draft-odd-row { display:grid; grid-template-columns:1fr auto; gap:8px; align-items:center; font-size:11px; border:1px solid var(--line); border-radius:6px; padding:4px 6px; background:var(--panel-alt); }
.transfer-two-col .draft-odd-row { font-size:10px; padding:3px 5px; }
.transfer-impact-list { margin-top:2px; display:grid; gap:2px; max-height:64px; overflow:hidden; }
.transfer-impact-row { display:grid; grid-template-columns:1fr auto auto; gap:6px; font-size:10px; color:var(--muted); line-height:1.05; }
.transfer-impact-row span:nth-child(2), .transfer-impact-row span:nth-child(3) { color:var(--text); font-weight:700; text-align:right; }
.transfer-impact-head span { color:var(--muted) !important; font-weight:600 !important; }
.draft-odd-k { color:var(--muted); }
.draft-odd-v { font-weight:700; color:var(--text); }
.ti-comp-stack { display:flex; flex-direction:column; gap:0; }
.ti-section { margin-top:8px; }
.ti-subhead { font-size:13px; color:var(--text); font-weight:700; margin:0; text-align:left !important; }
.ti-table { width:100%; border-collapse:separate; border-spacing:0; table-layout:fixed; margin:0 0 6px 0; font-size:11px; }
.ti-table th, .ti-table td { border:none; padding:2px 4px; }
.ti-table th { color:var(--muted); font-weight:700; text-align:right; }
.ti-table th:first-child { text-align:left; }
.ti-metric { color:var(--muted); text-align:left; white-space:nowrap; }
.ti-num { text-align:right; font-variant-numeric:tabular-nums; }
.card-credit-footer { margin-top:10px; color:#60a5fa; font-size:12px; font-weight:700; line-height:1.1; }
@media (max-width: 920px) {
  .title-row { flex-direction:column; }
  .grade-strip { min-width:0; width:100%; grid-template-columns:repeat(2, minmax(130px, 1fr)); }
  .row { grid-template-columns:1fr; }
  .stat-strip { grid-template-columns:repeat(3, 1fr); }
  .section-grid { grid-template-columns:1fr; }
  .left-wrap { width:100%; flex:1 1 auto; min-width:0; }
  .shot-panel { width:100%; min-width:0; }
  .shot-chart-col { min-width:0; }
  .left-wrap { width:100%; flex:1 1 auto; min-width:0; }
  .right-wrap { width:100%; margin-top:14px; grid-template-columns:1fr; }
  .right-col { width:100%; }
}
</style>
</head>
<body>
  <div class="wrap">
    <div class="card">
      <div class="title-row">
        <h1 class="title">${esc(payload.player)}</h1>
        <div class="grade-strip">${sections.grade_boxes_html || ""}</div>
      </div>
      <div class="sub">${subtitleHtml}</div>

      <div class="panel per-game-panel">
        <h3>Per Game</h3>
        <div class="stat-strip">
          <div class="chip"><div class="k">PPG</div><div class="v">${fmt(perGame.ppg)}</div><div class="p">${pctBadge((perGame.percentiles as Record<string, unknown> | undefined)?.ppg)}</div></div>
          <div class="chip"><div class="k">RPG</div><div class="v">${fmt(perGame.rpg)}</div><div class="p">${pctBadge((perGame.percentiles as Record<string, unknown> | undefined)?.rpg)}</div></div>
          <div class="chip"><div class="k">APG</div><div class="v">${fmt(perGame.apg)}</div><div class="p">${pctBadge((perGame.percentiles as Record<string, unknown> | undefined)?.apg)}</div></div>
          <div class="chip"><div class="k">SPG</div><div class="v">${fmt(perGame.spg)}</div><div class="p">${pctBadge((perGame.percentiles as Record<string, unknown> | undefined)?.spg)}</div></div>
          <div class="chip"><div class="k">BPG</div><div class="v">${fmt(perGame.bpg)}</div><div class="p">${pctBadge((perGame.percentiles as Record<string, unknown> | undefined)?.bpg)}</div></div>
          <div class="chip"><div class="k">FG%</div><div class="v">${fmt(perGame.fg_pct)}</div><div class="p">${pctBadge((perGame.percentiles as Record<string, unknown> | undefined)?.fg_pct)}</div></div>
          <div class="chip"><div class="k">3P%</div><div class="v">${fmt(perGame.tp_pct)}</div><div class="p">${pctBadge((perGame.percentiles as Record<string, unknown> | undefined)?.tp_pct)}</div></div>
          <div class="chip"><div class="k">FT%</div><div class="v">${fmt(perGame.ft_pct)}</div><div class="p">${pctBadge((perGame.percentiles as Record<string, unknown> | undefined)?.ft_pct)}</div></div>
        </div>
      </div>

      ${sections.bt_percentiles_html || ""}

      <div class="shot-wrap">
        <div class="left-wrap">
          <div class="panel shot-panel shot-chart-col" style="margin-top:14px;">
            <h3>Shot Chart</h3>
            <div class="shot-meta">Attempts: ${attempts} | Made: ${makes} | FG%: ${fmt(fgPct, "%")}</div>
            <div class="shot-meta">${esc(shotChart.pps_over_expectation_line || "Points per Shot Over Expectation: N/A")}</div>
            ${shotSvg(shots)}
          </div>
          ${sections.draft_projection_html || ""}
        </div>
        <div class="right-wrap">
          <div class="right-col">
            ${sections.self_creation_html || ""}
            <div class="playstyles-wrap">${sections.playstyles_html || ""}</div>
          </div>
          <div class="right-col">
            ${sections.shot_diet_html || ""}
            <div class="ti-comp-stack">
              <div class="team-impact-wrap">${sections.team_impact_html || ""}</div>
              <div class="comp-bottom">${sections.player_comparisons_html || ""}</div>
            </div>
          </div>
        </div>
      </div>
      <div class="card-credit-footer">CREATED BY @DBCJASON</div>
    </div>
  </div>
</body>
</html>`;
}
