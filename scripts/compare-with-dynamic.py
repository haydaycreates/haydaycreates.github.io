#!/usr/bin/env python3
"""
Compare the static Astro build against the running dynamic site.

Not a byte diff — attribute order and whitespace differ between the two
renderers. This compares what a reader experiences: the visible text, the
class names that drive the design, and the counts of repeated elements.
"""
import re, sys, urllib.request, pathlib, collections

DYNAMIC = "http://localhost:3010"
STATIC = pathlib.Path(__file__).resolve().parent.parent / "dist"

PAGES = [
    ("/",              "index.html"),
    ("/blog",          "blog/index.html"),
    ("/about",         "about/index.html"),
    ("/resources",     "resources/index.html"),
    ("/blog/the-pen-menu-and-how-to-use-it",                    "blog/the-pen-menu-and-how-to-use-it/index.html"),
    ("/blog/why-i-write-before-i-check-my-phone",               "blog/why-i-write-before-i-check-my-phone/index.html"),
    ("/blog/on-keeping-a-commonplace-book",                     "blog/on-keeping-a-commonplace-book/index.html"),
    ("/blog/tools-that-survived-a-year-of-real-work",           "blog/tools-that-survived-a-year-of-real-work/index.html"),
    ("/blog?tag=writing",   "blog/tag/writing/index.html"),
]

def get(url):
    with urllib.request.urlopen(url, timeout=20) as r:
        return r.read().decode()

def normalise(html):
    html = re.sub(r'<script[\s\S]*?</script>', '', html)
    html = re.sub(r'<head>[\s\S]*?</head>', '', html)          # titles/meta differ by design
    html = re.sub(r'<div class="empty" data-empty-state[\s\S]*?</div>', '', html)  # toggled by JS
    html = re.sub(r'<!--[\s\S]*?-->', '', html)
    # elements that only exist in the dynamic build
    html = re.sub(r'<a class="btn btn-ghost btn-sm nav-write"[^>]*>.*?</a>', '', html, flags=re.S)
    html = re.sub(r'<a href="/(?:admin|write)/?"[^>]*>Write</a>', '', html)
    html = re.sub(r'<link rel="canonical"[^>]*>', '', html)
    html = re.sub(r'<span class="chip chip-draft">[^<]*</span>', '', html)
    return html

def visible_text(html):
    html = re.sub(r'(?is)<(script|style)[^>]*>.*?</\1>', ' ', html)
    html = re.sub(r'<br\s*/?>', ' ', html)
    html = re.sub(r'<[^>]+>', ' ', html)
    html = html.replace('&nbsp;', ' ').replace('&amp;', '&').replace('&lt;', '<') \
               .replace('&gt;', '>').replace('&quot;', '"').replace('&#39;', "'")
    return re.sub(r'\s+', ' ', html).strip()

def class_multiset(html):
    classes = collections.Counter()
    for attr in re.findall(r'class="([^"]*)"', html):
        for c in attr.split():
            classes[c] += 1
    return classes

def count(html, pattern):
    return len(re.findall(pattern, html))

CHECKS = {
    'cards':        r'class="card[ "]',
    'res cards':    r'class="res-card"',
    'tags':         r'<span class="tag"|<span class="tag tag-lg"|<a class="tag',
    'h1':           r'<h1',
    'h2':           r'<h2',
    'paragraphs':   r'<p[ >]',
    'links':        r'<a ',
    'inline colour':r'class="c-',
    'highlight':    r'class="hl-',
    'font switch':  r'class="f-',
    'reading time': r'min read',
}

failures = 0
for dyn_path, static_path in PAGES:
    try:
        dyn = normalise(get(DYNAMIC + dyn_path))
    except Exception as exc:
        print(f"  !! dynamic fetch failed for {dyn_path}: {exc}")
        failures += 1
        continue
    static_file = STATIC / static_path
    if not static_file.exists():
        print(f"  !! missing static file {static_path}")
        failures += 1
        continue
    sta = normalise(static_file.read_text())

    dtext, stext = visible_text(dyn), visible_text(sta)
    dcls, scls = class_multiset(dyn), class_multiset(sta)

    problems = []
    if dtext != stext:
        problems.append('text')
    missing_classes = {c: n for c, n in dcls.items() if scls.get(c, 0) < n}
    extra_classes = {c: n for c, n in scls.items() if dcls.get(c, 0) < n and c not in
                     ('card-featured', 'is-post', 'font-lora', 'size-medium', 'font-serif')}
    diff_counts = {k: (count(dyn, p), count(sta, p)) for k, p in CHECKS.items()
                   if count(dyn, p) != count(sta, p)}

    label = f"{dyn_path:52s}"
    if not problems and not missing_classes and not diff_counts:
        extra = f"  (+{len(extra_classes)} new classes)" if extra_classes else ""
        print(f"  PASS  {label} text ✓  classes ✓{extra}")
    else:
        failures += 1
        print(f"  DIFF  {label}")
        if dtext != stext:
            # show the first divergence
            for i, (a, b) in enumerate(zip(dtext, stext)):
                if a != b:
                    print(f"        text diverges at char {i}:")
                    print(f"          dynamic: …{dtext[max(0,i-60):i+60]!r}")
                    print(f"          static : …{stext[max(0,i-60):i+60]!r}")
                    break
            else:
                print(f"          lengths differ: dynamic {len(dtext)} vs static {len(stext)}")
                print(f"          dynamic tail: …{dtext[len(stext):len(stext)+90]!r}")
                print(f"          static  tail: …{stext[len(dtext):len(dtext)+90]!r}")
        if missing_classes:
            print(f"        classes missing from static: {missing_classes}")
        if diff_counts:
            print(f"        element counts (dynamic, static): {diff_counts}")

print()
print(f"  {'ALL PAGES MATCH' if failures == 0 else str(failures) + ' page(s) differ'}")
sys.exit(0 if failures == 0 else 1)
