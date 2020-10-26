import { isHTMLElement } from './utils';

/**
 * Check if svg has a dynamic part either as attribute or node part
 */
export function isSvgHasDynamicPart(part) {
  let hasDynamicPart = false;

  const setDynamicPart = (path) => {
    hasDynamicPart = true;
    path.stop();
  };

  const jsxElementVisitor = (path) => {
    const { openingElement } = path.node;
    const tagName = openingElement.name.name;

    if (!isHTMLElement(tagName)) {
      setDynamicPart(path);
    }
  };

  part.traverse({
    JSXSpreadAttribute: setDynamicPart,
    JSXExpressionContainer: setDynamicPart,
    JSXElement: jsxElementVisitor,
  });

  return hasDynamicPart;
}
