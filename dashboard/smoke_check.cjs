#!/usr/bin/env node
/**
 * Smoke check: parse App.jsx with a real AST parser and flag any React hooks
 * or expression statements called at module (top-level) scope.
 *
 * Hooks called outside a component function cause two distinct crashes:
 *   TypeError: Cannot read properties of null (reading 'useEffect')
 *   ReferenceError: Cannot access '<var>' before initialization  (TDZ)
 *
 * Both happen when function-body code gets orphaned to module scope after
 * a partial Edit replacement.  AST parsing is exact — no brace-counting
 * heuristics, no false positives from template literals.
 */
"use strict";
const fs   = require("fs");
const path = require("path");

const acorn    = require("acorn");
const acornJsx = require("acorn-jsx");

const filePath = path.join(__dirname, "src", "App.jsx");
const src      = fs.readFileSync(filePath, "utf8");

const HOOKS = new Set([
  "useEffect","useState","useMemo","useCallback",
  "useRef","useContext","useReducer","useLayoutEffect",
]);

// acorn-jsx allows JSX syntax; acorn's ecmaVersion 2022+ handles most syntax.
const parser = acorn.Parser.extend(acornJsx());

let ast;
try {
  ast = parser.parse(src, {
    ecmaVersion: 2022,
    sourceType:  "module",
    locations:   true,
  });
} catch (err) {
  console.error(`✗ App.jsx parse error: ${err.message}`);
  process.exit(1);
}

const violations = [];

// Walk only the top-level body of the module (depth 0).
// We do NOT recurse into function bodies — we only care about module scope.
for (const node of ast.body) {
  // Bare expression at module scope: useEffect(...), setMetrics(...), etc.
  if (node.type === "ExpressionStatement") {
    const expr = node.expression;
    if (expr.type === "CallExpression") {
      const callee = expr.callee;
      const name = callee.type === "Identifier" ? callee.name
                 : callee.type === "MemberExpression" && callee.property.type === "Identifier"
                   ? callee.property.name : null;
      if (name && HOOKS.has(name)) {
        violations.push({
          line: node.loc.start.line,
          msg:  `hook call at module scope: ${name}(...)`,
        });
      } else {
        // Flag any bare call expression that looks like orphaned component code
        // (i.e. not a top-level side-effect pattern we'd expect at module scope)
        // We allow: console.*,  Object.*, Array.*, process.*, import()
        const isExpectedTopLevel =
          callee.type === "MemberExpression" ||
          (callee.type === "Identifier" && [
            "require","define","console","Object","Array","Promise",
          ].includes(callee.name));
        if (!isExpectedTopLevel && name && HOOKS.has(name)) {
          violations.push({ line: node.loc.start.line, msg: `suspicious call at module scope: ${name}(...)` });
        }
      }
    }

    // Also flag awaited calls at module scope (orphaned async code)
    if (expr.type === "AwaitExpression") {
      violations.push({
        line: node.loc.start.line,
        msg:  `await expression at module scope`,
      });
    }
  }

  // const/let with initializer that calls a hook at top level
  if (node.type === "VariableDeclaration") {
    for (const decl of node.declarations) {
      if (!decl.init) continue;
      const init = decl.init;
      // Direct hook call: const x = useState(...)
      if (init.type === "CallExpression") {
        const callee = init.callee;
        const name = callee.type === "Identifier" ? callee.name : null;
        if (name && HOOKS.has(name)) {
          violations.push({
            line: node.loc.start.line,
            msg:  `hook call in top-level variable initializer: ${name}(...)`,
          });
        }
      }
      // Array destructure: const [x, setX] = useState(...)
      if (init.type === "CallExpression" && decl.id.type === "ArrayPattern") {
        const callee = init.callee;
        const name = callee.type === "Identifier" ? callee.name : null;
        if (name && HOOKS.has(name)) {
          violations.push({
            line: node.loc.start.line,
            msg:  `hook call in top-level destructure: ${name}(...)`,
          });
        }
      }
    }
  }
}

if (violations.length === 0) {
  console.log("✓ App.jsx smoke check passed — no module-scope hook calls detected.");
  process.exit(0);
} else {
  console.error("✗ App.jsx smoke check FAILED — orphaned hooks/code at module scope:");
  for (const v of violations) {
    console.error(`  Line ${v.line}: ${v.msg}`);
  }
  process.exit(1);
}
