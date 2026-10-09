# QGIS developer explorer

An interactive view of every pull request to [qgis/QGIS](https://github.com/qgis/QGIS):
who opens, merges, reviews and discusses them, how long merging takes, and how
that has changed since the project moved to GitHub. A sibling of
[qgis-lists-explorer](https://github.com/ismailsunni/qgis-lists-explorer), which
does the same for the mailing lists.

**→ [ismailsunni.id/qgis-developer-explorer](https://ismailsunni.id/qgis-developer-explorer/)**

## What it shows

| Section | Question it answers |
|---|---|
| Activity over time | How many PRs are opened, merged, closed; how many authors and comments? (drag to filter everything else) |
| Most active developers | Who opens, merges, comments, reviews or merges the most, in any period? |
| PRs per author | How lopsided is contribution? |
| Developer table | Per person: PRs, merged, closed, open, merge rate, comments written and received, PRs reviewed and approved, merges done for others, median time to merge, lines changed, first/last activity, span, PRs per year |
| Who works with whom | Graph of the 80 most connected people, joined when one comments on or reviews the other's PR |
| Time to merge | Median and middle half of days-to-merge, per year |
| How PRs end | Merged vs closed without merging, per year |
| Notable pull requests | The most discussed, most reviewed, longest running and largest PRs (sort any column) |
| When PRs are opened | Weekday × hour, UTC |
| Newcomers and regulars | Is the contributor base renewing itself? |

## Definitions

- **PRs / merged / closed / open** in the table count the PRs a person *opened* in
  the period, by what has happened to them since. The timeline instead dates a
  merge or a close by when it happened.
- **Comments** are conversation comments on PRs. Inline code-review comments are
  not counted on their own; they belong to a review.
- **Reviewed** counts PRs reviewed, not review events: someone who leaves five
  reviews on one PR has reviewed one PR. Reviews on your own PR are left out,
  since GitHub records replies in a review thread as reviews by the author.
- **Received** is comments by others on your PRs (all time).
- **Time to merge** and **lines ±** are all-time per person; the time-to-merge
  chart dates each merge by the year it happened.
- **Span** runs from someone's first to their last activity of any kind: opening a
  PR, commenting, reviewing, or merging.
- **Bots.** Accounts GitHub types as bots, plus `qgis-bot` and similar automation
  (the regex is in `scripts/build.py`), are hidden by default. Every aggregate is
  built with and without them, so the toggle moves every chart. `qgis-bot` opens
  the backport PRs, which is a large share of all PRs.
- Only the first 100 comments and 100 reviews of a PR are fetched individually.
  The totals in the notable-PR table are exact, but the very longest threads are
  slightly undercounted in per-person figures.

## How it works

`scripts/fetch.py` mirrors every PR into `raw/prs.json` through the GitHub
GraphQL API. With no mirror yet, it backfills in parallel with one search per
month of creation dates. After that it walks PRs newest-updated first and stops
at the first one that hasn't changed, so a refresh takes seconds.
`scripts/build.py` aggregates the mirror into `docs/data/qgis.json`. The page is
static HTML/CSS/JS with hand-rolled SVG charts, no build step and no tracking.
The one dependency is d3-force, vendored into `docs/vendor/` (rebuild with
`scripts/vendor-d3.sh`).

## Deployment

`.github/workflows/deploy.yml` runs daily, on every push to `main` and on
demand. It restores the raw mirror from the Actions cache, updates it, rebuilds
the JSON, stamps asset URLs with a content hash (`scripts/stamp.py`) and deploys
`docs/` to GitHub Pages. Neither the mirror nor the JSON is committed.

One-time setup: **Settings → Pages → Source: GitHub Actions**. The workflow's own
token is enough, but a cold cache (the first run, or after 7 days without a run)
means a full backfill, which takes hours under that token's 1,000-point hourly
budget. A personal token with public read-only access, saved as the `GH_PAT`
repository secret, makes that take minutes.

## Local use

```sh
export GITHUB_TOKEN=...            # or `gh auth login` once
./scripts/update.sh                # first run backfills (~30 min), later runs are incremental
./scripts/update.sh --full         # re-fetch everything
python3 -m http.server -d docs 8000
```
