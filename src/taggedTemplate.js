import t from '@babel/types';

import { SELF_CLOSING_TAGS, PROPERTY_ATTRIBUTE_MAP, BRAHMOS_PLACEHOLDER } from './constants';

import {
  cleanStringForHtml,
  isHTMLElement,
  needsToBeExpression,
  isEmptyLiteralWrap,
  createAttributeExpression,
  createAttributeProperty,
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
function jsxToObject (node) {
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

function getLiteralParts (rootPath) {
  const strings = [];
  const expressions = [];
  let stringPart = [];
  const partsMeta = [];

  let elementCounter = 0;

  function pushToStrings (tail) {
    const string = stringPart.join('');
    strings.push(t.templateElement({ raw: string, cooked: string }, tail));
    stringPart = [];
  }

  function pushToExpressions (expression, path, isAttribute) {
    pushToStrings();

    const parent = getNonFragmentParent(path);

    const refNodeIndex = isAttribute ? elementCounter - 1 : parent.elementCounter;

    let partMeta = {
      refNodeIndex,
      isAttribute,
    };

    if (isAttribute) {
      partsMeta.attributeIndex = path.node.staticAttributes.length;
    } else {
      partMeta = { ...partMeta, ...getPreviousSiblingIndex(path) };
    }

    partsMeta.push(partMeta);

    expressions.push(expression);
  }

  function pushAttributeToExpressions (expression, lastExpression, path) {
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

  function recursePath (path, isSVGPart) {
    const { node } = path;

    if (Array.isArray(path)) {
      path.forEach(recursePath);
    } else if (t.isJSXElement(node)) {
      const { openingElement, children } = node;
      const { attributes, name } = openingElement;
      const tagName = name.name;

      isSVGPart = isSVGPart || tagName === 'svg';

      if (isHTMLElement(tagName) && !(tagName === 'svg' && isSvgHasDynamicPart(path))) {
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
              stringPart.push(` ${attrName}${value ? `="${value.value}" ` : ''}`);

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
        const componentName = name.name === 'svg' ? t.stringLiteral(name.name) : jsxToObject(name);

        // add props
        const props = [];
        attributes.forEach((attribute) => {
          if (t.isJSXSpreadAttribute(attribute)) {
            props.push(t.spreadElement(attribute.argument));
          } else {
            let { name, value } = attribute;
            props.push(createAttributeProperty(name, value));
          }
        });

        const createElementArguments = [componentName, t.objectExpression(props)];

        if (children && children.length) {
          createElementArguments.push(getTaggedTemplate(path.get('children')));
        }

        const brahmosCreateElement = t.memberExpression(
          t.identifier('Brahmos'),
          t.identifier('createElement'),
        );
        const expression = t.callExpression(brahmosCreateElement, createElementArguments);

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

export default function getTaggedTemplate (path) {
  const { strings, expressions, partsMeta } = getLiteralParts(path);
  /**
   * we do not need a tagged expression if there is a single expression and two empty string part
   * In that case we can just return the expression
   */
  if (expressions.length === 1 && isEmptyLiteralWrap(strings)) {
    return expressions[0];
  }

  const brahmosHtml = t.memberExpression(t.identifier('Brahmos'), t.identifier('html'));

  const taggedTemplate = t.taggedTemplateExpression(
    brahmosHtml,
    t.templateLiteral(strings, expressions),
  );

  const callExpression = t.callExpression(taggedTemplate, [getPartMetaStringLiteral(partsMeta)]);

  return callExpression;
}
