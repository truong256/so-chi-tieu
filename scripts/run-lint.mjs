import { spawnSync } from "node:child_process";
import process from "node:process";

const isWin = process.platform === "win32";
const args = [".", "--ignore-pattern", "dist", "--ignore-pattern", ".next"];

if (isWin) {
  const result = spawnSync("npx", ["eslint", ...args], { stdio: "inherit", shell: true });
  process.exit(result.status ?? 0);
} else {
  const result = spawnSync("bash", ["scripts/sites-env.sh", "--", "eslint", ...args], { stdio: "inherit" });
  process.exit(result.status ?? 0);
}
