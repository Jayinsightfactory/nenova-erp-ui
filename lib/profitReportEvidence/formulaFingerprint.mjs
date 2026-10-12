import { canonicalDigest } from './canonical.mjs';

const BINARY_PRECEDENCE = {
  '=': 1, '<>': 1, '<': 1, '>': 1, '<=': 1, '>=': 1,
  '&': 2,
  '+': 3, '-': 3,
  '*': 4, '/': 4,
  '^': 5,
  ':': 7,
};

function tokenize(formula) {
  const input = String(formula || '').normalize('NFC').replace(/^=/, '');
  const tokens = [];
  let i = 0;
  while (i < input.length) {
    const ch = input[i];
    if (/\s/.test(ch)) { i += 1; continue; }
    if (ch === '"') {
      let value = '';
      i += 1;
      while (i < input.length) {
        if (input[i] === '"' && input[i + 1] === '"') { value += '"'; i += 2; continue; }
        if (input[i] === '"') { i += 1; break; }
        value += input[i++];
      }
      tokens.push({ type: 'string', value });
      continue;
    }
    if (ch === "'") {
      let sheet = '';
      i += 1;
      while (i < input.length) {
        if (input[i] === "'" && input[i + 1] === "'") { sheet += "'"; i += 2; continue; }
        if (input[i] === "'") { i += 1; break; }
        sheet += input[i++];
      }
      if (input[i] === '!') {
        i += 1;
        let ref = '';
        while (i < input.length && !/[\s()+\-*/^&=<>%,:]/.test(input[i])) ref += input[i++];
        tokens.push({ type: 'word', value: `'${sheet.replace(/'/g, "''")}'!${ref}` });
      } else {
        tokens.push({ type: 'word', value: `'${sheet.replace(/'/g, "''")}'` });
      }
      continue;
    }
    if (/\d/.test(ch) || (ch === '.' && /\d/.test(input[i + 1] || ''))) {
      const match = input.slice(i).match(/^(?:\d+(?:\.\d*)?|\.\d+)(?:[Ee][+\-]?\d+)?/);
      tokens.push({ type: 'number', value: Number(match[0]), raw: match[0] });
      i += match[0].length;
      continue;
    }
    const two = input.slice(i, i + 2);
    if (['<>', '<=', '>='].includes(two)) { tokens.push({ type: 'op', value: two }); i += 2; continue; }
    if ('()+-*/^&=<>%,:'.includes(ch)) {
      tokens.push({ type: ['(', ')', ',', '%'].includes(ch) ? ch : 'op', value: ch });
      i += 1;
      continue;
    }
    let value = '';
    while (i < input.length && !/[\s()+\-*/^&=<>%,:]/.test(input[i])) value += input[i++];
    if (!value) throw new Error(`수식 토큰을 해석할 수 없습니다: ${input.slice(i, i + 20)}`);
    tokens.push({ type: 'word', value });
  }
  tokens.push({ type: 'eof', value: '' });
  return tokens;
}

function splitReference(value) {
  const bang = value.lastIndexOf('!');
  const sheet = bang >= 0 ? value.slice(0, bang).replace(/^'|'$/g, '').replace(/''/g, "'") : null;
  const address = bang >= 0 ? value.slice(bang + 1) : value;
  const cell = address.match(/^(\$?)([A-Za-z]{1,3})(\$?)(\d+)$/);
  if (cell) return { type: 'Reference', sheet, address: address.toUpperCase(), column: cell[2].toUpperCase(), row: Number(cell[4]), absoluteColumn: !!cell[1], absoluteRow: !!cell[3] };
  const column = address.match(/^(\$?)([A-Za-z]{1,3})$/);
  if (column) return { type: 'ColumnReference', sheet, address: address.toUpperCase(), column: column[2].toUpperCase(), absoluteColumn: !!column[1] };
  const row = address.match(/^(\$?)(\d+)$/);
  if (row) return { type: 'RowReference', sheet, address, row: Number(row[2]), absoluteRow: !!row[1] };
  return null;
}

class Parser {
  constructor(tokens) { this.tokens = tokens; this.index = 0; }
  peek() { return this.tokens[this.index]; }
  take() { return this.tokens[this.index++]; }
  expect(type) {
    const token = this.take();
    if (token.type !== type) throw new Error(`수식 구문 오류: ${type} 예상, ${token.type}:${token.value} 발견`);
    return token;
  }
  expression(minPrecedence = 0) {
    let left = this.prefix();
    while (true) {
      const token = this.peek();
      if (token.type === '%') { this.take(); left = { type: 'PostfixExpression', operator: '%', argument: left }; continue; }
      if (token.type !== 'op' || BINARY_PRECEDENCE[token.value] == null || BINARY_PRECEDENCE[token.value] < minPrecedence) break;
      const op = this.take().value;
      const precedence = BINARY_PRECEDENCE[op];
      const right = this.expression(op === '^' ? precedence : precedence + 1);
      left = { type: op === ':' ? 'RangeExpression' : 'BinaryExpression', operator: op, left, right };
    }
    return left;
  }
  prefix() {
    const token = this.take();
    if (token.type === 'op' && ['+', '-'].includes(token.value)) {
      return { type: 'UnaryExpression', operator: token.value, argument: this.expression(6) };
    }
    if (token.type === 'number') return { type: 'NumberLiteral', value: token.value, raw: token.raw };
    if (token.type === 'string') return { type: 'StringLiteral', value: token.value };
    if (token.type === '(') {
      const expression = this.expression(0);
      this.expect(')');
      return { type: 'ParenthesizedExpression', expression };
    }
    if (token.type === 'word') {
      if (this.peek().type === '(') {
        this.take();
        const argumentsList = [];
        if (this.peek().type !== ')') {
          while (true) {
            if (this.peek().type === ',') argumentsList.push({ type: 'MissingArgument' });
            else argumentsList.push(this.expression(0));
            if (this.peek().type !== ',') break;
            this.take();
            if (this.peek().type === ')') argumentsList.push({ type: 'MissingArgument' });
          }
        }
        this.expect(')');
        return { type: 'CallExpression', name: token.value.toUpperCase(), arguments: argumentsList };
      }
      return splitReference(token.value) || { type: 'Name', name: token.value.toUpperCase() };
    }
    throw new Error(`수식 구문 오류: ${token.type}:${token.value}`);
  }
}

function columnIndex(column) {
  return [...column].reduce((value, ch) => value * 26 + ch.charCodeAt(0) - 64, 0);
}

function shapeNode(node, origin) {
  if (Array.isArray(node)) return node.map(value => shapeNode(value, origin));
  if (!node || typeof node !== 'object') return node;
  if (node.type === 'Reference') {
    return {
      type: node.type,
      sheet: node.sheet || '$SELF',
      column: node.absoluteColumn ? { absolute: columnIndex(node.column) } : { relative: columnIndex(node.column) - origin.column },
      row: node.absoluteRow ? { absolute: node.row } : { relative: node.row - origin.row },
    };
  }
  if (node.type === 'ColumnReference') {
    return { type: node.type, sheet: node.sheet || '$SELF', column: node.absoluteColumn ? { absolute: columnIndex(node.column) } : { relative: columnIndex(node.column) - origin.column } };
  }
  if (node.type === 'RowReference') {
    return { type: node.type, sheet: node.sheet || '$SELF', row: node.absoluteRow ? { absolute: node.row } : { relative: node.row - origin.row } };
  }
  return Object.fromEntries(Object.entries(node).map(([key, value]) => [key, shapeNode(value, origin)]));
}

export function parseFormulaAst(formula) {
  const parser = new Parser(tokenize(formula));
  const expression = parser.expression(0);
  parser.expect('eof');
  return { type: 'Formula', expression };
}

export function formulaFingerprint(formula, address = 'A1', formulaMeta = {}) {
  const ast = parseFormulaAst(formula);
  const originRef = splitReference(address) || { column: 'A', row: 1 };
  const origin = { column: columnIndex(originRef.column), row: originRef.row };
  const envelope = {
    formulaKind: formulaMeta.type || 'normal',
    sharedIndex: formulaMeta.sharedIndex ?? null,
    arrayOrSharedRef: formulaMeta.ref ?? null,
  };
  return {
    ast,
    exact: canonicalDigest({ ...envelope, operatorTree: ast }),
    shape: canonicalDigest({ ...envelope, operatorTree: shapeNode(ast, origin) }),
  };
}
