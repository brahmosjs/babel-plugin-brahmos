import t from '@babel/types';
import { cleanStringForHtml, isHTMLElement } from './utils';
/**
 * We want to reduce the total bytes we send down the wire.
 * So convert undefined or -1 index to empty string
 */
function getSlimIndex(index) {
  return index === undefined || index === -1 ? '' : index;
}

// check if a node is valid element for templates static part
function isValidTemplateElement(node) {
  return t.isJSXText(node) || node.elementCounter !== undefined;
}

/**
 * Function to ignore fragment wrapping.
 * We ignore fragments as it doesn't add anything up in the template tag literals
 */
function getEffectiveNodePath(path) {
  while (t.isJSXFragment(path.parent)) {
    path = path.parentPath;
  }

  return path;
}

// function to get the effective children ignoring all the fragments
function flattenFragmentChildren(parent) {
  if (!parent.children) return [];
  const children = [];

  parent.children.forEach((node) => {
    // if it is a fragment recursively extract children of fragment
    // or else just push the children
    if (t.isJSXFragment(node)) {
      children.push(...flattenFragmentChildren(node));
    } else {
      children.push(node);
    }
  });

  return children;
}

/**
 * Convert parts meta to part code which can be consumed at runtime
 * to extract part information.
 *
 * The part code format looks like this
 * combinedBooleanCode|primaryIndex|secondaryIndex
 *
 * combinedBooleanCode -> 0 (part is attribute type), 1 (part is node type),
 * 2 (part is node type and has expression sibling)
 *
 * primaryIndex ->
 * If attribute type index of element in flattened array
 * If node type index of parent in flattened array
 *
 * secondaryIndex ->
 * If attribute type index of dynamic attribute
 * If node type index of previous sibling in flattened array
 */
export function getPartMetaStringLiteral(partsMeta) {
  const partsMetaWithShortKeys = partsMeta.map((part) => {
    const { isAttribute } = part;
    let combinedBooleanCode;

    if (isAttribute) {
      combinedBooleanCode = 0;
    } else {
      combinedBooleanCode = part.hasExpressionSibling ? 2 : 1;
    }

    const primaryIndex = getSlimIndex(part.refNodeIndex);

    const secondaryIndex = getSlimIndex(isAttribute ? part.attributeIndex : part.prevChildIndex);

    return `${combinedBooleanCode}|${primaryIndex}|${secondaryIndex}`;
  });
  return t.stringLiteral(partsMetaWithShortKeys.join());
}

// function to get the parent above the fragment wrap
export function getNonFragmentParent(path) {
  const effectivePath = getEffectiveNodePath(path);

  if (!isValidTemplateElement(effectivePath.parent)) return path.parent;

  return effectivePath.parent;
}

// get the previous sibling index wrt to native elements
export function getPreviousSiblingIndex(path) {
  const { node } = path;

  // Get the non fragment parent and flattened children for that
  const parent = getNonFragmentParent(path);
  const children = flattenFragmentChildren(parent);

  if (!children.length) return {};

  /**
   * On the children filter out empty strings and empty expression container
   * As those doesn't become part of the string literal
   */
  const validChildren = children.filter((node) => {
    if (t.isJSXText(node)) {
      const cleanStr = cleanStringForHtml(node.value);
      return !!cleanStr;
    } else if (t.isJSXEmptyExpression(node.expression)) {
      return false;
    }

    return true;
  });

  const nodeIndex = validChildren.indexOf(node);
  const prevSibling = validChildren[nodeIndex - 1];

  /**
   * check if prev sibling is expression node.
   * If it is a expression node we will be adding an empty text node between
   * So that the dynamic part lookup become faster
   */
  const hasExpressionSibling = !!prevSibling && !isValidTemplateElement(prevSibling);

  let prevChildIndex = -1;
  /**
   * if there are no consecutive expression node we don't have to count it for child index
   * as they are remove from the template tag we create.
   * But if there are consecutive expression nodes, we will have to count it for previous child index
   * as we add an empty text node in between, which will in result increase the count of
   * childNodes
   */
  for (let i = 0; i <= nodeIndex; i++) {
    /**
     * if its a valid template element or the last and current node is an expression node
     * we have count the node for getting the correct prevChildIndex
     */
    if (
      isValidTemplateElement(validChildren[i]) ||
      (i > 0 && !isValidTemplateElement(validChildren[i - 1]))
    ) {
      prevChildIndex += 1;
    }
  }

  return {
    prevChildIndex: prevChildIndex,
    hasExpressionSibling,
  };
}

// check if the node is native html element (static element)
function isHTMLNode(node) {
  if (!t.isJSXElement(node)) return false;
  const tagName = node.openingElement.name.name;

  /**
   * We treat svg element as non html node to find the wrapping
   * as svg can be converted into expression part
   */
  return isHTMLElement(tagName) && tagName !== 'svg';
}

function isRenderableText(node) {
  return t.isJSXText(node) && !!cleanStringForHtml(node.value);
}

/**
 * check if expression nodes are wrapped around text node, if it is than
 * we will have to add a placeholder comment node in between so both text does not combine
 * as single text node. If it does we will not be able locate dynamic node correctly.
 *
 * Plus we don't have to consider this extra comment node for prev child index as we will
 * remove the comment node in the runtime, and it will not affect the index of previous child
 * in childNode list.
 * Also comment nodes are not treated as element so it will not affect the flatten elements
 * of template.
 *
 * Note: We add only one placeholder if there are consecutive expression nodes between text nodes.
 */
export function isWrappedWithString(path) {
  const effectivePath = getEffectiveNodePath(path);
  const { parent, node } = effectivePath;
  const children = flattenFragmentChildren(parent);

  let nodeIndex = children.indexOf(node);
  const prevNode = children[nodeIndex - 1];

  if (!(prevNode && isRenderableText(prevNode))) return false;

  /**
   * If we have consecutive expression nodes we have to ignore expression node and
   * keep checking on the right to figure out if the expressions are wrapped with text
   */
  let nextNode;
  while ((nextNode = children[nodeIndex + 1])) {
    if (isRenderableText(nextNode)) {
      return true;
    } else if (t.isJSXExpressionContainer(nextNode) || !isHTMLNode(nextNode)) {
      nodeIndex += 1;
    } else {
      return false;
    }
  }

  return prevNode && nextNode && isRenderableText(prevNode) && isRenderableText(nextNode);
}
