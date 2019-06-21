const jsx = require('@babel/plugin-syntax-jsx').default;

const RESERVED_ATTRIBUTES = {
  key: 1,
  ref: 1,
};

/**
 * Method to remove newlines and extra spaces which does not render on browser
 * Logic taken from
 * https://github.com/babel/babel/blob/master/packages/babel-types/src/utils/react/cleanJSXElementLiteralChild.js
 */
function cleanStringForHtml (rawStr) {
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
function isHTMLElement (tagName) {
  // Must start with a lowercase ASCII letter
  return !!tagName && /^[a-z]/.test(tagName);
};

const propertyToAttrMap = {
  'className': 'class',
  'htmlFor': 'for',
};

function needsToBeExpression (tagName, attrName) {
  /**
   * TODO: No need to change value attribute of a checkbox or radio button.
   */
  const tags = ['input', 'select', 'textarea'];
  const attributes = ['value', 'defaultValue', 'checked', 'defaultChecked'];
  return RESERVED_ATTRIBUTES[attrName] || (tags.includes(tagName) && attributes.includes(attrName));
}

/** Check if a template literal is an empty wrap for single expression */
function isEmptyLiteralWrap (strings) {
  const emptyStrings = strings.filter((strNode) => !strNode.value.raw);
  return strings.length === 2 && emptyStrings.length === 2;
}

function BabelPluginBrahmos (babel) {
  const { types: t } = babel;

  function getTaggedTemplateCallExpression (node) {
    const { strings, expressions } = getLiteralParts(node);

    /**
     * we do not need a tagged expression if there is a single expression and two empty string part
     * In that case we can just return the expression
     */
    if (expressions.length === 1 && isEmptyLiteralWrap(strings)) {
      return expressions[0];
    }

    const brahmosHtml = t.memberExpression(t.identifier('Brahmos'), t.identifier('html'));

    const taggedTemplate = t.taggedTemplateExpression(brahmosHtml, t.templateLiteral(strings, expressions));
    const callExpression = t.callExpression(taggedTemplate, []);
    return callExpression;
  }

  function getLiteralParts (rootNode, strings = [], expressions = [], stringPart = []) {
    function pushToStrings (tail) {
      const string = stringPart.join('');
      strings.push(t.templateElement({ raw: string, cooked: string }, tail));
      stringPart = [];
    }

    function pushToExpressions (expression) {
      pushToStrings();
      expressions.push(expression);
    }

    function createAttributeExpression (name, value) {
      return t.objectExpression([createObjectProperty(name, value)]);
    }

    function createObjectProperty (name, value) {
      value = value || t.booleanLiteral(true); // if value is not present it means the prop is of boolean type with true value
      const propName = t.identifier(name.name);
      const propValue = t.isJSXExpressionContainer(value) ? value.expression : value;
      return t.objectProperty(propName, propValue, false, propName.name === propValue.name);
    }

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

    function pushAttributeToExpressions (expression, lastExpression) {
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

      pushToExpressions(expression);

      // keep space after expressions
      stringPart.push(' ');

      return expression;
    }

    function recurseNode (node) {
      if (t.isJSXElement(node)) {
        const { openingElement, children } = node;
        const { attributes, name } = openingElement;
        const tagName = name.name;

        if (isHTMLElement(tagName)) {
          // Handle opening tag
          stringPart.push(`<${tagName} `);

          /**
           * Keep the reference of last dynamic expression so we can add it to same object,
           * instead of creating new expression for each attributes
           */
          let lastExpression = null;

          // push all attributes to opening tag
          attributes.forEach(attribute => {
            // if we encounter spread attribute, push the argument as expression
            if (t.isJSXSpreadAttribute(attribute)) {
              lastExpression = pushAttributeToExpressions(attribute.argument, lastExpression);
            } else {
              const { name, value } = attribute;
              let attrName = name.name;

              /**
               * check if the attribute should go as expression or the value is and actual expression
               * then push it to expression other wise push it as string part
               */

              if (needsToBeExpression(tagName, attrName) || t.isJSXExpressionContainer(value)) {
                const expression = createAttributeExpression(name, value);
                lastExpression = pushAttributeToExpressions(expression, lastExpression);
              } else {
              /**
               * Check if attrName needs to be changed, to form html attribute like className -> class
               * Change the property name only if the value is string type so at comes along with
               * string part. In case of value is expression we don't need to do it
               */
                attrName = propertyToAttrMap[attrName] || attrName;
                stringPart.push(` ${attrName}${value ? `="${value.value}" ` : ''}`);

                // reset the lastExpression value, as static part comes between two dynamic parts
                lastExpression = null;
              }
            }
          });

          stringPart.push('>');

          // handle children
          children.forEach(child => {
            recurseNode(child);
          });

          // handle closing tag
          stringPart.push(`</${tagName}>`);
        } else {
          const componentName = name;

          // add props
          const props = [];
          attributes.forEach(attribute => {
            if (t.isJSXSpreadAttribute(attribute)) {
              props.push(t.spreadElement(attribute.argument));
            } else {
              const { name, value } = attribute;
              props.push(createObjectProperty(name, value));
            }
          });

          const createElementArguments = [
            jsxToObject(componentName),
            t.objectExpression(props),
          ];

          if (children && children.length) {
            createElementArguments.push(getTaggedTemplateCallExpression(children));
          }

          const brahmosCreateElement = t.memberExpression(t.identifier('Brahmos'), t.identifier('createElement'));
          const expression = t.callExpression(brahmosCreateElement, createElementArguments);

          pushToExpressions(expression);
        }
      } else if (t.isJSXText(node)) {
        const cleanStr = cleanStringForHtml(node.value);
        if (cleanStr) stringPart.push(cleanStr);
      } else if (t.isJSXExpressionContainer(node) && !t.isJSXEmptyExpression(node.expression)) {
        pushToExpressions(node.expression);
      } else if (Array.isArray(node)) {
        node.forEach((nodeItem) => recurseNode(nodeItem));
      } else if (t.isJSXFragment(node)) {
        node.children.forEach((nodeItem) => recurseNode(nodeItem));
      }
    }

    recurseNode(rootNode);

    // add the last template element
    pushToStrings(true);

    return {
      strings,
      expressions,
    };
  }

  function visitorCallback (path) {
    const { node } = path;
    const tagExpression = getTaggedTemplateCallExpression(node);
    path.replaceWith(tagExpression);
  }

  return {
    name: 'brahmos',
    inherits: jsx,
    visitor: {
      JSXElement: visitorCallback,
      JSXFragment: visitorCallback,
    },
  };
}

module.exports = BabelPluginBrahmos;
