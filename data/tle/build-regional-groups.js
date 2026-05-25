#!/usr/bin/env node

import * as https from "https";
import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";
import { dirname } from "path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const activePath = path.join(__dirname, "groups/active.txt");

// CelesTrak may still catalog these by INTDES until official names are assigned.
const pakistanManualTles = [
  `PRSC-EO2                
1 67746U 26027A   26144.09739257  .00005303  00000-0  25803-3 0  9998
2 67746  97.5030 272.4454 0008489 302.9161  57.1256 15.18791623 15303`,
  `PRSC-HS1
1 66054U 25234B   26144.90707146  .00004639  00000-0  21346-3 0  9999
2 66054  97.4768 214.3185 0011673 167.3554 192.7976 15.20765809 33108`,
];

const groups = [
  {
    file: "pakistan-satellites.txt",
    re: /^(PRSS|PRSC|PAKTES)/i,
    manualTles: pakistanManualTles,
  },
  {
    file: "india-satellites.txt",
    re: /^(IRS-P[0-9]|IRS-1|CARTOSAT|RESOURCESAT|OCEANSAT|EOS-|RISAT|SCATSAT|HYSIS|NISAR|SARAL|YOUTHSAT|MEGHA|INSAT-3D|IMS-1|INS-1|KALPANA|METSAT|HAMSAT|TES |ANVESHA|INDIA-BHUTAN|MICROSAT)/i,
    exclude: /^(SOCRATES|TIGRISAT|BRISAT|T\.MICROSAT|PAKTES)/i,
  },
];

async function downloadActive() {
  const url = "https://celestrak.org/NORAD/elements/gp.php?GROUP=active&FORMAT=tle";
  process.stdout.write("Refreshing active.txt for regional groups...");

  const data = await new Promise((resolve, reject) => {
    https
      .get(url, (res) => {
        if (res.statusCode !== 200) {
          res.resume();
          reject(new Error(`HTTP ${res.statusCode}`));
          return;
        }
        const chunks = [];
        res.on("data", (chunk) => chunks.push(chunk));
        res.on("end", () => resolve(Buffer.concat(chunks)));
        res.on("error", reject);
      })
      .on("error", reject);
  });

  await fs.promises.writeFile(activePath, data);
  process.stdout.write(" Done\n");
}

function catalogNumber(block) {
  const line1 = block.split("\n")[1] ?? "";
  const match = line1.match(/^1\s+(\d+)U/);
  return match ? match[1] : null;
}

function extract(lines, re, excludeRe) {
  const blocks = [];
  for (let i = 0; i < lines.length; i++) {
    const name = lines[i];
    if (!name || name.startsWith("1 ") || name.startsWith("2 ")) continue;
    const trimmed = name.trim();
    if (!re.test(trimmed) || (excludeRe && excludeRe.test(trimmed))) continue;
    const l1 = lines[i + 1];
    const l2 = lines[i + 2];
    if (l1?.startsWith("1 ") && l2?.startsWith("2 ")) {
      blocks.push([name, l1, l2].join("\n"));
    }
  }
  return blocks;
}

function mergeManualTles(blocks, manualTles = []) {
  const byCatalog = new Map(blocks.map((block) => [catalogNumber(block), block]));
  for (const block of manualTles) {
    const catnr = catalogNumber(block);
    if (catnr) {
      byCatalog.set(catnr, block);
    }
  }
  return [...byCatalog.values()];
}

async function buildRegionalGroups() {
  try {
    await downloadActive();
  } catch (error) {
    process.stdout.write(` Failed (${error.message}), using cached active.txt\n`);
    if (!fs.existsSync(activePath)) {
      throw new Error("active.txt not available");
    }
  }

  const data = fs.readFileSync(activePath, "utf8");
  const lines = data.split(/\r?\n/);

  for (const group of groups) {
    let blocks = extract(lines, group.re, group.exclude);
    if (group.manualTles?.length) {
      blocks = mergeManualTles(blocks, group.manualTles);
    }
    const target = path.join(__dirname, "groups", group.file);
    fs.writeFileSync(target, `${blocks.join("\n")}\n`);
    process.stdout.write(`${group.file}: ${blocks.length} satellites\n`);
  }
}

await buildRegionalGroups();
