## What the assets do show

The reader reads as a calm, coherent artifact. The identity block, cover plate, paper-tone background and serif page body hold together at both widths, and the three-tab grouping (The reading / Contents / Pages) with a per-page frame, printed/physical caption pair and Previous/Next is a legible model of "inspect my actual book." Status copy is the strongest part: *"Email delayed. Your PDF is ready here; we're checking delivery to fixture@example.com"* and *"Keep this private link to return"* are non-alarming, state the fallback, and don't imply fault. The leaf arithmetic is internally consistent — 18 + 10 = the 28 in the summary line.

## Defects visible in these captures

**1. On the phone, reading sits beneath the download block. (Major)**
In images 2 and 3 the order is cover → "Read your book" → **Your complete PDF** with two full-bleed black buttons → *then* the tabs and page viewer. The two highest-contrast elements on the screen are downloads; in-page reading is discoverable only by scrolling past them. Smallest correction: on narrow widths move the "Your complete PDF" section below the Pages panel, leaving the existing "Read your book" link where it is as the in-page entry.

**2. "Your complete PDF" (singular) heads two volume downloads. (Minor, but it undercuts the new labelling work)**
The whole point of this checkpoint is that volumes are separate. Fix: "Your complete PDFs" or "Your volumes, as PDF."

**3. "28 pages" collides with the new page/leaf vocabulary. (Moderate)**
The summary says *28 pages*; the viewer then distinguishes *Page 7* (printed label) from *Leaf 10 of 18*. A creator counting either number will mismatch. Smallest correction: "Your complete edition is ready · 2 volumes, 28 leaves."

**4. The Printed page / Read as text toggle doesn't read as a control. (Moderate)**
Desktop and phone both render the inactive segment as unbordered plain text; only the active segment has a grey fill, and that fill is low-contrast against the paper background. In image 1 "Read as text" is easily mistaken for a caption. Fix: one shared outlined container with a divider, so both segments are visibly switchable.

**5. "Your complete volume. Every page is available here." (Minor)**
Singular, under a two-volume book, and it repeats the panel subtitle *"Your finished book, from the first leaf to the last."* Keep one. Suggest "Every page of Volume 1 is here" so it also confirms the current selection.

**6. Near-duplicate headings. (Minor)**
"Your writing, in print." then "Your writing, on the page." Plus the "Read your book" link plus the Pages tab — three overlapping invitations to the same view. Retitle the panel to something functional: "Every page."

**7. Phone target sizes and edge crowding. (Moderate)**
The selects and toggle segments look near but possibly under a 44px target; "← Previous" / "Next →" are bare text links sitting tight against the container edges and directly under the page frame, with the smallest labels on the screen. Fix: pad the pager row to a 44px minimum height and add horizontal inset, without changing the layout.

**8. No fit/zoom on the canvas. (Minor)**
The desktop frame is ~900px tall with content in the top eighth. That's the fixture's doing and I won't judge the text, but a creator inspecting a real dense page has no visible way to enlarge or fit. Worth a backlog note only.

**9. Selector context. (Minor)**
"Go to page" options read "Page 7 · leaf 10" with no volume token; after switching to Volume 2 (image 3) the label is identical to the Volume 1 state. Correct in context, but the selector alone is ambiguous if copied or read aloud.

**10. Disabled Next.** In image 3 "Next →" is lighter than "← Previous", which suggests an end-of-book state is styled. The contrast difference is slight; if it's a disabled control it should also be non-focusable-looking or paired with a short "Last page of Volume 2."

## What these assets cannot establish

Static captures cannot show: keyboard reachability, focus-ring visibility, tab order through selector → toggle → pager, or whether the pager is operable by arrow keys; any transition or loading behaviour; that the volume selector enumerates all 18 and 10 entries rather than a truncated list; responsiveness at widths other than these two; print or PDF fidelity of the canvas against the source;
