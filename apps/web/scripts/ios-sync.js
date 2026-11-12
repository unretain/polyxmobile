/**
 * Prepare the iOS project for an App Store build.
 *
 * The app loads the live site (server.url in capacitor.config.ts), so the binary
 * must NOT bundle a copy of the web app. This wipes any stale bundled site,
 * bundles a placeholder page only, runs `cap sync ios`, then fails if the bundle
 * contains any wallet key / seed phrase code or the native config lacks server.url.
 *
 * Usage (from apps/web, on the Mac): npm run ios:sync
 */
const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");

const root = path.join(__dirname, "..");
const outDir = path.join(root, "out");
const publicDir = path.join(root, "ios", "App", "App", "public");
const nativeConfig = path.join(root, "ios", "App", "App", "capacitor.config.json");

fs.rmSync(publicDir, { recursive: true, force: true });
fs.rmSync(outDir, { recursive: true, force: true });
fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(
  path.join(outDir, "index.html"),
  '<!doctype html><meta charset="utf-8"><title>Polyx</title>\n'
);

// --copy-only skips `pod install` (for machines without the Xcode project / CocoaPods).
const capCmd = process.argv.includes("--copy-only") ? "npx cap copy ios" : "npx cap sync ios";
execSync(capCmd, { cwd: root, stdio: "inherit" });

const forbidden = /privateKey|mnemonic|seed ?phrase|wallet\/vault|supabase/i;
const bad = [];
(function walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(p);
    else if (forbidden.test(fs.readFileSync(p, "utf8"))) bad.push(path.relative(root, p));
  }
})(publicDir);

const cfg = JSON.parse(fs.readFileSync(nativeConfig, "utf8"));

if (bad.length) {
  console.error("\n✗ Bundled web assets contain wallet key/seed code:\n  " + bad.join("\n  "));
  process.exit(1);
}
if (!cfg.server || !cfg.server.url) {
  console.error("\n✗ Native capacitor.config.json has no server.url");
  process.exit(1);
}
console.log(`\n✓ iOS bundle clean — app loads ${cfg.server.url}`);
