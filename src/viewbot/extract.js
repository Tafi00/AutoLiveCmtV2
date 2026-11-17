// Ghi bộ file agent từ files.json ra đĩa (không dùng node -e để tránh lỗi quote).
// Chạy: node extract.js [files.json]
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";

const bundlePath = process.argv[2] || "files.json";
const bundle = JSON.parse(readFileSync(bundlePath, "utf8"));
const files = bundle?.files || {};
let count = 0;
for (const [filePath, content] of Object.entries(files)) {
  const target = join(process.cwd(), filePath);
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, content);
  count += 1;
}
console.log(`[hub] đã ghi ${count} file`);
