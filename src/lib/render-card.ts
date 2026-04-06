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

function normalizeHeightDisplay(value: unknown): string {
  const raw = String(value ?? "").trim();
  if (!raw) return "N/A";
  const compact = raw.replace(/\s+/g, "");
  const match = compact.match(/^(\d+)[-'](\d{1,2})(?:"|”)?$/);
  if (match) {
    return `${match[1]}'${match[2]}"`;
  }
  return raw;
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

  bits.push(`Height: ${esc(normalizeHeightDisplay(bio.height || "N/A"))}`);

  const statHeightRaw = normalizeHeightDisplay(
    bio.statistical_height_text ??
      bio.statistical_height ??
      bio.stat_height ??
      bio.statisticalHeight ??
      "N/A",
  );
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
    if (Math.abs(statHeightDelta) >= 0.01) {
      const signed = statHeightDelta > 0 ? `+${statHeightDelta.toFixed(2)}` : statHeightDelta.toFixed(2);
      statHeightText = `${statHeightText}, ${signed} in`;
    }
  }

  bits.push(
    `Statistical Height: <span class="${statHeightClass}">${esc(statHeightText)}</span>`,
  );

  return bits.join(" | ");
}

function shotSvg(shots: Array<Record<string, unknown>>): string {
  const width = 355;
  const height = 250;
  const filtered = shots.filter(
    (shot) => Number.isFinite(Number(shot.x)) && Number.isFinite(Number(shot.y)),
  );

  const courtLen = 940.0;
  const courtWid = 500.0;
  const halfLen = courtLen / 2.0;
  const margin = 20.0;

  function mapX(fullY: number): number {
    const y2 = Math.max(0.0, Math.min(courtWid, fullY));
    return margin + (y2 * (width - 2 * margin)) / courtWid;
  }

  function mapY(fullX: number): number {
    const x2 = Math.max(0.0, Math.min(courtLen, fullX));
    const xHalf = Math.min(x2, courtLen - x2);
    return margin + (xHalf * (height - 2 * margin)) / halfLen;
  }

  function pt(fullX: number, fullY: number): [number, number] {
    return [mapX(fullY), mapY(fullX)];
  }

  const misses: string[] = [];
  const makes: string[] = [];
  for (const shot of filtered) {
    const x = Number(shot.x);
    const y = Number(shot.y);
    const made = Boolean(shot.made);
    const fill = made ? "#22c55e" : "#ef4444";
    const dot = `<circle cx="${mapX(y).toFixed(1)}" cy="${mapY(x).toFixed(1)}" r="4.2" fill="${fill}" fill-opacity="0.8" />`;
    if (made) makes.push(dot);
    else misses.push(dot);
  }

  const hoopX = 40.0;
  const hoopY = 250.0;
  const laneX = 190.0;
  const laneYMin = 190.0;
  const laneYMax = 310.0;
  const ftR = 60.0;
  const restrictedR = 40.0;
  const threeR = 221.46;
  const cornerYMin = 30.0;
  const cornerYMax = 470.0;
  const threeJoinX =
    hoopX + Math.sqrt(Math.max(0.0, threeR * threeR - (hoopY - cornerYMin) ** 2));

  const [ox1, oy1] = pt(0.0, 0.0);
  const [ox2, oy2] = pt(halfLen, courtWid);
  const [lx1, ly1] = pt(0.0, laneYMin);
  const [lx2, ly2] = pt(laneX, laneYMax);
  const [hx, hy] = pt(hoopX, hoopY);
  const [bb1x, bb1y] = pt(40.0 - 7.5, 220.0);
  const [bb2x, bb2y] = pt(40.0 - 7.5, 280.0);
  const [ftcx, ftcy] = pt(laneX, hoopY);
  const [c1x1, c1y1] = pt(0.0, cornerYMin);
  const [c1x2, c1y2] = pt(threeJoinX, cornerYMin);
  const [c2x1, c2y1] = pt(0.0, cornerYMax);
  const [c2x2, c2y2] = pt(threeJoinX, cornerYMax);

  const arcPoints: string[] = [];
  for (let i = 0; i <= 80; i += 1) {
    const yy = cornerYMin + ((cornerYMax - cornerYMin) * i) / 80.0;
    const dx = Math.sqrt(Math.max(0.0, threeR * threeR - (yy - hoopY) ** 2));
    const xx = hoopX + dx;
    const [px, py] = pt(xx, yy);
    arcPoints.push(`${px.toFixed(1)},${py.toFixed(1)}`);
  }

  const pxPerUnitY = (width - 2 * margin) / courtWid;
  const pxPerUnitX = (height - 2 * margin) / halfLen;
  const rrX = restrictedR * pxPerUnitY;
  const rrY = restrictedR * pxPerUnitX;
  const ftRx = ftR * pxPerUnitY;
  const ftRy = ftR * pxPerUnitX;

  const court = `
<rect x="${ox1.toFixed(1)}" y="${oy1.toFixed(1)}" width="${(ox2 - ox1).toFixed(1)}" height="${(oy2 - oy1).toFixed(1)}" fill="#000000" stroke="#ffffff" stroke-width="2"/>
<rect x="${lx1.toFixed(1)}" y="${ly1.toFixed(1)}" width="${(lx2 - lx1).toFixed(1)}" height="${(ly2 - ly1).toFixed(1)}" fill="none" stroke="#ffffff" stroke-width="2"/>
<line x1="${bb1x.toFixed(1)}" y1="${bb1y.toFixed(1)}" x2="${bb2x.toFixed(1)}" y2="${bb2y.toFixed(1)}" stroke="#ffffff" stroke-width="2"/>
<ellipse cx="${hx.toFixed(1)}" cy="${hy.toFixed(1)}" rx="6.0" ry="6.0" fill="none" stroke="#ffffff" stroke-width="2"/>
<path d="M ${mapX(hoopY - restrictedR).toFixed(1)} ${hy.toFixed(1)} A ${rrX.toFixed(1)} ${rrY.toFixed(1)} 0 0 1 ${mapX(hoopY + restrictedR).toFixed(1)} ${hy.toFixed(1)}" fill="none" stroke="#ffffff" stroke-width="2"/>
<ellipse cx="${ftcx.toFixed(1)}" cy="${ftcy.toFixed(1)}" rx="${ftRx.toFixed(1)}" ry="${ftRy.toFixed(1)}" fill="none" stroke="#ffffff" stroke-width="2"/>
<line x1="${c1x1.toFixed(1)}" y1="${c1y1.toFixed(1)}" x2="${c1x2.toFixed(1)}" y2="${c1y2.toFixed(1)}" stroke="#ffffff" stroke-width="2"/>
<line x1="${c2x1.toFixed(1)}" y1="${c2y1.toFixed(1)}" x2="${c2x2.toFixed(1)}" y2="${c2y2.toFixed(1)}" stroke="#ffffff" stroke-width="2"/>
<polyline points="${arcPoints.join(" ")}" fill="none" stroke="#ffffff" stroke-width="2"/>
<line x1="${ox1.toFixed(1)}" y1="${oy2.toFixed(1)}" x2="${ox2.toFixed(1)}" y2="${oy2.toFixed(1)}" stroke="#ffffff" stroke-width="2"/>
`;

  return `<svg viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg" aria-label="Shot chart">
  ${court}
  ${misses.join("")}
  ${makes.join("")}
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
  const projectionHtml =
    input.mode === "transfer"
      ? String(sections.transfer_projection_html ?? "").trim()
      : String(sections.draft_projection_html ?? "");

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
          ${projectionHtml}
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
