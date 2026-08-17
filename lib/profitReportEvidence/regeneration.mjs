import { MAIN_GEOMETRY, MAIN_SHEET, STANDARD_HELPER_SHEETS } from './workbookEvidence.mjs';

const AMOUNT_TOLERANCE = 1;
const RATIO_TOLERANCE = 0.0001;
const MAIN_FORMULA_COLUMNS = Object.freeze(['C', 'D', 'G', 'I', 'J', 'K', 'M', 'P', 'T', 'U']);

function numeric(value) {
  if (value == null || value === '') return 0;
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
  const parsed = Number(String(value).replace(/,/g, '').trim());
  return Number.isFinite(parsed) ? parsed : 0;
}

function rawValue(value) {
  if (value == null) return null;
  if (typeof value !== 'string') return value;
  const trimmed = value.trim();
  if (trimmed === '') return '';
  const parsed = Number(trimmed.replace(/,/g, ''));
  return Number.isFinite(parsed) ? parsed : value;
}

function unquoteSheet(value) {
  const text = String(value || '');
  return text.startsWith("'") && text.endsWith("'")
    ? text.slice(1, -1).replace(/''/g, "'")
    : text;
}

function splitReference(value) {
  const text = String(value || '').replace(/\$/g, '');
  const bang = text.lastIndexOf('!');
  const sheet = bang >= 0 ? unquoteSheet(text.slice(0, bang)) : MAIN_SHEET;
  const address = bang >= 0 ? text.slice(bang + 1) : text;
  const cell = address.match(/^([A-Z]{1,3})(\d+)$/i);
  if (cell) return { type: 'cell', sheet, address: `${cell[1].toUpperCase()}${cell[2]}` };
  const column = address.match(/^([A-Z]{1,3}):([A-Z]{1,3})$/i);
  if (column) return { type: 'column', sheet, from: column[1].toUpperCase(), to: column[2].toUpperCase() };
  const range = address.match(/^([A-Z]{1,3}\d+):([A-Z]{1,3}\d+)$/i);
  if (range) return { type: 'range', sheet, from: range[1].toUpperCase(), to: range[2].toUpperCase() };
  return null;
}

function tokenize(formula) {
  const input = String(formula || '').replace(/^=/, '');
  const tokens = [];
  let index = 0;
  // 범위(A1:A20, $J:$J)는 하나의 reference token으로 보존해야 한다.
  const isDelimiter = ch => !ch || /[\s()+\-*/^&=<>%,]/.test(ch);
  while (index < input.length) {
    if (/\s/.test(input[index])) { index += 1; continue; }
    if (input[index] === '"') {
      let value = '';
      index += 1;
      while (index < input.length) {
        if (input[index] === '"' && input[index + 1] === '"') { value += '"'; index += 2; continue; }
        if (input[index] === '"') { index += 1; break; }
        value += input[index++];
      }
      tokens.push({ type: 'string', value });
      continue;
    }
    if (input[index] === "'") {
      let value = '';
      index += 1;
      while (index < input.length) {
        if (input[index] === "'" && input[index + 1] === "'") { value += "'"; index += 2; continue; }
        if (input[index] === "'") { index += 1; break; }
        value += input[index++];
      }
      if (input[index] === '!') {
        index += 1;
        let address = '';
        while (!isDelimiter(input[index])) address += input[index++];
        tokens.push({ type: 'ref', value: `'${value}'!${address}` });
      } else tokens.push({ type: 'word', value });
      continue;
    }
    if (/\d/.test(input[index]) || (input[index] === '.' && /\d/.test(input[index + 1] || ''))) {
      const match = input.slice(index).match(/^(?:\d+(?:\.\d*)?|\.\d+)(?:[Ee][+\-]?\d+)?/);
      tokens.push({ type: 'number', value: Number(match[0]) });
      index += match[0].length;
      continue;
    }
    const two = input.slice(index, index + 2);
    if (['<>', '<=', '>='].includes(two)) { tokens.push({ type: 'operator', value: two }); index += 2; continue; }
    if ('()+-*/^&=<>%,:'.includes(input[index])) {
      const value = input[index++];
      tokens.push({ type: ['(', ')', ','].includes(value) ? value : 'operator', value });
      continue;
    }
    let value = '';
    while (!isDelimiter(input[index])) value += input[index++];
    tokens.push({ type: 'word', value });
  }
  tokens.push({ type: 'eof', value: '' });
  return tokens;
}

class FormulaParser {
  constructor(formula) { this.tokens = tokenize(formula); this.index = 0; }
  peek() { return this.tokens[this.index]; }
  take() { return this.tokens[this.index++]; }
  expect(type) {
    const token = this.take();
    if (token.type !== type) throw new Error(`기대 토큰 ${type}, 실제 ${token.type}:${token.value}`);
    return token;
  }
  expression(minPrecedence = 0) {
    let left = this.prefix();
    const precedence = { ':': 7, '^': 6, '*': 5, '/': 5, '+': 4, '-': 4, '&': 3, '=': 2, '<>': 2, '<': 2, '>': 2, '<=': 2, '>=': 2 };
    while (true) {
      const token = this.peek();
      const value = token.value;
      if (token.type !== 'operator' || precedence[value] == null || precedence[value] < minPrecedence) break;
      this.take();
      const right = this.expression(precedence[value] + (value === '^' ? 0 : 1));
      left = value === ':'
        ? { type: 'range', operator: value, left, right }
        : { type: 'binary', operator: value, left, right };
    }
    return left;
  }
  prefix() {
    const token = this.take();
    if (token.type === 'operator' && ['+', '-'].includes(token.value)) return { type: 'unary', operator: token.value, argument: this.expression(8) };
    if (token.type === 'number') return { type: 'literal', value: token.value };
    if (token.type === 'string') return { type: 'literal', value: token.value };
    if (token.type === '(') { const expression = this.expression(); this.expect(')'); return expression; }
    if (token.type === 'ref') return { type: 'ref', ref: splitReference(token.value) };
    if (token.type === 'word') {
      if (this.peek().type === '(') {
        this.take();
        const args = [];
        if (this.peek().type !== ')') {
          while (true) {
            args.push(this.expression());
            if (this.peek().type !== ',') break;
            this.take();
          }
        }
        this.expect(')');
        return { type: 'call', name: token.value.toUpperCase(), args };
      }
      const ref = splitReference(token.value);
      if (ref) return { type: 'ref', ref };
      return { type: 'name', name: token.value };
    }
    throw new Error(`수식 토큰 해석 실패: ${token.type}:${token.value}`);
  }
  parse() {
    const ast = this.expression();
    if (this.peek().type !== 'eof') throw new Error(`수식 뒤에 해석하지 못한 토큰: ${this.peek().value}`);
    return ast;
  }
}

function columnNumber(column) {
  return [...String(column)].reduce((n, char) => n * 26 + char.charCodeAt(0) - 64, 0);
}

function addressParts(address) {
  const match = String(address).match(/^([A-Z]+)(\d+)$/i);
  return match ? { column: match[1].toUpperCase(), row: Number(match[2]) } : null;
}

function betweenColumns(column, from, to) {
  return columnNumber(column) >= columnNumber(from) && columnNumber(column) <= columnNumber(to);
}

function numericValue(value) {
  return typeof value === 'number' ? value : numeric(value);
}

function compareValues(left, right) {
  if (left == null || left === '') return right == null || right === '';
  if (right == null || right === '') return false;
  const leftNumber = Number(left);
  const rightNumber = Number(right);
  if (Number.isFinite(leftNumber) && Number.isFinite(rightNumber)) return leftNumber === rightNumber;
  return String(left).trim() === String(right).trim();
}

function referenceCells(ref, context) {
  if (!ref) return [];
  const cacheKey = JSON.stringify(ref);
  if (context.rangeCache?.has(cacheKey)) return context.rangeCache.get(cacheKey);
  if (ref.type === 'cell') return [ref];
  const cells = [];
  for (const entry of Object.values(context.registry)) {
    if (entry.sheet !== ref.sheet) continue;
    const parts = addressParts(entry.address);
    if (!parts) continue;
    if (ref.type === 'column' && betweenColumns(parts.column, ref.from, ref.to)) cells.push({ sheet: ref.sheet, address: entry.address });
    if (ref.type === 'range') {
      const from = addressParts(ref.from);
      const to = addressParts(ref.to);
      if (from && to && parts.row >= from.row && parts.row <= to.row && betweenColumns(parts.column, from.column, to.column)) cells.push({ sheet: ref.sheet, address: entry.address });
    }
  }
  context.rangeCache?.set(cacheKey, cells);
  return cells;
}

function evaluateFormulaAst(ast, context) {
  if (ast.type === 'literal') return ast.value;
  if (ast.type === 'name') return ast.name;
  if (ast.type === 'ref') {
    if (ast.ref.type === 'cell') return context.evaluateCell(ast.ref.sheet, ast.ref.address);
    return { range: referenceCells(ast.ref, context) };
  }
  if (ast.type === 'range') {
    const left = ast.left.type === 'ref' ? ast.left.ref : null;
    const right = ast.right.type === 'ref' ? ast.right.ref : null;
    if (!left || !right || left.sheet !== right.sheet) throw new Error('서로 다른 시트 범위는 지원하지 않습니다.');
    return { range: referenceCells({ type: 'range', sheet: left.sheet, from: left.address, to: right.address }, context) };
  }
  if (ast.type === 'unary') {
    const value = numericValue(evaluateFormulaAst(ast.argument, context));
    return ast.operator === '-' ? -value : value;
  }
  if (ast.type === 'binary') {
    const left = evaluateFormulaAst(ast.left, context);
    const right = evaluateFormulaAst(ast.right, context);
    switch (ast.operator) {
      case '+': return numericValue(left) + numericValue(right);
      case '-': return numericValue(left) - numericValue(right);
      case '*': return numericValue(left) * numericValue(right);
      case '/': if (numericValue(right) === 0) throw new Error('0으로 나누기'); return numericValue(left) / numericValue(right);
      case '^': return numericValue(left) ** numericValue(right);
      case '&': return `${left ?? ''}${right ?? ''}`;
      case '=': return compareValues(left, right);
      case '<>': return !compareValues(left, right);
      case '<': return numericValue(left) < numericValue(right);
      case '>': return numericValue(left) > numericValue(right);
      case '<=': return numericValue(left) <= numericValue(right);
      case '>=': return numericValue(left) >= numericValue(right);
      default: throw new Error(`지원하지 않는 연산자: ${ast.operator}`);
    }
  }
  if (ast.type === 'call') {
    if (ast.name === 'IFERROR') {
      try { return evaluateFormulaAst(ast.args[0], context); } catch { return ast.args[1] ? evaluateFormulaAst(ast.args[1], context) : ''; }
    }
    const args = ast.args.map(arg => evaluateFormulaAst(arg, context));
    if (ast.name === 'SUM') {
      return args.flatMap(value => value?.range || [value]).reduce((sum, value) => {
        const resolved = value?.sheet && value?.address ? context.evaluateCell(value.sheet, value.address) : value;
        return sum + numericValue(resolved);
      }, 0);
    }
    if (ast.name === 'SUMIF') {
      const criteriaRange = args[0]?.range || [];
      const criteria = args[1];
      const sumRange = args[2]?.range || [];
      return criteriaRange.reduce((sum, ref, index) => {
        const criterionValue = context.evaluateCell(ref.sheet, ref.address);
        if (!compareValues(criterionValue, criteria)) return sum;
        const sumRef = sumRange[index];
        return sum + (sumRef ? numericValue(context.evaluateCell(sumRef.sheet, sumRef.address)) : 0);
      }, 0);
    }
    throw new Error(`지원하지 않는 함수: ${ast.name}`);
  }
  throw new Error(`지원하지 않는 AST: ${ast.type}`);
}

function createEvaluationContext(sourceEvidence) {
  const cache = new Map();
  const active = new Set();
  const isIndependentTarget = (sheet, address) => {
    if (sheet !== MAIN_SHEET) return false;
    const match = String(address).match(/^([A-Z]+)(\d+)$/);
    return Boolean(match && MAIN_FORMULA_COLUMNS.includes(match[1])
      && Number(match[2]) >= MAIN_GEOMETRY.firstItemRow
      && Number(match[2]) <= MAIN_GEOMETRY.totalRow);
  };
  const context = {
    registry: sourceEvidence.registry,
    rangeCache: new Map(),
    evaluateCell(sheet, address) {
      const key = `${sheet}!${address}`;
      if (cache.has(key)) return cache.get(key);
      if (active.has(key)) throw new Error(`순환참조: ${key}`);
      const cell = sourceEvidence.registry[key];
      if (!cell) return 0;
      active.add(key);
      let value;
      try {
        // 본표의 검증 대상 수식만 재계산한다. 보조시트 수식은 본표 입력 원천의
        // 저장 캐시값을 읽어, 보조시트 전체를 다시 계산하는 폭발적 범위를 피한다.
        value = cell.formula && isIndependentTarget(sheet, address)
          ? evaluateFormulaAst(new FormulaParser(cell.formula).parse(), context)
          : rawValue(cell.value ?? cell.rawValue);
      } finally {
        active.delete(key);
      }
      cache.set(key, value);
      return value;
    },
  };
  return context;
}

function near(actual, expected, tolerance) {
  if (actual == null && expected == null) return true;
  if (typeof actual !== 'number' || typeof expected !== 'number') return String(actual ?? '') === String(expected ?? '');
  return Math.abs(actual - expected) <= tolerance;
}

/**
 * 원본 workbook을 복사하는 방식은 재생성이 아니므로 폐기했다.
 * 이 함수는 과거 호출자가 조용히 가짜 parity를 만들지 않도록 명시적으로 실패한다.
 */
export function regenerateFromPersistedEvidence() {
  throw new Error('원본 workbook 복사 재생성은 폐기되었습니다. recalculateMainFormulaCells를 사용하십시오.');
}

export function recalculateMainFormulaCells(sourceEvidence) {
  const context = createEvaluationContext(sourceEvidence);
  const cells = [];
  const unsupported = [];
  for (let row = MAIN_GEOMETRY.firstItemRow; row <= MAIN_GEOMETRY.totalRow; row += 1) {
    for (const column of MAIN_FORMULA_COLUMNS) {
      const address = `${column}${row}`;
      const sourceCell = sourceEvidence.registry[`${MAIN_SHEET}!${address}`];
      if (!sourceCell?.formula) continue;
      try {
        const recalculated = context.evaluateCell(MAIN_SHEET, address);
        const expected = sourceCell.value ?? sourceCell.rawValue;
        const tolerance = MAIN_GEOMETRY.ratioColumns.includes(column) ? RATIO_TOLERANCE : AMOUNT_TOLERANCE;
        cells.push({ address, formula: sourceCell.formula, expected, recalculated, pass: near(recalculated, rawValue(expected), tolerance), tolerance });
      } catch (error) {
        unsupported.push({ address, formula: sourceCell.formula, error: error.message });
      }
    }
  }
  const mismatches = cells.filter(cell => !cell.pass);
  const status = unsupported.length ? 'UNVERIFIED' : mismatches.length ? 'FAIL' : 'PASS';
  return { status, checked: cells.length, mismatches, unsupported, cells };
}

export function compareIndependentFormulaRecalculation(sourceEvidence) {
  const formula = recalculateMainFormulaCells(sourceEvidence);
  const checks = [
    { id: 'independent-formula-recalculation', status: formula.status, evidence: formula },
    { id: 'copy-replay-disabled', status: 'PASS', evidence: { policy: '원본 workbook 복사 경로 폐기' } },
  ];
  return { status: formula.status, checks, formula };
}

/** 이전 이름을 호출하는 외부 테스트는 독립 재계산으로 전환한다. */
export async function compareRegeneratedWorkbook(sourceEvidence) {
  return compareIndependentFormulaRecalculation(sourceEvidence);
}

export { MAIN_FORMULA_COLUMNS };
