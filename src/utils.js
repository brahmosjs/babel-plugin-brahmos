import t from '@babel/types';
import { RESERVED_ATTRIBUTES, SVG_ATTRIBUTE_MAP } from './constants';
/**
 * Method to remove newlines and extra spaces which does not render on browser
 * Logic taken from
 * https://github.com/babel/babel/blob/master/packages/babel-types/src/utils/react/cleanJSXElementLiteralChild.js
 */
export function cleanStringForHtml(rawStr) {
  const lines = rawStr.split(/\r\n|\n|\r/);

  let lastNonEmptyLine = 0;

  for (let i = 0; i < lines.length; i++) {
    if (lines[i].match(/[^ \t]/)) {
      lastNonEmptyLine = i;
    }
  }

  let str = '';

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    const isFirstLine = i === 0;
    const isLastLine = i === lines.length - 1;
    const isLastNonEmptyLine = i === lastNonEmptyLine;

    // replace rendered whitespace tabs with spaces
    let trimmedLine = line.replace(/\t/g, ' ');

    // trim whitespace touching a newline
    if (!isFirstLine) {
      trimmedLine = trimmedLine.replace(/^[ ]+/, '');
    }

    // trim whitespace touching an endline
    if (!isLastLine) {
      trimmedLine = trimmedLine.replace(/[ ]+$/, '');
    }

    if (trimmedLine) {
      if (!isLastNonEmptyLine) {
        trimmedLine += ' ';
      }

      str += trimmedLine;
    }
  }

  return str;
}

/**
 * Check if an element is html element or not.
 * same as what react does for jsx
 * https://github.com/babel/babel/blob/master/packages/babel-types/src/validators/react/isCompatTag.js
 */
export function isHTMLElement(tagName) {
  // Must start with a lowercase ASCII letter
  return !!tagName && /^[a-z]/.test(tagName);
}

export function needsToBeExpression(tagName, attrName) {
  /**
   * TODO: No need to change value attribute of a checkbox or radio button.
   */
  const tags = ['input', 'select', 'textarea'];
  const attributes = ['value', 'defaultValue', 'checked', 'defaultChecked'];
  return RESERVED_ATTRIBUTES[attrName] || (tags.includes(tagName) && attributes.includes(attrName));
}

/** Check if a template literal is an empty wrap for single expression */
export function isEmptyLiteralWrap(strings) {
  const emptyStrings = strings.filter((strNode) => !strNode.value.raw);
  return strings.length === 2 && emptyStrings.length === 2;
}

export function getPropValue(value) {
  return t.isJSXExpressionContainer(value) ? value.expression : value;
}

export function createAttributeProperty(name, value) {
  value = value || t.booleanLiteral(true); // if value is not present it means the prop is of boolean type with true value

  let attrNameStr = name.name;

  // if attribute has svg attribute mapping use that, otherwise use plain attribute
  attrNameStr = SVG_ATTRIBUTE_MAP[attrNameStr] || attrNameStr;

  const propName = attrNameStr.match('-|:')
    ? t.stringLiteral(attrNameStr)
    : t.identifier(attrNameStr);

  const propValue = getPropValue(value);
  return t.objectProperty(propName, propValue, false, propName.name === propValue.name);
}

export function createAttributeExpression(name, value) {
  return t.objectExpression([createAttributeProperty(name, value)]);
}

export function addBrahmosRuntime(programPath) {
  const jsxImport = t.importSpecifier(t.identifier('_brahmosJSX'), t.identifier('jsx'));
  const htmlImport = t.importSpecifier(t.identifier('_brahmosHtml'), t.identifier('html'));
  const importStatement = t.importDeclaration(
    [jsxImport, htmlImport],
    t.stringLiteral('brahmos/jsx-runtime'),
  );

  programPath.node.body.unshift(importStatement);

  programPath.hasBrahmosRuntime = true;
}
