#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path
from typing import Any


def load_json(path: Path) -> Any:
    return json.loads(path.read_text(encoding="utf-8"))


def rel_to_pipeline(project_root: Path, rel: str) -> Path:
    return project_root / "player_cards_pipeline" / rel


def main() -> None:
    ap = argparse.ArgumentParser(description="Export women player comparison HTML for a target list.")
    ap.add_argument("--repo-root", required=True, help="Absolute path to NCAAWCards_clean")
    ap.add_argument("--targets-file", required=True, help="JSON file of {player,team,season}")
    ap.add_argument("--output-file", required=True, help="Path to write JSON results")
    args = ap.parse_args()

    repo_root = Path(args.repo_root).resolve()
    sys.path.insert(0, str(repo_root))

    import cbb_player_cards_v1.build_player_card as bpc

    settings = load_json(repo_root / "player_cards_pipeline" / "config" / "settings.json")
    bt_csv = rel_to_pipeline(repo_root, settings["bt_advstats_csv"])
    _header, bt_rows = bpc.read_csv_rows(bt_csv)
    if not bt_rows:
      raise RuntimeError(f"No BT rows loaded from {bt_csv}")
    bpc.inject_enriched_fields_into_bt_rows(bt_rows)

    bio_lookup: dict[tuple[str, str, str], dict[str, str]] = {}
    bio_rel = settings.get("bio_csv", "")
    if bio_rel:
        bio_path = rel_to_pipeline(repo_root, bio_rel)
        if bio_path.exists():
            bio_lookup = bpc.load_bio_lookup(bio_path)

    players_all = bpc.build_player_pool_from_bt(bt_rows)
    by_key: dict[tuple[str, str, str], Any] = {}
    for player in players_all:
        key = (
            bpc.norm_player_name(player.player),
            bpc.norm_team(player.team),
            bpc.norm_season(player.season),
        )
        by_key[key] = player

    targets = load_json(Path(args.targets_file))
    if not isinstance(targets, list):
        raise RuntimeError("Targets file must be a JSON list")

    results: list[dict[str, Any]] = []
    for index, item in enumerate(targets, start=1):
        if not isinstance(item, dict):
            continue
        player = str(item.get("player", "")).strip()
        team = str(item.get("team", "")).strip()
        season = str(item.get("season", "")).strip()
        if not player or not team or not season:
            continue

        key = (
            bpc.norm_player_name(player),
            bpc.norm_team(team),
            bpc.norm_season(season),
        )
        target = by_key.get(key)
        if target is None:
            results.append(
                {
                    "player": player,
                    "team": team,
                    "season": int(season),
                    "comparisons_html": '<div class="panel"><h3>Player Comparisons</h3><div class="shot-meta">No matching Bart row for comparisons.</div></div>',
                }
            )
            continue

        comparisons_html = bpc.build_player_comparisons_html(target, bt_rows, bio_lookup, top_n=5)
        results.append(
            {
                "player": player,
                "team": team,
                "season": int(season),
                "comparisons_html": comparisons_html,
            }
        )
        if index % 25 == 0 or index == len(targets):
            print(f"[export] built {index}/{len(targets)} comparisons", flush=True)

    Path(args.output_file).write_text(json.dumps(results, ensure_ascii=True), encoding="utf-8")


if __name__ == "__main__":
    main()
