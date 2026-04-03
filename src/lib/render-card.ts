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
  const bio = payload.bio ?? {};
  const perGame = payload.per_game ?? {};
  const shotChart = payload.shot_chart ?? {};
  const sections = mergedSectionsHtml(payload);
  const shots = Array.isArray(shotChart.shots) ? (shotChart.shots as Array<Record<string, unknown>>) : [];
  const attempts = num(shotChart.attempts) ?? 0;
  const makes = num(shotChart.makes) ?? 0;
  const fgPct = attempts > 0 ? (100 * makes) / attempts : num(shotChart.fg_pct) ?? 0;
  const subtitleBits = [
    payload.team,
    payload.season,
    `Position: ${bio.position || "N/A"}`,
    `Age: ${bio.age_june25 || "N/A"}`,
    `Height: ${bio.height || "N/A"}`,
    `RSCI: ${bio.rsci || "Unranked"}`,
  ];
  if (String(input.mode || "").toLowerCase() === "transfer") {
    subtitleBits.push(`Transfer: ${input.destinationConference || "N/A"}`);
  } else if (input.mode) {
    subtitleBits.push(`${esc(input.mode)} mode`);
  }

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${esc(payload.player)} - Player Card</title>
<style>
:root { --bg:#0a0a0a; --panel:#141414; --line:#3b3b3b; --text:#f5f5f5; --muted:#d4d4d4; --accent:#ffffff; --panel-alt:#1f1f1f; --bar-track:#2a2a2a; }
body { margin:0; background:var(--bg); color:var(--text); font-family:"Segoe UI", Arial, sans-serif; }
.wrap { max-width:1100px; margin:18px auto; padding:16px; }
.card { border:2px solid var(--line); border-radius:12px; background:#000; padding:16px; }
.title { font-size:44px; line-height:1; font-weight:800; color:var(--accent); margin:0 0 8px 0; }
.title-row { display:flex; align-items:flex-start; justify-content:space-between; gap:12px; }
.grade-strip { display:grid; grid-template-columns:repeat(5, minmax(96px, 1fr)); gap:8px; min-width:560px; margin-top:-4px; }
.sub { color:var(--muted); margin-bottom:0; font-size:15px; }
.panel { border:1px solid var(--line); border-radius:10px; padding:12px; background:var(--panel); }
.per-game-panel { margin-top:10px; }
.panel h3 { margin:0 0 4px 0; font-size:14px; }
.stat-strip { margin-top:10px; display:grid; grid-template-columns:repeat(8, 1fr); gap:8px; }
.chip { border:1px solid var(--line); border-radius:8px; padding:8px; text-align:center; background:var(--panel-alt); }
.chip .k { color:var(--muted); font-size:12px; }
.chip .v { font-size:20px; font-weight:700; }
.chip .p { margin-top:3px; color:var(--muted); font-size:10px; line-height:1; }
.shot-wrap { display:flex; justify-content:flex-start; gap:12px; align-items:stretch; }
.left-wrap { flex:0 0 33%; min-width:320px; display:flex; flex-direction:column; gap:12px; }
.right-wrap { flex:1 1 auto; display:grid; grid-template-columns:1fr 1fr; gap:12px; align-items:stretch; margin-top:14px; }
.right-col { display:flex; flex-direction:column; gap:12px; min-height:100%; }
.shot-meta { font-size:13px; color:var(--muted); margin-bottom:8px; }
.card-credit-footer { margin-top:10px; color:#60a5fa; font-size:12px; font-weight:700; line-height:1.1; }
@media (max-width: 920px) {
  .title-row { flex-direction:column; }
  .grade-strip { min-width:0; width:100%; grid-template-columns:repeat(2, minmax(130px, 1fr)); }
  .stat-strip { grid-template-columns:repeat(3, 1fr); }
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
      <div class="sub">${subtitleBits.map(esc).join(" | ")}</div>

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
            ${sections.playstyles_html || ""}
          </div>
          <div class="right-col">
            ${sections.shot_diet_html || ""}
            <div>${sections.team_impact_html || ""}</div>
            <div>${sections.player_comparisons_html || ""}</div>
            <div class="card-credit-footer">CREATED BY @DBCJASON</div>
          </div>
        </div>
      </div>
    </div>
  </div>
</body>
</html>`;
}
