// docs/*.md → site/index.html 안의 세부 문서, site/files/*.docx·*.md, docs/*.docx
// site/files/thesis.md는 원문 그대로 둔다(논문은 site/index.html 안의 문서로 표시)
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
  { file: "이력서.md", id: "resume", slug: "resume", title: "이력서" },
  { file: "자기소개서.md", id: "cover", slug: "cover-letter", title: "자기소개서" },
  { file: "경력기술서.md", id: "career", slug: "career", title: "경력기술서" },
];

const read = (p) => fs.readFileSync(p, "utf8").replace(/^﻿/, "").replace(/\r\n/g, "\n");

// ---------- HTML ----------
// site/index.html의 <!-- docs:start --> ~ <!-- docs:end --> 사이를 세부 문서(.md) 3개로 바꾼다.

function mdToHtml(md) {
  return marked.parse(md.replace(/^# .*\n+/, ""), { gfm: true })
    .replace(/<h([23])>/g, (_, n) => `<h${n}><span class="md">${"#".repeat(n)}</span>`)
    .replace(/<table>/g, '<div class="table-wrap"><table>')
    .replace(/<\/table>/g, "</table></div>")
    .trim();
}

function article(d, md) {
  const dl = `<a href="files/${d.slug}.docx" download>.docx</a> · <a href="files/${d.slug}.md">원문 .md</a>`;
  return `<article data-id="${d.id}" data-kind="md" data-title="${d.title}.md" data-path="~/portfolio/자격증·이력/${d.title}.md" data-parent="record">
  <h1><span class="md">#</span>${d.title}</h1>
  <div class="fm"><span class="dl">---</span><br />
    <span class="key">내려받기</span>: <span class="val">${dl}</span><br />
    <span class="dl">---</span></div>
${mdToHtml(md)}
  <div class="nav2"><button type="button" data-open="record">← 자격증·이력</button><a href="files/${d.slug}.docx" download>.docx 내려받기</a></div>
</article>`;
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

const articles = [];
for (const d of DOC_LIST) {
  const md = read(path.join(DOCS, d.file));
  const base = path.basename(d.file, ".md");
  await writeDocx(md, path.join(DOCS, `${base}.docx`));
  fs.copyFileSync(path.join(DOCS, `${base}.docx`), path.join(FILES, `${d.slug}.docx`));
  fs.copyFileSync(path.join(DOCS, d.file), path.join(FILES, `${d.slug}.md`));
  articles.push(article(d, md));
}

const INDEX = path.join(SITE, "index.html");
const START = "<!-- docs:start -->", END = "<!-- docs:end -->";
const index = fs.readFileSync(INDEX, "utf8");
const i0 = index.indexOf(START), i1 = index.indexOf(END);
if (i0 < 0 || i1 < i0) throw new Error("site/index.html에 " + START + " / " + END + " 표시가 없습니다.");
fs.writeFileSync(INDEX, index.slice(0, i0 + START.length) + "\n" + articles.join("\n\n") + "\n" + index.slice(i1));

// 논문은 site/index.html 안의 문서(T10-논문.md)로 옮겼으므로 thesis.html은 더 만들지 않는다.

console.log("만든 파일: site/index.html(이력 문서 3개), docs/*.docx, site/files/*");
