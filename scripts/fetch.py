#!/usr/bin/env python3
"""Mirror every qgis/QGIS pull request into raw/prs.json via the GraphQL API.

Needs GITHUB_TOKEN, or `gh auth login` done once. With no mirror yet (or with
--full) it backfills in parallel, one search per slice of creation dates.
Otherwise it walks PRs newest-updated first and stops at the first one that
has not changed since the previous run. When the GraphQL budget runs out it
sleeps until reset.
"""
import calendar, json, os, pathlib, subprocess, sys, time, urllib.error, urllib.request
from concurrent.futures import ThreadPoolExecutor
from datetime import date, datetime, timedelta, timezone

OWNER, NAME = os.environ.get("REPO", "qgis/QGIS").split("/")
# GITHUB_TOKEN in Actions; locally falls back to a logged-in GitHub CLI
TOKEN = os.environ.get("GITHUB_TOKEN") or subprocess.run(
    ["gh", "auth", "token"], capture_output=True, text=True).stdout.strip()
RAW = pathlib.Path(__file__).resolve().parent.parent / "raw" / "prs.json"

FIELDS = """
  number title state isDraft createdAt closedAt mergedAt updatedAt
  additions deletions changedFiles
  author { login __typename }
  mergedBy { login }
  comments(first: 100) { totalCount nodes { createdAt author { login __typename } } }
  reviews(first: 100) { totalCount nodes { state submittedAt author { login __typename } } }
"""
WALK = """query($owner: String!, $name: String!, $cursor: String, $page: Int!) {
  rateLimit { remaining resetAt }
  repository(owner: $owner, name: $name) {
    pullRequests(first: $page, after: $cursor, orderBy: {field: UPDATED_AT, direction: DESC}) {
      pageInfo { hasNextPage endCursor } nodes { %s }
    }
  }
}""" % FIELDS
SEARCH = """query($q: String!, $cursor: String, $page: Int!) {
  rateLimit { remaining resetAt }
  search(query: $q, type: ISSUE, first: $page, after: $cursor) {
    issueCount pageInfo { hasNextPage endCursor } nodes { ... on PullRequest { %s } }
  }
}""" % FIELDS


def gql(query, variables):
    """One call, retried with a smaller page on the 502s heavy pages cause."""
    variables = {"page": 50, **variables}
    while True:
        req = urllib.request.Request(
            "https://api.github.com/graphql",
            data=json.dumps({"query": query, "variables": variables}).encode(),
            headers={"Authorization": f"bearer {TOKEN}", "User-Agent": "qgis-developer-explorer"},
        )
        try:
            with urllib.request.urlopen(req, timeout=120) as r:
                body = json.load(r)
            if "errors" in body:
                raise RuntimeError(body["errors"])
        except (urllib.error.URLError, TimeoutError, RuntimeError) as e:
            print(f"  retry after error: {str(e)[:160]}", file=sys.stderr, flush=True)
            if getattr(e, "code", None) == 403:  # secondary rate limit
                time.sleep(60)
            variables["page"] = max(10, variables["page"] // 2)
            time.sleep(5)
            continue
        rl = body["data"]["rateLimit"]
        if rl["remaining"] < 50:
            wait = calendar.timegm(time.strptime(rl["resetAt"], "%Y-%m-%dT%H:%M:%SZ")) - time.time() + 10
            print(f"  rate limit nearly spent, sleeping {wait:.0f}s", flush=True)
            time.sleep(max(0, wait))
        return body["data"], variables["page"]


def who(actor):
    """[login, is_bot]; deleted accounts come back as null and become 'ghost'."""
    if not actor:
        return ["ghost", 0]
    return [actor["login"], int(actor["__typename"] == "Bot")]


def compact(p):
    return {
        "n": p["number"], "t": p["title"], "s": p["state"][0], "d": int(p["isDraft"]),
        "c": p["createdAt"], "x": p["closedAt"], "m": p["mergedAt"], "u": p["updatedAt"],
        "a": who(p["author"]), "mb": p["mergedBy"]["login"] if p["mergedBy"] else None,
        "add": p["additions"], "del": p["deletions"], "f": p["changedFiles"],
        "nc": p["comments"]["totalCount"], "nr": p["reviews"]["totalCount"],
        "cm": [who(c["author"]) + [c["createdAt"]] for c in p["comments"]["nodes"]],
        "rv": [who(r["author"]) + [r["state"][:2], r["submittedAt"]]
               for r in p["reviews"]["nodes"] if r["submittedAt"]],
    }


def save(state):
    RAW.parent.mkdir(exist_ok=True)
    RAW.write_text(json.dumps(state, separators=(",", ":")))


def slice_prs(a, b):
    """Every PR created between two dates; search caps at 1,000 hits, so split until under."""
    q = f"repo:{OWNER}/{NAME} is:pr created:{a}..{b}"
    out, cursor, page = [], None, 50
    while True:
        data, page = gql(SEARCH, {"q": q, "cursor": cursor, "page": page})
        s = data["search"]
        if s["issueCount"] > 1000 and a < b:
            mid = a + (b - a) // 2
            return slice_prs(a, mid) + slice_prs(mid + timedelta(days=1), b)
        out += [compact(p) for p in s["nodes"] if p]
        if not s["pageInfo"]["hasNextPage"]:
            print(f"  {a}..{b}: {len(out)} PRs", flush=True)
            return out
        cursor = s["pageInfo"]["endCursor"]


def backfill(state):
    started = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    months, d = [], date(2008, 1, 1)
    while d <= date.today():
        nxt = (d + timedelta(days=32)).replace(day=1)
        months.append((d, nxt - timedelta(days=1)))
        d = nxt
    todo = [m for m in months if str(m[0]) not in state["done"]]
    with ThreadPoolExecutor(8) as pool:
        for (a, _), prs in zip(todo, pool.map(lambda m: slice_prs(*m), todo)):
            state["prs"].update((str(p["n"]), p) for p in prs)
            if a.replace(day=1) != date.today().replace(day=1):  # the open month is re-done on resume
                state["done"].append(str(a))
            save(state)
    # anything updated while the backfill ran is picked up by the next incremental run
    state.update(synced=started, done=[])


def incremental(state):
    prs, cursor, page, seen = state["prs"], None, 50, 0
    while True:
        data, page = gql(WALK, {"owner": OWNER, "name": NAME, "cursor": cursor, "page": page})
        conn = data["repository"]["pullRequests"]
        fresh = [p for p in conn["nodes"] if p["updatedAt"] > state["synced"]]
        prs.update((str(p["number"]), compact(p)) for p in fresh)
        seen += len(fresh)
        print(f"  {seen} PRs updated (rate limit left: {data['rateLimit']['remaining']})", flush=True)
        if len(fresh) < len(conn["nodes"]) or not conn["pageInfo"]["hasNextPage"]:
            break
        cursor, page = conn["pageInfo"]["endCursor"], min(50, page * 2)
    state["synced"] = max(p["u"] for p in prs.values())


def main():
    state = json.loads(RAW.read_text()) if RAW.exists() else {"synced": "", "done": [], "prs": {}}
    if "--full" in sys.argv:
        state.update(synced="", done=[])
    if state["synced"]:
        incremental(state)
    else:
        backfill(state)
    save(state)
    print(f"{len(state['prs'])} PRs in {RAW}")


if __name__ == "__main__":
    main()
