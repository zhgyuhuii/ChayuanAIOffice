#!/usr/bin/env python3
"""Parse WPS _layouts CT_*.kuip files into a structured ribbon inventory.

Outputs per component (wps文字/et表格/wpp演示/pdf_PDF):
  inventory_<comp>.json  — tabs[] {id, file, groups[] {id, text, controls, kinds, spaceHints, canHideText}}
plus a cross-component summary printed to stdout (spaceHint totals, merge groups).

Usage: python3 inventory_kuip.py [outdir]
"""
import json
import re
import sys
from pathlib import Path
from xml.etree import ElementTree

LAYOUTS = Path(__file__).resolve().parent.parent / "_layouts"
COMPONENTS = {
    "wps_文字": "wps",
    "et_表格": "et",
    "wpp_演示": "wpp",
    "pdf_PDF": "pdf",
}

# Command classes that ARE visible controls vs plumbing, for kind stats.
CONTROL_CLASS = re.compile(r"^(K[A-Za-z]*)Command$")
PLUMBING = {"KCommand", "KCommandGroup", "KListCommand", "KRbLayoutListCommand"}


def strip_at(text: str | None) -> str:
    if not text:
        return ""
    return text[1:] if text.startswith("@") else text


def parse_commands_section(root) -> dict:
    """id → group/command info from the <commands> section (top level)."""
    info = {}
    commands = root.find("commands")
    if commands is None:
        return info
    for elem in commands:
        cid = elem.get("id")
        if not cid:
            continue
        children = list(elem)
        control_children = [
            c for c in children
            if c.tag.endswith("Command") or c.tag == "command" or c.tag == "separator"
        ]
        kinds = {}
        space_hints = []
        can_hide = 0
        for c in children:
            m = CONTROL_CLASS.match(c.tag)
            if m and m.group(1) not in {p[len("K"):] for p in PLUMBING if p.startswith("K")}:
                kinds[c.tag] = kinds.get(c.tag, 0) + 1
            for attr in ("spaceHint", "dynamicSpaceHint"):
                if c.get(attr):
                    space_hints.extend(c.get(attr).split(";"))
            if c.get("canHideText") == "1":
                can_hide += 1
        info[cid] = {
            "id": cid,
            "text": strip_at(elem.get("text")),
            "class": elem.tag,
            "childControls": len(control_children),
            "childClasses": kinds,
            "spaceHints": space_hints,
            "canHideText": can_hide,
            "mergeGroup": elem.get("singlerowmergegroup"),
        }
    return info


def parse_tab_file(path: Path, commands: dict) -> dict:
    root = ElementTree.parse(path).getroot()
    commands = parse_commands_section(root)
    groups = []
    merge_groups = []
    for sub in root.iter("subcommand"):
        for elem in sub:
            if elem.tag == "separator":
                continue
            ref = elem.get("idQ") or elem.get("id")
            if not ref:
                continue
            if ref.startswith("SingleRow_") or "MergeGroup" in (elem.get("id") or ""):
                merge_groups.append(ref)
                continue
            group = commands.get(ref)
            if group is None:
                # ref to a command declared in <app>common.kuip (imported) — record as external
                groups.append({"id": ref, "text": "", "external": True})
                continue
            groups.append(group)
    return {
        "tab": path.stem,
        "file": path.name,
        "groups": groups,
        "mergeGroups": sorted(set(merge_groups)),
    }


def main() -> None:
    outdir = Path(sys.argv[1]) if len(sys.argv) > 1 else LAYOUTS
    summary_lines = []
    for dir_name, comp in COMPONENTS.items():
        tab_dir = LAYOUTS / dir_name / "tab布局_ongmani"
        if not tab_dir.is_dir():
            continue
        tabs = []
        hint_totals: dict[str, int] = {}
        for path in sorted(tab_dir.glob("CT_*.kuip")):
            tab = parse_tab_file(path, {})
            for g in tab["groups"]:
                for h in g.get("spaceHints", []):
                    hint_totals[h] = hint_totals.get(h, 0) + 1
            tabs.append(tab)
        data = {"component": comp, "dir": dir_name, "tabs": tabs}
        out = outdir / f"inventory_{comp}.json"
        out.write_text(json.dumps(data, ensure_ascii=False, indent=1), encoding="utf-8")
        group_count = sum(len(t["groups"]) for t in tabs)
        summary_lines.append(
            f"{comp}: {len(tabs)} tabs, {group_count} group refs, spaceHints={hint_totals}"
        )
        for t in tabs[:3]:
            names = [g.get("text") or g["id"] for g in t["groups"]]
            summary_lines.append(f"  {t['tab']}: {names}")
    print("\n".join(summary_lines))


if __name__ == "__main__":
    main()
