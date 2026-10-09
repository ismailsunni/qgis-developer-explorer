#!/usr/bin/env python3
"""Stamp docs/index.html's asset links with a content hash.

Pages serves app.js and style.css with a cache lifetime of its own choosing, so
a deploy can hand a browser new HTML beside a cached old script. Hashing the
URLs makes that impossible. The deploy workflow runs it, so the committed
index.html can stay unstamped.
"""
import hashlib, pathlib, re

docs = pathlib.Path(__file__).resolve().parent.parent / "docs"
index = docs / "index.html"
html = index.read_text()

for asset, attr in (("app.js", "src"), ("style.css", "href"), ("vendor/d3-force.min.js", "src")):
    h = hashlib.sha256((docs / asset).read_bytes()).hexdigest()[:10]
    html = re.sub(rf'{attr}="{re.escape(asset)}(?:\?v=[0-9a-f]+)?"', f'{attr}="{asset}?v={h}"', html)

index.write_text(html)
print("stamped", *re.findall(r'(?:src|href)="(?:app\.js|style\.css|vendor/d3-force\.min\.js)\?v=[0-9a-f]+"', html))
