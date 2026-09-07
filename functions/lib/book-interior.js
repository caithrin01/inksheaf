// The 6×9 typography and pagination rules used by full proofs and the public excerpt reader.
export function interiorCss({ bodyFont = 'Source Serif 4', imgMax = 4.2 } = {}) {
  return `@page{ size: 6in 9in; margin: 0.72in 0.62in 0.78in 0.62in; }
@page chapter{
  margin: 0.72in 0.62in 0.78in 0.62in;
  @bottom-center{ content: counter(page); font-family: "Source Serif 4", serif; font-size: 8.5pt; color: #6d675c; }
  @top-left{ content: string(pubname); font-family: "Source Serif 4", serif; font-size: 7.5pt; letter-spacing: 0.14em; text-transform: uppercase; color: #6d675c; }
  @top-right{ content: string(arttitle); font-family: "Source Serif 4", serif; font-size: 7.5pt; font-style: italic; color: #6d675c; }
}
@page cover{ margin: 0; }
@page frontmatter{ margin: 0.72in 0.62in 0.78in 0.62in; }
html{ font-size: 10.5pt }
body{ font-family:"${bodyFont}", "Source Serif 4", Georgia, serif; color:var(--ink); line-height:1.5;
  font-optical-sizing:auto; margin:0 }
.pubsrc{ string-set: pubname content(text); height:0; overflow:hidden; visibility:hidden }
p{ margin:0 0 0 0; text-indent:1.35em; text-align:justify; hyphens:none; orphans:2; widows:2 }
.artbody > p:first-of-type{ text-indent:0 }

.about p, .getmore p{ text-indent:0 }
a{ color:inherit; text-decoration:none }
/* an image must always fit under an opener head, or Paged.js pushes it whole to the next page
   and leaves the page it left mostly white (blank-page detector, 2026-09-02); --img-max caps it */
img{ max-width:100%; max-height:${imgMax}in; width:auto; height:auto; display:block; margin:.9em auto }
figure{ margin:1em 0; break-inside:avoid }
h2, h3, h4{ break-after:avoid; page-break-after:avoid } figcaption{ font-size:8.5pt; color:var(--faint); text-align:center; margin-top:.35em }
blockquote{ margin:.9em 1.4em; font-size:9.8pt; color:#3a352c }
h1,h2,h3,h4{ line-height:1.15; font-weight:var(--headweight); font-family:var(--headfont), "Source Serif 4", serif }
hr{ border:0; text-align:center; margin:1.2em 0 }
hr::after{ content:"❦"; color:var(--rubric); font-size:10pt }
ul,ol{ margin:.7em 0 .7em 1.5em; padding:0 }
li{ margin:.2em 0; text-align:justify; hyphens:none }
pre{ font-size:8pt; background:#f4efe4; padding:.6em; overflow:hidden; white-space:pre-wrap; word-break:break-word }
code{ font-size:8.5pt }
p.verse{ text-align:left; text-indent:0; hyphens:none }
.longurl{ word-break:break-all; hyphens:none; font-size:9pt }
.gifnote{ font-size:7.5pt; color:var(--faint); text-align:center; margin:-.5em 0 .9em }
table{ width:100%; border-collapse:collapse; font-size:8pt; margin:.9em 0 }
td, th{ border:1px solid var(--rule); padding:.25em .4em; word-break:break-word; text-align:left }
.imgmissing{ border:1px dashed var(--rubric); color:var(--faint); font-size:8.5pt; padding:1em; text-align:center; margin:.9em 0 }
.tweet-print{ margin:.9em 1.2em; font-size:9.8pt } .tweet-print .tweet-by{ text-indent:0; font-size:8.5pt; color:var(--faint); margin-top:.2em }
.latex-print{ text-align:center; text-indent:0; font-size:9.5pt }
.embedcard{ border:1px solid var(--rule); border-left:3px solid var(--rubric); padding:.6em .8em;
  font-size:8.5pt; color:var(--faint); margin:.9em 0; word-break:break-all }

.article{ page: chapter; break-before:page }
.arthead{ margin:0 0 1.1em; padding-top:.55in }
.artnum{ font-size:30pt; color:var(--rubric); font-variant-numeric:oldstyle-nums; line-height:1 }
.arttitle{ font-size:17pt; margin:.25em 0 0; string-set: arttitle content(text); font-family:var(--headfont), "Source Serif 4", serif; font-weight:var(--headweight) }
.artsub{ font-size:10.5pt; color:var(--faint); font-style:italic; margin:.4em 0 0; text-indent:0; text-align:left }
.artmeta{ font-size:8pt; letter-spacing:.14em; text-transform:uppercase; color:var(--faint);
  margin-top:.7em; border-bottom:1px solid var(--rule); padding-bottom:.7em }
.artbody p.opener{ text-indent:0 }
.artbody p.opener::first-letter{ color:var(--rubric); font-size:3.1em; float:left;
  line-height:.82; padding-right:.08em; font-weight:560 }
`;
}
