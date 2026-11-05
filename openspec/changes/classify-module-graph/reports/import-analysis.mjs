import ts from 'typescript';
import postcss from 'postcss';

/** Describe referencias declaradas; no interpreta ni ejecuta código de producto. */
export function moduleReferences(source, fileName = 'module.ts') {
  if (fileName.endsWith('.css')) {
    const references = [];
    postcss.parse(source, { from: fileName }).walkAtRules('import', (rule) => {
      const match = rule.params.match(/^(?:url\(\s*)?["']([^"']+)["']/);
      if (match) references.push({ specifier: match[1], line: rule.source.start.line, kind: 'css-import', explicitType: false });
    });
    return references;
  }
  if (fileName.endsWith('.json')) return [];
  const ast = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true);
  const references = [];
  const add = (literal, node, kind, explicitType = false) => {
    if (!literal || !ts.isStringLiteralLike(literal)) return;
    references.push({
      specifier: literal.text,
      line: ast.getLineAndCharacterOfPosition(node.getStart(ast)).line + 1,
      kind,
      explicitType,
    });
  };
  const visit = (node) => {
    if (ts.isImportDeclaration(node)) {
      const clause = node.importClause;
      const bindings = clause?.namedBindings;
      const onlyNamedTypes = bindings && ts.isNamedImports(bindings)
        && bindings.elements.length > 0 && bindings.elements.every((entry) => entry.isTypeOnly);
      add(node.moduleSpecifier, node, 'import', Boolean(clause?.isTypeOnly || (!clause?.name && onlyNamedTypes)));
    } else if (ts.isExportDeclaration(node)) {
      const onlyNamedTypes = node.exportClause && ts.isNamedExports(node.exportClause)
        && node.exportClause.elements.length > 0 && node.exportClause.elements.every((entry) => entry.isTypeOnly);
      add(node.moduleSpecifier, node, 'export', Boolean(node.isTypeOnly || onlyNamedTypes));
    } else if (ts.isCallExpression(node)
      && (node.expression.kind === ts.SyntaxKind.ImportKeyword
        || (ts.isIdentifier(node.expression) && node.expression.text === 'require'))) {
      add(node.arguments[0], node, 'call');
    } else if (ts.isImportEqualsDeclaration(node) && ts.isExternalModuleReference(node.moduleReference)) {
      add(node.moduleReference.expression, node, 'import-equals', node.isTypeOnly);
    } else if (ts.isImportTypeNode(node) && ts.isLiteralTypeNode(node.argument)) {
      add(node.argument.literal, node, 'import-type', true);
    }
    ts.forEachChild(node, visit);
  };
  visit(ast);
  return references;
}

export function analyzeImports(source, fileName, compilerOptions = {}) {
  const emitted = ts.transpileModule(source, {
    fileName,
    compilerOptions: {
      ...compilerOptions,
      module: ts.ModuleKind.CommonJS,
      noEmit: false,
      verbatimModuleSyntax: false,
    },
  }).outputText;
  const retained = new Set(moduleReferences(emitted, `${fileName}.js`).map((entry) => entry.specifier));
  return moduleReferences(source, fileName).map((entry) => ({
    ...entry,
    emission: retained.has(entry.specifier) ? 'conservada' : 'borrada',
  }));
}
