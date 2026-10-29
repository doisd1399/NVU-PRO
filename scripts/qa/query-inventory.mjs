import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';
import { root, atomicJson } from './common.mjs';

const calls = [], sources = [];
function walk(directory) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const file = path.join(directory, entry.name);
    if (entry.isDirectory()) walk(file);
    else if (/\.tsx?$/.test(entry.name)) sources.push(file);
  }
}
walk(path.join(root, 'src'));
const apis = new Set(['query','onSnapshot','getDoc','getDocs','getDocFromServer','getDocsFromServer','setDoc','addDoc','updateDoc','deleteDoc','writeBatch','runTransaction']);
for (const file of sources.sort()) {
  const source = ts.createSourceFile(file, fs.readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true);
  const imported = new Map();
  for (const statement of source.statements) {
    if (!ts.isImportDeclaration(statement) || statement.moduleSpecifier.text !== 'firebase/firestore') continue;
    const bindings = statement.importClause?.namedBindings;
    if (bindings && ts.isNamedImports(bindings)) for (const element of bindings.elements) imported.set(element.name.text, element.propertyName?.text ?? element.name.text);
  }
  const visit = node => {
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression)) {
      const api = imported.get(node.expression.text);
      if (apis.has(api)) {
        const code = node.getText(source);
        calls.push({ file: path.relative(root, file).split(path.sep).join('/'), line: source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1,
          api, code: code.slice(0, 420), hasWhere: /\bwhere\s*\(/.test(code), hasOrder: /\borderBy\s*\(/.test(code),
          hasLimit: /\blimit(?:ToLast)?\s*\(/.test(code), hasCursor: /\b(?:startAfter|startAt|endBefore|endAt)\s*\(/.test(code) });
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
}
const counts = Object.fromEntries([...apis].map(api => [api, calls.filter(call => call.api === api).length]));
atomicJson(path.join(root, 'qa/audits/2026-10-26/query-inventory.json'), { schema: 1, filesInspected: sources.length, counts, productionAccess: false,
  method: 'Direct named imports of the Firebase Firestore Web SDK, parsed with the TypeScript AST. Wrappers, dynamic calls, backend/native code and runtime request counts are outside this inventory.', calls });
console.log('QUERY_INVENTORY', sources.length, JSON.stringify(counts));
