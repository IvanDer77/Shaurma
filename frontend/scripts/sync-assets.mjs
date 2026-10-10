// Копирует в public/ отчёт валидации метода ШАУРМА, графики «Маринада» и брендбук с логотипами.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const pub = path.resolve(root, "frontend/public");
const copyDir = (from, to, filter = () => true) => {
  if (!fs.existsSync(from)) return console.warn(`skip: ${from}`);
  fs.mkdirSync(to, { recursive: true });
  for (const f of fs.readdirSync(from)) {
    const src = path.join(from, f);
    if (fs.statSync(src).isFile() && filter(f)) fs.copyFileSync(src, path.join(to, f));
  }
};
copyDir(path.join(root, "docs/validation"), path.join(pub, "validation"), (f) => /\.(png|json)$/.test(f));
copyDir(path.join(root, "docs/training"), path.join(pub, "training"), (f) => /\.(png|json)$/.test(f));
copyDir(path.join(root, "docs/brand"), path.join(pub, "brand"), (f) => /\.(svg|pdf)$/.test(f));
// брендбук в приложении берёт шрифты и графики из общих папок public/
const bb = path.join(root, "docs/brand/brandbook.html");
if (fs.existsSync(bb)) fs.writeFileSync(path.join(pub, "brand/brandbook.html"),
  fs.readFileSync(bb, "utf8").replaceAll('url("fonts/', 'url("/fonts/').replaceAll('src="../validation/', 'src="/validation/'));
console.log("assets synced");
