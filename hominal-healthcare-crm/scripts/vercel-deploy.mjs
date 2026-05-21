import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

var rootDir = process.argv[2];
var projectName = process.argv[3];
var token = process.argv[4];
var teamSlug = process.argv[5] || "";
var target = process.argv[6] || "production";

if (!rootDir || !projectName || !token) {
  console.error("Usage: node scripts/vercel-deploy.mjs <rootDir> <projectName> <token> [teamSlug] [target]");
  process.exit(1);
}

var absoluteRoot = path.resolve(rootDir);

function shouldIgnore(relativePath) {
  return (
    relativePath === ".DS_Store" ||
    relativePath.indexOf("node_modules/") === 0 ||
    relativePath.indexOf(".git/") === 0 ||
    relativePath.indexOf(".next/") === 0
  );
}

function listFiles(currentDir, baseDir, output) {
  var entries = fs.readdirSync(currentDir, { withFileTypes: true });
  for (var i = 0; i < entries.length; i += 1) {
    var entry = entries[i];
    var absolutePath = path.join(currentDir, entry.name);
    var relativePath = path.relative(baseDir, absolutePath).replace(/\\/g, "/");
    if (shouldIgnore(relativePath)) continue;
    if (entry.isDirectory()) {
      listFiles(absolutePath, baseDir, output);
    } else {
      output.push({
        absolutePath: absolutePath,
        relativePath: relativePath
      });
    }
  }
}

function encodeFile(filePath) {
  var buffer = fs.readFileSync(filePath);
  var isText =
    /\.(js|jsx|ts|tsx|json|css|md|txt|html|svg|sql|yml|yaml|env|gitignore|mjs)$/i.test(filePath) ||
    path.basename(filePath).indexOf(".") === -1;
  if (isText) {
    return {
      data: buffer.toString("utf8"),
      encoding: "utf-8"
    };
  }
  return {
    data: buffer.toString("base64"),
    encoding: "base64"
  };
}

function detectProjectSettings(rootPath) {
  var packageJsonPath = path.join(rootPath, "package.json");
  var nextConfigPath = path.join(rootPath, "next.config.mjs");
  var vercelConfigPath = path.join(rootPath, "vercel.json");
  var settings = {
    installCommand: "npm install",
    buildCommand: null,
    devCommand: null,
    outputDirectory: null,
    rootDirectory: null,
    framework: null
  };

  if (fs.existsSync(nextConfigPath)) {
    settings.framework = "nextjs";
    settings.buildCommand = "npm run build";
    settings.devCommand = "npm run dev";
    settings.outputDirectory = ".next";
    return settings;
  }

  if (fs.existsSync(vercelConfigPath)) {
    settings.framework = null;
    settings.buildCommand = null;
    settings.devCommand = null;
    settings.outputDirectory = null;
    return settings;
  }

  if (fs.existsSync(packageJsonPath)) {
    var packageJson = JSON.parse(fs.readFileSync(packageJsonPath, "utf8"));
    if (packageJson.scripts && packageJson.scripts.build) {
      settings.buildCommand = "npm run build";
    }
    if (packageJson.scripts && packageJson.scripts.dev) {
      settings.devCommand = "npm run dev";
    }
  }

  return settings;
}

async function createDeployment() {
  var files = [];
  listFiles(absoluteRoot, absoluteRoot, files);
  var payloadFiles = files.map(function mapFile(file) {
    var encoded = encodeFile(file.absolutePath);
    return {
      file: file.relativePath,
      data: encoded.data,
      encoding: encoded.encoding
    };
  });

  var body = {
    name: projectName,
    project: projectName,
    target: target,
    public: true,
    files: payloadFiles,
    projectSettings: detectProjectSettings(absoluteRoot),
    meta: {
      source: "codex-inline-deploy",
      checksum: crypto
        .createHash("sha1")
        .update(String(Date.now()) + projectName + absoluteRoot)
        .digest("hex")
    }
  };

  var url = "https://api.vercel.com/v13/deployments";
  var query = ["skipAutoDetectionConfirmation=1"];
  if (teamSlug) {
    query.push("slug=" + encodeURIComponent(teamSlug));
  }
  url += "?" + query.join("&");

  var response = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: "Bearer " + token,
      "Content-Type": "application/json"
    },
    body: JSON.stringify(body)
  });

  var json = await response.json();
  if (!response.ok) {
    console.error(JSON.stringify(json, null, 2));
    process.exit(1);
  }

  console.log(JSON.stringify(json, null, 2));
}

createDeployment().catch(function onError(error) {
  console.error(error);
  process.exit(1);
});
