// 포트폴리오 갱신 장치
// input/ 폴더의 기록 파일을 읽어 숫자 칸과 능력별 문단 후보를 다시 만든다.
// AI 호출, 현재 시각, 난수를 쓰지 않는다. 같은 입력이면 같은 결과가 나온다.
//
// 사용법: node engine/run.mjs [--site <index.html 경로>]

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ENGINE_DIR = path.dirname(fileURLToPath(import.meta.url));
const INPUT_DIR = path.join(ENGINE_DIR, "input");
const OUTPUT_DIR = path.join(ENGINE_DIR, "output");

const argv = process.argv.slice(2);
const siteArgIndex = argv.indexOf("--site");
const SITE_FILE = siteArgIndex >= 0
  ? path.resolve(argv[siteArgIndex + 1])
  : path.join(ENGINE_DIR, "..", "site", "index.html");

// ---------- 공통 ----------

function readText(file) {
  return fs.readFileSync(file, "utf8").replace(/^﻿/, "").replace(/\r\n/g, "\n");
}

function readJson(file, fallback) {
  return fs.existsSync(file) ? JSON.parse(readText(file)) : fallback;
}

function writeText(file, text) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text, "utf8");
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

// 이름 가리기 도구가 이름과 같은 글자까지 가린 곳을 되돌린다. (예: "부(이름 가림)" → "부분")
function repairMasking(s) {
  return s.replace(/부\(이름 가림\)/g, "부분");
}

function dayDiff(a, b) {
  return Math.round((Date.parse(b + "T00:00:00Z") - Date.parse(a + "T00:00:00Z")) / 86400000);
}

function formatDot(date) {
  return date.replace(/-/g, ".");
}

// 따옴표와 쉼표를 지원하는 최소한의 CSV 읽기
function parseCsv(text) {
  const rows = [];
  let row = [], field = "", quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') { field += '"'; i++; }
      else if (c === '"') quoted = false;
      else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ",") { row.push(field); field = ""; }
    else if (c === "\n") { row.push(field); rows.push(row); row = []; field = ""; }
    else field += c;
  }
  if (field !== "" || row.length) { row.push(field); rows.push(row); }
  const [header, ...body] = rows.filter((r) => r.some((v) => v.trim() !== ""));
  if (!header) return [];
  return body.map((r) => Object.fromEntries(header.map((h, i) => [h.trim(), (r[i] ?? "").trim()])));
}

// ---------- 입력 읽기 ----------

function findRitualFile() {
  const files = fs.readdirSync(INPUT_DIR).filter((f) => /^ritual-history-.*\.txt$/.test(f)).sort();
  if (files.length === 0) throw new Error("input/에 ritual-history-*.txt 파일이 없습니다.");
  return path.join(INPUT_DIR, files[files.length - 1]); // 이름순으로 가장 마지막(최신) 파일
}

function parseRitual(text) {
  const days = [];
  let day = null, part = null;
  for (const raw of text.split("\n")) {
    const line = raw.trim();
    const dateMatch = line.match(/^## (\d{4}-\d{2}-\d{2})$/);
    if (dateMatch) { day = { date: dateMatch[1], morning: {}, closing: {} }; days.push(day); part = null; continue; }
    if (!day) continue;
    if (line === "[아침]") { part = day.morning; continue; }
    if (line === "[마무리]") { part = day.closing; continue; }
    const kv = line.match(/^- ([^:]+):\s*(.*)$/);
    if (kv && part) {
      const key = kv[1].trim(), value = repairMasking(kv[2].trim());
      if (key in part) part[key] = [].concat(part[key], value);
      else part[key] = value;
    }
  }
  return days.sort((a, b) => a.date.localeCompare(b.date));
}

function asList(v) {
  return v === undefined ? [] : [].concat(v).filter((x) => x !== "");
}

// ---------- 숫자 칸 ----------

function buildNumbers(config, days, attendance, submissions) {
  const refDate = days[days.length - 1].date; // 기준일은 기록의 마지막 날짜 (실행 날짜가 아님)
  const start = config.course.start;
  const weeksElapsed = Math.floor(dayDiff(start, refDate) / 7) + 1;
  const weeksWithRecord = new Set(days.map((d) => Math.floor(dayDiff(start, d.date) / 7))).size;

  const outcomes = { "실천했다": 0, "일부 실천했다": 0, "못 했다": 0 };
  for (const d of days) {
    const o = d.closing["강점 행동"];
    if (o in outcomes) outcomes[o]++;
  }
  const closedDays = days.filter((d) => d.closing["강점 행동"]);

  // "못 했다" 다음 마무리 기록에서 다시 실천(일부 포함)으로 돌아온 횟수
  let missed = 0, recovered = 0;
  closedDays.forEach((d, i) => {
    if (d.closing["강점 행동"] !== "못 했다") return;
    const next = closedDays[i + 1];
    if (!next) return;
    missed++;
    if (next.closing["강점 행동"] !== "못 했다") recovered++;
  });

  const peerSays = days.reduce((n, d) =>
    n + Object.keys(d.morning).filter((k) => /^동료 \d+가 말해 준 내 장점$/.test(k) && asList(d.morning[k]).length).length, 0);

  const ritualSrc = "리추얼 기록";
  const numbers = [
    {
      id: "record-weeks", source: ritualSrc,
      value: `${weeksWithRecord}`, unit: `/ ${weeksElapsed}주`,
      label: `지금까지 지난 ${weeksElapsed}주 가운데 리추얼을 기록한 주`,
      note: `${start} ~ ${refDate}, 과정 전체 ${config.course.totalWeeks}주`,
    },
    {
      id: "record-days", source: ritualSrc,
      value: `${days.length}`, unit: "일",
      label: "아침 또는 마무리 리추얼을 남긴 날",
      note: `마무리까지 남긴 날 ${closedDays.length}일`,
    },
    {
      id: "closing-outcomes", source: ritualSrc,
      value: `${outcomes["실천했다"]}`, unit: `/ ${closedDays.length}일`,
      label: "마무리에서 그날 정한 행동을 “실천했다”고 적은 날",
      note: `일부 실천 ${outcomes["일부 실천했다"]}일, 못 했다 ${outcomes["못 했다"]}일`,
    },
    {
      id: "recovery", source: ritualSrc,
      value: `${recovered}`, unit: `/ ${missed}번`,
      label: "“못 했다” 다음 기록에서 다시 실천(일부 포함)으로 돌아온 횟수",
      note: "이야기의 2026.08.26 → 08.27 장면이 이 숫자의 첫 번째 사례입니다.",
      pairedWithStory: true,
    },
    {
      id: "peer-says", source: ritualSrc,
      value: `${peerSays}`, unit: "개",
      label: "동료가 말해 준 내 장점 문장",
      note: "강점 카드의 동료 발언은 여기서 골랐습니다.",
    },
  ];

  if (attendance.length) {
    const present = attendance.filter((r) => ["출석", "지각", "조퇴"].includes(r.status)).length;
    numbers.push({
      id: "attendance", source: "내 출석 기록",
      value: `${present}`, unit: `/ ${attendance.length}일`, label: "출석한 수업일 (지각·조퇴 포함)",
      note: `지각 ${attendance.filter((r) => r.status === "지각").length}일, 결석 ${attendance.filter((r) => r.status === "결석").length}일`,
    });
  } else {
    numbers.push({ id: "attendance", source: "내 출석 기록", pending: true, value: "집계 중", unit: "",
      label: "출석한 수업일", note: `과정 종료(${config.course.end}) 후 기록을 넣고 다시 실행합니다. 기준일 ${refDate}` });
  }

  if (submissions.length) {
    const done = submissions.filter((r) => ["제출", "통과"].includes(r.status)).length;
    numbers.push({
      id: "submissions", source: "내 제출 현황",
      value: `${done}`, unit: `/ ${submissions.length}개`, label: "제출한 과제",
      note: `통과 ${submissions.filter((r) => r.status === "통과").length}개`,
    });
  } else {
    numbers.push({ id: "submissions", source: "내 제출 현황", pending: true, value: "집계 중", unit: "",
      label: "제출한 과제", note: `제출 현황 파일을 넣고 다시 실행합니다. 기준일 ${refDate}` });
  }

  return { refDate, numbers };
}

function renderNumbersHtml({ refDate, numbers }) {
  const items = numbers.map((n) => `        <div class="num${n.pending ? " pending" : ""}">
          <div class="v">${escapeHtml(n.value)}${n.unit ? `<small>${escapeHtml(n.unit)}</small>` : ""}</div>
          <div class="k">${escapeHtml(n.label)}</div>
          <div class="s">출처: ${escapeHtml(n.source)} · ${escapeHtml(n.note)}</div>
        </div>`).join("\n");
  const paired = numbers.find((n) => n.pairedWithStory);
  return `      <div class="nums">
${items}
      </div>
      <div class="pair">
        <div class="label" style="color: var(--color-accent-300)">이야기와 짝지은 숫자</div>
        <p class="small" style="color: var(--color-bg)">2026년 8월 26일의 &ldquo;못 했다&rdquo;는 한 번으로 끝나지 않았습니다. 지금까지 &ldquo;못 했다&rdquo;를 적은 ${escapeHtml(paired.unit.replace(/[^0-9]/g, ""))}번 가운데 ${escapeHtml(paired.value)}번은 바로 다음 기록에서 다시 실천으로 돌아왔습니다. (출처: ${escapeHtml(paired.source)})</p>
      </div>
      <p class="small" style="margin-top: 20px; color: var(--color-accent-300)">기준일 ${formatDot(refDate)} · engine/run.mjs로 생성</p>`;
}

// ---------- 능력별 문단 후보 ----------

const ABILITIES = {
  SR: "자기조절력",
  IR: "대인관계력",
  SM: "자기동기력",
};

const IR_KEYWORDS = /도와|도움|설명|알려|공유|페이스|배려|피드백|위로|응원|챙겨|총대|조율|합의/;
const SM_KEYWORDS = /자격증|cbt|CBT|기출|워게임|드림핵|혼자|스스로|남아서|보충|책|문제/;

function buildCandidates(days) {
  const out = [];
  const closedDays = days.filter((d) => d.closing["강점 행동"]);

  // 자기조절력: "못 했다" 다음 기록에서 돌아온 장면
  closedDays.forEach((d, i) => {
    if (d.closing["강점 행동"] !== "못 했다") return;
    const next = closedDays[i + 1];
    if (!next || next.closing["강점 행동"] === "못 했다") return;
    const note = asList(d.closing["나에게 남기는 말"])[0] ?? "";
    out.push({
      id: `SR-${d.date}`, ability: "SR", date: d.date,
      text: `${formatDot(d.date)}에 “못 했다”고 적고 “${note}”라고 남겼다. 다음 기록인 ${formatDot(next.date)}에는 “${next.closing["강점 행동"]}”로 돌아왔다.`,
      evidence: `리추얼 기록 ${d.date} 마무리, ${next.date} 마무리`,
    });
  });

  for (const d of days) {
    // 대인관계력: 동료가 말해 준 내 장점 가운데 함께 일한 장면
    Object.keys(d.morning)
      .filter((k) => /^동료 \d+가 말해 준 내 장점$/.test(k))
      .sort()
      .forEach((k) => {
        const said = asList(d.morning[k])[0];
        if (!said || !IR_KEYWORDS.test(said)) return;
        const n = k.match(/\d+/)[0];
        out.push({
          id: `IR-${d.date}-P${n}`, ability: "IR", date: d.date,
          text: `${formatDot(d.date)}, 동료는 “${said}”라고 말해 주었다.`,
          evidence: `리추얼 기록 ${d.date} 아침, 동료 ${n}가 말해 준 내 장점`,
        });
      });

    // 자기동기력: 스스로 정해서 이어 간 공부와 시도
    const episode = asList(d.morning["강점이 드러난 일화"])[0];
    if (episode && SM_KEYWORDS.test(episode)) {
      out.push({
        id: `SM-${d.date}-E`, ability: "SM", date: d.date,
        text: `${formatDot(d.date)} 기록: “${episode}”`,
        evidence: `리추얼 기록 ${d.date} 아침, 강점이 드러난 일화`,
      });
    }
    const effort = asList(d.closing["강점을 위해 노력하고 생각한 것"])[0];
    if (effort && SM_KEYWORDS.test(effort) && d.closing["강점 행동"] !== "못 했다") {
      out.push({
        id: `SM-${d.date}-C`, ability: "SM", date: d.date,
        text: `${formatDot(d.date)} 마무리: “${effort}”`,
        evidence: `리추얼 기록 ${d.date} 마무리, 강점을 위해 노력하고 생각한 것`,
      });
    }
  }

  const order = Object.keys(ABILITIES);
  return out.sort((a, b) => order.indexOf(a.ability) - order.indexOf(b.ability) || a.id.localeCompare(b.id));
}

function renderCandidatesMd(candidates, approvedIds, refDate) {
  const lines = [
    "# 능력별 문단 후보",
    "",
    `기준일: ${refDate}. 사이트에 넣을 후보의 ID를 \`input/approved.json\`의 \`approved\` 배열에 적고 다시 실행합니다.`,
    "",
  ];
  for (const [code, name] of Object.entries(ABILITIES)) {
    const list = candidates.filter((c) => c.ability === code);
    lines.push(`## ${name} (${list.length}개)`, "");
    for (const c of list) {
      lines.push(`- [${approvedIds.has(c.id) ? "x" : " "}] \`${c.id}\` ${c.text}`, `  - 근거: ${c.evidence}`);
    }
    lines.push("");
  }
  return lines.join("\n");
}

function renderApprovedHtml(candidates, approvedIds) {
  const chosen = candidates.filter((c) => approvedIds.has(c.id));
  if (chosen.length === 0) return `      <!-- 승인된 후보가 없습니다. -->`;
  const groups = Object.entries(ABILITIES)
    .map(([code, name]) => [name, chosen.filter((c) => c.ability === code)])
    .filter(([, list]) => list.length);
  return `      <div style="margin-top: 48px; border-top: 1px solid var(--color-divider); padding-top: 28px">
        <div class="label">기록에서 더 찾은 장면 (본인 승인)</div>
${groups.map(([name, list]) => `        <div class="split" style="padding: 14px 0">
          <div style="font-family: var(--font-heading); font-weight: 600; font-size: 17px">${escapeHtml(name)}</div>
          <div>
${list.map((c) => `            <p class="small" style="margin-bottom: 8px">${escapeHtml(c.text)} <span class="muted">(${escapeHtml(c.evidence)})</span></p>`).join("\n")}
          </div>
        </div>`).join("\n")}
      </div>`;
}

// ---------- 사이트 반영 ----------

function replaceBlock(html, name, inner) {
  const re = new RegExp(`(<!-- engine:${name}:start -->)[\\s\\S]*?(<!-- engine:${name}:end -->)`);
  if (!re.test(html)) throw new Error(`사이트 파일에 engine:${name} 표시가 없습니다.`);
  return html.replace(re, (_, a, b) => `${a}\n${inner}\n${b}`);
}

// ---------- 실행 ----------

const config = readJson(path.join(INPUT_DIR, "config.json"), null);
if (!config) throw new Error("input/config.json이 없습니다.");

const ritualFile = findRitualFile();
const days = parseRitual(readText(ritualFile));
const attendanceFile = path.join(INPUT_DIR, "attendance.csv");
const submissionsFile = path.join(INPUT_DIR, "submissions.csv");
const attendance = fs.existsSync(attendanceFile) ? parseCsv(readText(attendanceFile)) : [];
const submissions = fs.existsSync(submissionsFile) ? parseCsv(readText(submissionsFile)) : [];
const approvedIds = new Set(readJson(path.join(INPUT_DIR, "approved.json"), { approved: [] }).approved);

const numbers = buildNumbers(config, days, attendance, submissions);
const candidates = buildCandidates(days);
const unknown = [...approvedIds].filter((id) => !candidates.some((c) => c.id === id));

const numbersHtml = renderNumbersHtml(numbers);
const approvedHtml = renderApprovedHtml(candidates, approvedIds);

writeText(path.join(OUTPUT_DIR, "numbers.json"), JSON.stringify(numbers, null, 2) + "\n");
writeText(path.join(OUTPUT_DIR, "candidates.json"), JSON.stringify(candidates, null, 2) + "\n");
writeText(path.join(OUTPUT_DIR, "candidates.md"), renderCandidatesMd(candidates, approvedIds, numbers.refDate) + "\n");
writeText(path.join(OUTPUT_DIR, "site-numbers.html"), numbersHtml + "\n");
writeText(path.join(OUTPUT_DIR, "site-approved.html"), approvedHtml + "\n");

let siteNote = "사이트 파일이 없어 output/의 site-*.html만 만들었습니다.";
if (fs.existsSync(SITE_FILE)) {
  let html = readText(SITE_FILE);
  html = replaceBlock(html, "numbers", numbersHtml);
  html = replaceBlock(html, "approved", approvedHtml);
  writeText(SITE_FILE, html);
  siteNote = `사이트 반영: ${path.relative(process.cwd(), SITE_FILE) || SITE_FILE}`;
}

console.log(`리추얼 기록: ${path.basename(ritualFile)} (${days.length}일, 기준일 ${numbers.refDate})`);
console.log(`숫자 칸: ${numbers.numbers.length}개 (집계 중 ${numbers.numbers.filter((n) => n.pending).length}개)`);
console.log(`후보: ${candidates.length}개, 승인: ${approvedIds.size - unknown.length}개`);
if (unknown.length) console.log(`경고: 후보에 없는 승인 ID ${unknown.join(", ")}`);
console.log(siteNote);
