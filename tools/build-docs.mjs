// docs/*.md → site/resume.html, site/files/*.docx, docs/*.docx
// site/files/thesis.md → site/thesis.html
// 사용법: cd tools && npm install && npm run build

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { marked } from "marked";
import {
  Document, Packer, Paragraph, TextRun, HeadingLevel, Table, TableRow, TableCell,
  WidthType, BorderStyle, ExternalHyperlink,
} from "docx";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const DOCS = path.join(ROOT, "docs");
const SITE = path.join(ROOT, "site");
const FILES = path.join(SITE, "files");

const DOC_LIST = [
  { file: "이력서.md", slug: "resume", title: "이력서" },
  { file: "자기소개서.md", slug: "cover-letter", title: "자기소개서" },
  { file: "경력기술서.md", slug: "career", title: "경력기술서" },
];

const read = (p) => fs.readFileSync(p, "utf8").replace(/^﻿/, "").replace(/\r\n/g, "\n");

// ---------- HTML ----------

const PAGE_STYLE = `
    body { margin: 0; background: var(--color-bg); color: var(--color-text); font-family: var(--font-body); }
    a { color: var(--color-accent-700); }
    .bar { position: sticky; top: 0; z-index: 5; display: flex; flex-wrap: wrap; gap: 8px 24px; align-items: baseline; padding: 18px 28px; background: color-mix(in srgb, var(--color-bg) 90%, transparent); backdrop-filter: blur(8px); border-bottom: 1px solid var(--color-divider); }
    .bar a { color: var(--color-text); text-decoration: none; font-size: 13px; }
    .bar .home { font-family: var(--font-heading); font-weight: 600; font-size: 18px; margin-right: auto; }
    main { max-width: 920px; margin: 0 auto; padding: 48px 16px 96px; }
    .doc { padding: 40px 0; border-top: 1px solid var(--color-divider); }
    .doc:first-of-type { border-top: none; }
    .md h1 { font-size: clamp(28px, 4vw, 40px); margin: 0 0 16px; }
    .md h2 { font-size: 22px; margin: 36px 0 12px; }
    .md h3 { font-size: 18px; margin: 28px 0 10px; }
    .md p, .md li { font-size: 15px; line-height: 1.9; color: var(--color-neutral-800); word-break: keep-all; }
    .md blockquote { margin: 16px 0; padding: 4px 16px; border-left: 3px solid var(--color-accent); color: var(--color-neutral-700); }
    .md code { font-size: 0.92em; background: var(--color-surface); padding: 1px 5px; border-radius: 3px; }
    .md pre { overflow-x: auto; background: var(--color-surface); padding: 12px; }
    .md .table-wrap { overflow-x: auto; margin: 16px 0; }
    .md table { border-collapse: collapse; width: 100%; font-size: 13px; line-height: 1.7; }
    .md th, .md td { border: 1px solid var(--color-divider); padding: 8px 10px; text-align: left; vertical-align: top; word-break: keep-all; }
    .md th { background: var(--color-surface); white-space: nowrap; }
    .downloads { display: flex; flex-wrap: wrap; gap: 8px 16px; margin: 0 0 8px; font-size: 13px; }
    .note { font-size: 13px; color: var(--color-neutral-600); line-height: 1.8; }`;

function mdToHtml(md) {
  return marked.parse(md, { gfm: true })
    .replace(/<table>/g, '<div class="table-wrap"><table>')
    .replace(/<\/table>/g, "</table></div>");
}

function page(title, description, body) {
  return `<!DOCTYPE html>
<html lang="ko">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <meta name="description" content="${description}" />
  <title>${title}</title>
  <link rel="stylesheet" href="industry.css" />
  <style>${PAGE_STYLE}
  </style>
</head>
<body>
  <nav class="bar">
    <a href="index.html" class="home">← 하태형 포트폴리오</a>
${body.nav}
  </nav>
  <main>
${body.main}
  </main>
</body>
</html>
`;
}

// ---------- DOCX ----------

function inlineRuns(tokens, style = {}) {
  const runs = [];
  for (const t of tokens ?? []) {
    if (t.type === "strong") runs.push(...inlineRuns(t.tokens, { ...style, bold: true }));
    else if (t.type === "em") runs.push(...inlineRuns(t.tokens, { ...style, italics: true }));
    else if (t.type === "link") {
      runs.push(new ExternalHyperlink({ link: t.href, children: [new TextRun({ text: t.text, style: "Hyperlink", ...style })] }));
    } else if (t.type === "codespan") runs.push(new TextRun({ text: t.text, font: "Consolas", ...style }));
    else if (t.type === "br") runs.push(new TextRun({ text: "", break: 1 }));
    else if (t.tokens) runs.push(...inlineRuns(t.tokens, style));
    else runs.push(new TextRun({ text: decode(t.text ?? t.raw ?? ""), ...style }));
  }
  return runs;
}

function decode(s) {
  return s.replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");
}

const cellBorder = { style: BorderStyle.SINGLE, size: 4, color: "B7B7BA" };

function mdToDocxChildren(md) {
  const out = [];
  for (const tok of marked.lexer(md, { gfm: true })) {
    if (tok.type === "heading") {
      const level = [HeadingLevel.HEADING_1, HeadingLevel.HEADING_2, HeadingLevel.HEADING_3][tok.depth - 1] ?? HeadingLevel.HEADING_3;
      out.push(new Paragraph({ heading: level, children: inlineRuns(tok.tokens), spacing: { before: 240, after: 120 } }));
    } else if (tok.type === "paragraph") {
      out.push(new Paragraph({ children: inlineRuns(tok.tokens), spacing: { after: 160, line: 360 } }));
    } else if (tok.type === "list") {
      for (const item of tok.items) {
        out.push(new Paragraph({ bullet: { level: 0 }, children: inlineRuns(item.tokens[0]?.tokens ?? item.tokens), spacing: { after: 80 } }));
      }
    } else if (tok.type === "table") {
      const row = (cells, header) => new TableRow({
        tableHeader: header,
        children: cells.map((c) => new TableCell({
          borders: { top: cellBorder, bottom: cellBorder, left: cellBorder, right: cellBorder },
          shading: header ? { fill: "E9E9EA" } : undefined,
          margins: { top: 60, bottom: 60, left: 80, right: 80 },
          children: [new Paragraph({ children: inlineRuns(c.tokens, header ? { bold: true } : {}) })],
        })),
      });
      out.push(new Table({
        width: { size: 100, type: WidthType.PERCENTAGE },
        rows: [row(tok.header, true), ...tok.rows.map((r) => row(r, false))],
      }));
      out.push(new Paragraph({ text: "" }));
    }
  }
  return out;
}

async function writeDocx(md, file) {
  const doc = new Document({
    creator: "하태형",
    title: path.basename(file, ".docx"),
    styles: { default: { document: { run: { font: "맑은 고딕", size: 21 } } } },
    sections: [{ children: mdToDocxChildren(md) }],
  });
  fs.writeFileSync(file, await Packer.toBuffer(doc));
}

// ---------- 실행 ----------

fs.mkdirSync(FILES, { recursive: true });

const sections = [];
for (const d of DOC_LIST) {
  const md = read(path.join(DOCS, d.file));
  const base = path.basename(d.file, ".md");
  await writeDocx(md, path.join(DOCS, `${base}.docx`));
  fs.copyFileSync(path.join(DOCS, `${base}.docx`), path.join(FILES, `${d.slug}.docx`));
  fs.copyFileSync(path.join(DOCS, d.file), path.join(FILES, `${d.slug}.md`));
  sections.push(`    <section class="doc md" id="${d.slug}">
      <p class="downloads"><a href="files/${d.slug}.docx" download>${d.title} .docx 내려받기</a><a href="files/${d.slug}.md">원문 .md</a></p>
${mdToHtml(md)}
    </section>`);
}

fs.writeFileSync(path.join(SITE, "resume.html"), page(
  "이력서 · 하태형",
  "하태형의 이력서, 자기소개서, 경력기술서",
  {
    nav: DOC_LIST.map((d) => `    <a href="#${d.slug}">${d.title}</a>`).join("\n"),
    main: sections.join("\n"),
  },
));

const thesisMd = read(path.join(FILES, "thesis.md"));
fs.writeFileSync(path.join(SITE, "thesis.html"), page(
  "논문 · 하태형",
  "미로형 3D 공간에서 고정 청각 랜드마크의 개수가 길찾기에 미치는 영향",
  {
    nav: `    <a href="files/thesis.md">원문 .md</a>\n    <a href="https://github.com/HTH-0/aleph_thesis" target="_blank" rel="noreferrer">소스 · 원자료 GitHub ↗</a>`,
    main: `    <p class="note">T10 논문 전문입니다. 본문에 나오는 <code>sim/</code>, <code>analysis/</code>, <code>docs/</code> 경로는 <a href="https://github.com/HTH-0/aleph_thesis" target="_blank" rel="noreferrer">aleph_thesis 저장소</a>에 있습니다.</p>
    <article class="md">
${mdToHtml(thesisMd)}
    </article>`,
  },
));

console.log("만든 파일: site/resume.html, site/thesis.html, docs/*.docx, site/files/*");
