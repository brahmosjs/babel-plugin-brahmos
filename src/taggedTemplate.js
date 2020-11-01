import t from '@babel/types';

import { SELF_CLOSING_TAGS, PROPERTY_ATTRIBUTE_MAP, BRAHMOS_PLACEHOLDER } from './constants';

import {
  cleanStringForHtml,
  isHTMLElement,
  needsToBeExpression,
  isEmptyLiteralWrap,
  createAttributeExpression,
  createAttributeProperty,
  getPropValue,
} from './utils';

import { isSvgHasDynamicPart } from './svg';

import {
  getPartMetaStringLiteral,
  getNonFragmentParent,
  isWrappedWithString,
  getPreviousSiblingIndex,
} from './partUtils';

/**
 * Convert an JSXExpression / JSXMemberExpression to Identifier or MemberExpression
 */
function jsxToObject(node) {
  if (t.isJSXIdentifier(node)) {
    return t.identifier(node.name);
  } else if (t.isJSXMemberExpression(node)) {
    /**
     * recursively change object property of JSXMemberExpression
     * to MemberExpression
     */
    const objectNode = jsxToObject(node.object);
    const property = jsxToObject(node.property);
    return t.memberExpression(objectNode, property);
  }
}

/**
 * Check if element needs to be transformed as jsx function call
 */
function needsToBeJSXCall(path) {
  const { openingElement } = path.node;

  const { attributes, name } = openingElement;
  const tagName = name.name;

  // if its a component transform to jsx call
  if (!isHTMLElement(tagName)) return true;

  // if it has key attribute, convert to jsx call
  const hasKeyAttribute = attributes.some(
    (attribute) => t.isJSXAttribute(attribute) && attribute.name.name === 'key',
  );
  if (hasKeyAttribute) return true;

  // if it is svg with some dynamic part
  if (tagName === 'svg' && isSvgHasDynamicPart(path)) return true;

  return false;
}

function getLiteralParts(rootPath) {
  const strings = [];
  const expressions = [];
  let stringPart = [];
  const partsMeta = [];

  let elementCounter = 0;

  function pushToStrings(tail) {
    const string = stringPart.join('');
    strings.push(t.templateElement({ raw: string, cooked: string }, tail));
    stringPart = [];
  }

  function pushToExpressions(expression, path, isAttribute) {
    pushToStrings();

    const parent = getNonFragmentParent(path);

    const refNodeIndex = isAttribute ? elementCounter - 1 : parent.elementCounter;

    let partMeta = {
      refNodeIndex,
      isAttribute,
    };

    if (isAttribute) {
      partMeta.attributeIndex = path.node.staticAttributes.length;
    } else {
      partMeta = { ...partMeta, ...getPreviousSiblingIndex(path) };
    }

    partsMeta.push(partMeta);

    expressions.push(expression);
  }

  function pushAttributeToExpressions(expression, lastExpression, path) {
    /**
     * If last expression is defined push on the same expression else create a new expression.
     */
    if (lastExpression) {
      /**
       * if last expression is not an object covert it to object expression and
       * reset the last value of expressions array
       */
      if (!t.isObjectExpression(lastExpression)) {
        lastExpression = t.objectExpression([t.spreadElement(lastExpression)]);
        expressions[expressions.length - 1] = lastExpression;
      }

      /**
       * If the new expression is not an object expression convert it into object expression
       */
      if (!t.isObjectExpression(expression)) {
        expression = t.objectExpression([t.spreadElement(expression)]);
      }

      lastExpression.properties.push(...expression.properties);
      return lastExpression;
    }

    pushToExpressions(expression, path, true);

    // keep space after expressions
    stringPart.push(' ');

    return expression;
  }

  function recursePath(path, isSVGPart) {
    const { node } = path;

    if (Array.isArray(path)) {
      path.forEach(recursePath);
    } else if (t.isJSXElement(node)) {
      const { openingElement, children } = node;
      const { attributes, name } = openingElement;
      const tagName = name.name;

      isSVGPart = isSVGPart || tagName === 'svg';

      if (!needsToBeJSXCall(path)) {
        node.elementCounter = elementCounter;
        node.staticAttributes = [];
        elementCounter += 1;
        // Handle opening tag
        stringPart.push(`<${tagName} `);

        /**
         * Keep the reference of last dynamic expression so we can add it to same object,
         * instead of creating new expression for each attributes
         */
        let lastExpression = null;

        // push all attributes to opening tag
        attributes.forEach((attribute) => {
          // if we encounter spread attribute, push the argument as expression
          if (t.isJSXSpreadAttribute(attribute)) {
            lastExpression = pushAttributeToExpressions(attribute.argument, lastExpression, path);
          } else {
            const { name, value } = attribute;
            let attrName = name.name;

            /**
             * check if the attribute should go as expression or the value is and actual expression
             * then push it to expression other wise push it as string part
             */

            if (needsToBeExpression(tagName, attrName) || t.isJSXExpressionContainer(value)) {
              const expression = createAttributeExpression(name, value);
              lastExpression = pushAttributeToExpressions(expression, lastExpression, path);
            } else {
              /**
               * Check if attrName needs to be changed, to form html attribute like className -> class
               * Change the property name only if the value is string type so at comes along with
               * string part. In case of value is expression we don't need to do it
               */
              attrName = PROPERTY_ATTRIBUTE_MAP[attrName] || attrName;
              let attrString = ` ${attrName}`;

              if (value) {
                const attrValue = value.value;
                // By default use the double quote to wrap value, but if value have double quote then use single quote
                const quote = attrValue.includes('"') ? `'` : `"`;
                attrString = `${attrString}=${quote}${attrValue}${quote}`;
              }

              stringPart.push(attrString);

              node.staticAttributes.push(attribute);

              // reset the lastExpression value, as static part comes between two dynamic parts
              lastExpression = null;
            }
          }
        });

        stringPart.push('>');

        // handle children
        path.get('children').forEach(recursePath);

        // handle closing tag, don't add it for self closing tags
        if (!SELF_CLOSING_TAGS.includes(tagName)) {
          stringPart.push(`</${tagName}>`);
        }
      } else {
        const componentName = isHTMLElement(name.name)
          ? t.stringLiteral(name.name)
          : jsxToObject(name);

        // add props
        const props = [];

        let keyValue;

        attributes.forEach((attribute) => {
          if (t.isJSXSpreadAttribute(attribute)) {
            props.push(t.spreadElement(attribute.argument));
          } else {
            let { name, value } = attribute;
            if (name.name === 'key') {
              keyValue = getPropValue(value);
            } else {
              props.push(createAttributeProperty(name, value));
            }
          }
        });

        const jsxArguments = [componentName, t.objectExpression(props)];

        // if the node has children add it in props
        if (children && children.length) {
          props.push(
            createAttributeProperty(
              t.identifier('children'),
              getTaggedTemplate(path.get('children')),
            ),
          );
        }

        // add key if present on arguments
        if (keyValue) {
          jsxArguments.push(keyValue);
        }

        const brahmosJSXFunction = t.identifier('_brahmosJSX');
        const expression = t.callExpression(brahmosJSXFunction, jsxArguments);

        pushToExpressions(expression, path, false);
      }
    } else if (t.isJSXText(node)) {
      const cleanStr = cleanStringForHtml(node.value);
      if (cleanStr) stringPart.push(cleanStr);
    } else if (t.isJSXExpressionContainer(node) && !t.isJSXEmptyExpression(node.expression)) {
      if (isWrappedWithString(path)) {
        stringPart.push(`<!--${BRAHMOS_PLACEHOLDER}-->`);
      }

      pushToExpressions(node.expression, path, false);
    } else if (t.isJSXFragment(node)) {
      path.get('children').forEach(recursePath);
    }
  }

  recursePath(rootPath);

  // add the last template element
  pushToStrings(true);

  return {
    strings,
    expressions,
    partsMeta,
  };
}

export default function getTaggedTemplate(path) {
  const { strings, expressions, partsMeta } = getLiteralParts(path);

  /**
   * we do not need a tagged expression if there is a single expression and two empty string part
   * In that case we can just return the expression
   */
  if (expressions.length === 1 && isEmptyLiteralWrap(strings)) {
    return expressions[0];
  }

  const brahmosHtmlFunction = t.identifier('_brahmosHtml');

  const taggedTemplate = t.taggedTemplateExpression(
    brahmosHtmlFunction,
    t.templateLiteral(strings, expressions),
  );

  const callExpression = t.callExpression(taggedTemplate, [getPartMetaStringLiteral(partsMeta)]);

  return callExpression;
}
