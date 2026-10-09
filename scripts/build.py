#!/usr/bin/env python3
"""Aggregate raw/prs.json into docs/data/qgis.json for the page."""
import json, pathlib, re, statistics
from collections import Counter, defaultdict
from datetime import datetime, timezone

ROOT = pathlib.Path(__file__).resolve().parent.parent
OUT = ROOT / "docs" / "data" / "qgis.json"
# accounts GitHub does not type as Bot but that are automation all the same
BOTS = re.compile(r"(bot|\[bot\])$|^(github-actions|qgis-bot|coveralls|lgtm-com|codecov.*|sonarcloud)", re.I)
# per-person yearly counters
O, MG, CL, CM, RV, AP, MR = range(7)

ts = lambda s: datetime.fromisoformat(s.replace("Z", "+00:00"))


def quartiles(xs):
    if len(xs) < 4:
        return [round(statistics.median(xs), 1)] * 3 if xs else None
    q = statistics.quantiles(xs, n=4)
    return [round(v, 1) for v in q]


def aggregate(prs, is_bot, humans):
    """Every chart's series, built over PRs/comments/reviews by humans only or by everyone."""
    keep = lambda login: not (humans and is_bot(login))
    monthly = defaultdict(lambda: {"o": 0, "mg": 0, "cl": 0, "cm": 0, "p": set()})
    yearly = defaultdict(lambda: {"o": 0, "mg": 0, "cl": 0, "cm": 0, "ttm": [], "p": set()})
    heat = defaultdict(lambda: [[0] * 24 for _ in range(7)])
    pairs = Counter()
    for p in prs:
        a = p["a"][0]
        if keep(a):
            c = ts(p["c"])
            mo, yr = monthly[p["c"][:7]], yearly[c.year]
            mo["o"] += 1; yr["o"] += 1
            mo["p"].add(a); yr["p"].add(a)
            heat[c.year][c.weekday()][c.hour] += 1
            if p["m"]:
                m = ts(p["m"])
                monthly[p["m"][:7]]["mg"] += 1; yearly[m.year]["mg"] += 1
                yearly[m.year]["ttm"].append((m - c).total_seconds() / 86400)
            elif p["x"]:
                monthly[p["x"][:7]]["cl"] += 1; yearly[ts(p["x"]).year]["cl"] += 1
        for login, _, when in p["cm"]:
            if keep(login):
                monthly[when[:7]]["cm"] += 1; yearly[int(when[:4])]["cm"] += 1
        if keep(a):
            for other in {x[0] for x in p["cm"] + p["rv"]} - {a}:
                if keep(other):
                    pairs[(other, a, int(p["c"][:4]))] += 1

    years = sorted(yearly)
    authors_by_year = {y: yearly[y]["p"] for y in years}
    seen = set()
    yearly_out = []
    for y in years:
        d, ppl = yearly[y], authors_by_year[y]
        yearly_out.append({
            "y": y, "o": d["o"], "mg": d["mg"], "cl": d["cl"], "cm": d["cm"], "people": len(ppl),
            "newcomers": len(ppl - seen), "returning": len(ppl & authors_by_year.get(y - 1, set())),
            "ttm": quartiles(d["ttm"]),
        })
        seen |= ppl
    return {
        "monthly": [{"m": m, **{k: v for k, v in d.items() if k != "p"}, "p": len(d["p"])}
                    for m, d in sorted(monthly.items())],
        "yearly": yearly_out,
        "heatmapByYear": {y: heat[y] for y in sorted(heat)},
        "graph": graph(pairs),
    }


def graph(pairs, top=80, max_edges=4000):
    """Two people join when one comments on or reviews the other's PR."""
    weight = Counter()
    for (a, b, _), n in pairs.items():
        weight[a] += n; weight[b] += n
    nodes = [l for l, _ in weight.most_common(top)]
    idx = {l: i for i, l in enumerate(nodes)}
    edges = defaultdict(Counter)
    for (a, b, y), n in pairs.items():
        if a in idx and b in idx:
            edges[tuple(sorted((idx[a], idx[b])))][y] += n
    ranked = sorted(edges.items(), key=lambda e: -sum(e[1].values()))[:max_edges]
    node_years = defaultdict(Counter)
    for (a, b), ys in ranked:
        for y, n in ys.items():
            node_years[a][y] += n; node_years[b][y] += n
    return {"nodes": [{"name": l, "years": dict(node_years[i])} for i, l in enumerate(nodes)],
            "edges": [[a, b, dict(ys)] for (a, b), ys in ranked]}


def main():
    raw = json.loads((ROOT / "raw" / "prs.json").read_text())["prs"]
    prs = sorted(raw.values(), key=lambda p: p["n"])
    now = datetime.now(timezone.utc)

    typed_bot = {x[0] for p in prs for x in [p["a"], *p["cm"], *p["rv"]] if x[1]}
    is_bot = lambda login: login in typed_bot or bool(BOTS.search(login))

    years = defaultdict(lambda: defaultdict(lambda: [0] * 7))
    span, ttm, size, recv = defaultdict(list), defaultdict(list), Counter(), Counter()
    for p in prs:
        a, y = p["a"][0], int(p["c"][:4])
        years[a][y][O] += 1
        if p["m"] or p["x"]:
            years[a][y][MG if p["m"] else CL] += 1
        span[a].append(p["c"][:10])
        size[a, "add"] += p["add"]; size[a, "del"] += p["del"]
        if p["m"]:
            ttm[a].append((ts(p["m"]) - ts(p["c"])).total_seconds() / 86400)
            if p["mb"]:
                years[p["mb"]][int(p["m"][:4])][MR] += 1
                span[p["mb"]].append(p["m"][:10])
        for login, _, when in p["cm"]:
            years[login][int(when[:4])][CM] += 1
            span[login].append(when[:10])
            if login != a:
                recv[a] += 1
        # one review per reviewer per PR, dated by their first one; self-reviews are thread replies
        first = {}
        for login, _, state, when in p["rv"]:
            if login != a:
                first.setdefault(login, [when, False])[1] |= state == "AP"
        for login, (when, approved) in first.items():
            years[login][int(when[:4])][RV] += 1
            years[login][int(when[:4])][AP] += approved
            span[login].append(when[:10])

    people = [{
        "name": l, "bot": int(is_bot(l)), "years": {y: v for y, v in sorted(ys.items())},
        "first": min(span[l]), "last": max(span[l]),
        "ttm": round(statistics.median(ttm[l]), 1) if ttm[l] else None,
        "add": size[l, "add"], "del": size[l, "del"], "recv": recv[l],
    } for l, ys in years.items()]
    people.sort(key=lambda r: -sum(v[O] for v in r["years"].values()))

    # a pool of notable PRs: most discussed, longest running, biggest
    def row(p):
        end = ts(p["m"] or p["x"]) if (p["m"] or p["x"]) else now
        return {"n": p["n"], "t": p["t"], "a": p["a"][0], "bot": int(is_bot(p["a"][0])),
                "s": "draft" if p["s"] == "O" and p["d"] else {"O": "open", "M": "merged", "C": "closed"}[p["s"]],
                "cm": p["nc"], "rv": p["nr"], "sz": p["add"] + p["del"], "start": p["c"][:10],
                "days": (end - ts(p["c"])).days}
    rows = [row(p) for p in prs]
    pool = {}
    for key, n in (("cm", 400), ("rv", 200), ("days", 300), ("sz", 200)):
        for r in sorted(rows, key=lambda r: -r[key])[:n]:
            pool[r["n"]] = r

    all_years = sorted({int(p["c"][:4]) for p in prs})
    out = {
        "meta": {"repo": "qgis/QGIS", "generated": now.strftime("%Y-%m-%d"), "prs": len(prs),
                 "merged": sum(1 for p in prs if p["m"]), "people": len(people),
                 "authors": sum(1 for r in people if any(v[O] for v in r["years"].values())),
                 "first": prs[0]["c"][:10], "last": max(p["u"] for p in prs)[:10]},
        "years": all_years,
        "people": people,
        "prs": sorted(pool.values(), key=lambda r: -r["cm"]),
        "all": aggregate(prs, is_bot, False),
        "humans": aggregate(prs, is_bot, True),
    }
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(out, separators=(",", ":"), ensure_ascii=False))
    print(f"wrote {OUT} ({OUT.stat().st_size / 1e6:.1f} MB): {len(prs)} PRs, {len(people)} people")


if __name__ == "__main__":
    main()
