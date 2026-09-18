import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const failures = [];
const warnings = [];

const normalize = (value) => value.split(path.sep).join("/");
const exists = (relativePath) => fs.existsSync(path.join(root, relativePath));

const forbiddenPaths = [
  "nvu_secure_senior_final",
  "patch_plan.cjs",
  "patch_plan.js",
  "test_patch.cjs",
  "test_patch.js",
  "test_plan.ts",
  "bun.lock",
  "functions/lib",
];

for (const relativePath of forbiddenPaths) {
  if (exists(relativePath)) {
    failures.push(`artefato estrutural não permitido: ${relativePath}`);
  }
}

const packageJson = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
const packageLock = JSON.parse(fs.readFileSync(path.join(root, "package-lock.json"), "utf8"));
const lockRoot = packageLock?.packages?.[""] ?? {};

if (packageJson.name !== lockRoot.name || packageJson.name !== packageLock.name) {
  failures.push("package.json e package-lock.json possuem nomes diferentes");
}
if (packageJson.version !== lockRoot.version || packageJson.version !== packageLock.version) {
  failures.push("package.json e package-lock.json possuem versões diferentes");
}

const viteConfig = fs.readFileSync(path.join(root, "vite.config.ts"), "utf8");
if (viteConfig.includes("process.env.GEMINI_API_KEY")) {
  failures.push("vite.config.ts ainda injeta GEMINI_API_KEY no bundle do cliente");
}

const sourceExtensions = new Set([".ts", ".tsx", ".js", ".jsx"]);
const importPattern = /(?:import\s+(?:[^'\"]*?\s+from\s+)?|export\s+[^'\"]*?\s+from\s+|import\s*\()\s*['\"]([^'\"]+)['\"]/gm;

function collectFiles(relativeDir) {
  const start = path.join(root, relativeDir);
  const files = [];
  if (!fs.existsSync(start)) return files;

  const visit = (current) => {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const fullPath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        visit(fullPath);
      } else if (sourceExtensions.has(path.extname(entry.name))) {
        files.push(fullPath);
      }
    }
  };

  visit(start);
  return files;
}

function resolveLocalImport(fromFile, specifier) {
  let base;
  if (specifier.startsWith("@/")) {
    base = path.join(root, specifier.slice(2));
  } else if (specifier.startsWith(".")) {
    base = path.resolve(path.dirname(fromFile), specifier);
  } else {
    return null;
  }

  const candidates = [];
  if (path.extname(base)) {
    candidates.push(base);
  } else {
    for (const extension of sourceExtensions) candidates.push(`${base}${extension}`);
    for (const extension of sourceExtensions) candidates.push(path.join(base, `index${extension}`));
  }

  return candidates.find((candidate) => fs.existsSync(candidate)) ?? null;
}

function auditReachability(relativeDir, relativeEntry, ignore = new Set()) {
  const files = collectFiles(relativeDir);
  const graph = new Map();

  for (const file of files) {
    const source = fs.readFileSync(file, "utf8");
    const dependencies = [];
    importPattern.lastIndex = 0;
    let match;
    while ((match = importPattern.exec(source))) {
      const specifier = match[1];
      const resolved = resolveLocalImport(file, specifier);
      if (resolved) {
        dependencies.push(path.resolve(resolved));
      } else if (specifier.startsWith(".") || specifier.startsWith("@/")) {
        failures.push(
          `import local não resolvido em ${normalize(path.relative(root, file))}: ${specifier}`,
        );
      }
    }
    graph.set(path.resolve(file), dependencies);
  }

  const entry = path.resolve(root, relativeEntry);
  if (!fs.existsSync(entry)) {
    failures.push(`entrypoint ausente: ${relativeEntry}`);
    return;
  }

  const reached = new Set();
  const stack = [entry];
  while (stack.length) {
    const current = stack.pop();
    if (!current || reached.has(current)) continue;
    reached.add(current);
    for (const dependency of graph.get(current) ?? []) stack.push(dependency);
  }

  for (const file of files) {
    const relative = normalize(path.relative(root, file));
    if (ignore.has(relative)) continue;
    if (!reached.has(path.resolve(file))) {
      failures.push(`arquivo de código sem caminho de execução: ${relative}`);
    }
  }
}

auditReachability("src", "src/main.tsx", new Set(["src/vite-env.d.ts"]));
auditReachability("functions/src", "functions/src/index.ts");

const unusedRuntimeDependencies = ["dotenv", "react-medium-image-zoom"].filter(
  (dependency) => packageJson.dependencies?.[dependency],
);
if (unusedRuntimeDependencies.length) {
  warnings.push(
    `dependências diretas sem uso detectado no código atual: ${unusedRuntimeDependencies.join(", ")}`,
  );
}

if (failures.length) {
  console.error("Auditoria estrutural: FALHOU");
  failures.forEach((failure) => console.error(`- ${failure}`));
  if (warnings.length) warnings.forEach((warning) => console.warn(`- aviso: ${warning}`));
  process.exitCode = 1;
} else {
  console.log("Auditoria estrutural: OK");
  console.log("- raiz única e sem artefatos temporários conhecidos");
  console.log("- package.json/package-lock.json alinhados");
  console.log("- nenhum import local quebrado");
  console.log("- nenhum arquivo TS/TSX/JS/JSX órfão nos caminhos auditados");
  console.log("- GEMINI_API_KEY não é injetada pelo Vite no cliente");
  warnings.forEach((warning) => console.warn(`- aviso: ${warning}`));
}
