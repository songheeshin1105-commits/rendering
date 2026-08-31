import puppeteer from "puppeteer";
import path from "node:path";
import fs from "node:fs/promises";

const CONTENT_WIDTH = 500; // 상세페이지 디자인 기준 폭
const TARGET_WIDTH = 860; // 스마트스토어 권장 폭
const SCALE = TARGET_WIDTH / CONTENT_WIDTH;
const MAX_SECTION_HEIGHT = 2000; // 섹션당 최대 세로 (스마트스토어 실제 출력 기준, 원본 CSS px)

const htmlPath = process.argv[2];
if (!htmlPath) {
  console.error("사용법: node scripts/convert-to-images.mjs output/[상품명].html");
  process.exit(1);
}

const absHtmlPath = path.resolve(htmlPath);
const baseName = path.basename(htmlPath, ".html");
const outDir = path.join(path.dirname(absHtmlPath), `${baseName}-images`);
await fs.mkdir(outDir, { recursive: true });

const browser = await puppeteer.launch();
const page = await browser.newPage();
await page.setViewport({ width: CONTENT_WIDTH, height: 800, deviceScaleFactor: SCALE });
await page.goto(`file://${absHtmlPath}`, { waitUntil: "networkidle0" });

// 전체 한 장
await page.screenshot({ path: path.join(outDir, "full.jpg"), type: "jpeg", quality: 90, fullPage: true });

// 섹션별 분할 — 최상위 래퍼(max-width:500px) 바로 아래 자식 div 기준으로 자른다
const sections = await page.evaluate(() => {
  const wrapper = document.body.querySelector(":scope > div");
  return Array.from(wrapper.children).map((el) => {
    const r = el.getBoundingClientRect();
    return { top: r.top + window.scrollY, height: r.height };
  });
});

let idx = 1;
for (const section of sections) {
  if (section.height <= 0) continue;
  let offset = 0;
  while (offset < section.height) {
    const sliceHeight = Math.min(MAX_SECTION_HEIGHT, section.height - offset);
    const fileName = `section-${String(idx).padStart(2, "0")}.jpg`;
    await page.screenshot({
      path: path.join(outDir, fileName),
      type: "jpeg",
      quality: 90,
      clip: { x: 0, y: section.top + offset, width: CONTENT_WIDTH, height: sliceHeight },
    });
    idx += 1;
    offset += sliceHeight;
  }
}

await browser.close();
console.log(`완료: ${outDir} (full.jpg + section-01~${String(idx - 1).padStart(2, "0")}.jpg)`);
