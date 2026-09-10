import puppeteer from "puppeteer";
import path from "node:path";
import fs from "node:fs/promises";

// 3번째 인자: 렌더 폭(CSS px). 없으면 모바일 500px.
// 4번째 인자: 해상도 배율. 없으면 폭 지정 시 2배, 미지정 시 1.72배(860/500). 글자 뭉개짐 방지용 supersampling.
const CONTENT_WIDTH = Number(process.argv[3]) || 500;
const SCALE = Number(process.argv[4]) || (process.argv[3] ? 2 : 860 / 500);
const TARGET_WIDTH = Math.round(CONTENT_WIDTH * SCALE); // 실제 출력 이미지 가로 픽셀
const MAX_SECTION_HEIGHT = 2000; // 섹션당 최대 세로 (원본 CSS px 기준)

const htmlPath = process.argv[2];
if (!htmlPath) {
  console.error("사용법: node scripts/convert-to-images.mjs output/[상품명].html [렌더폭]");
  process.exit(1);
}

const absHtmlPath = path.resolve(htmlPath);
const baseName = path.basename(htmlPath, ".html");
const outDir = path.join(path.dirname(absHtmlPath), `${baseName}-images`);
await fs.rm(outDir, { recursive: true, force: true });
await fs.mkdir(outDir, { recursive: true });

const browser = await puppeteer.launch({ args: ["--no-sandbox"] });
const page = await browser.newPage();
await page.setViewport({ width: CONTENT_WIDTH, height: 900, deviceScaleFactor: SCALE });
await page.goto(`file://${absHtmlPath}`, { waitUntil: "networkidle0" });

// 상세페이지 이미지에는 사이트 네비게이션바/푸터를 뺀다
await page.addStyleTag({ content: "header{display:none!important} footer{display:none!important}" });
await page.evaluate(() => document.fonts && document.fonts.ready);
await new Promise((r) => setTimeout(r, 400));

// 전체 한 장
await page.screenshot({ path: path.join(outDir, "full.jpg"), type: "jpeg", quality: 90, fullPage: true });

// 콘텐츠 블록 기준으로 분할 — .page 래퍼가 있으면 그 자식, 없으면 body 자식
// .pair(사진 2장 나란히)만 각 사진을 독립 파일로 쪼갠다 (나중에 사이에 GIF 등을 끼워넣을 수 있도록).
// 그 외 영역은 원래 섹션 통째로 캡처해서, 섹션 사이 padding/margin 여백이 그대로 유지되게 한다.
const sections = await page.evaluate((CONTENT_WIDTH) => {
  const root = document.querySelector(".page") || document.body;
  const skipTag = new Set(["HEADER", "FOOTER", "SCRIPT", "STYLE"]);
  const isSkippable = (el) =>
    skipTag.has(el.tagName) || el.classList.contains("logo") || el.getBoundingClientRect().height <= 4;

  const topSections = Array.from(root.children).filter((el) => !isSkippable(el));
  const pieces = [];

  for (const sec of topSections) {
    const secRect = sec.getBoundingClientRect();
    const secTop = secRect.top + window.scrollY;
    const secBottom = secTop + secRect.height;

    const pairs = Array.from(sec.querySelectorAll(".pair"))
      .map((el) => el.getBoundingClientRect())
      .sort((a, b) => a.top - b.top);

    let cursor = secTop;
    for (const pr of pairs) {
      const pairTop = pr.top + window.scrollY;
      const pairBottom = pairTop + pr.height;
      if (pairTop > cursor) {
        pieces.push({ top: cursor, height: pairTop - cursor, left: 0, width: CONTENT_WIDTH });
      }
      cursor = Math.max(cursor, pairBottom);
    }
    if (cursor < secBottom) {
      pieces.push({ top: cursor, height: secBottom - cursor, left: 0, width: CONTENT_WIDTH });
    }
  }

  // .pair의 두 사진은 나란히 배치라 실제 위치·폭으로 따로 캡처해야 한다 — 위치 순서대로 pieces에 끼워넣는다
  const pairFigures = Array.from(document.querySelectorAll(".pair")).flatMap((pair) =>
    Array.from(pair.children)
      .filter((c) => !isSkippable(c))
      .map((fig) => {
        const r = fig.getBoundingClientRect();
        return { top: r.top + window.scrollY, height: r.height, left: r.left, width: r.width };
      })
  );

  return [...pieces, ...pairFigures].sort((a, b) => a.top - b.top);
}, CONTENT_WIDTH);

let idx = 1;
for (const section of sections) {
  let offset = 0;
  while (offset < section.height) {
    const sliceHeight = Math.min(MAX_SECTION_HEIGHT, section.height - offset);
    await page.screenshot({
      path: path.join(outDir, `section-${String(idx).padStart(2, "0")}.jpg`),
      type: "jpeg",
      quality: 90,
      clip: { x: section.left, y: section.top + offset, width: section.width, height: sliceHeight },
    });
    idx += 1;
    offset += sliceHeight;
  }
}

await browser.close();
console.log(`완료: ${outDir} (full.jpg + section-01~${String(idx - 1).padStart(2, "0")}.jpg, 가로 ${TARGET_WIDTH}px)`);
