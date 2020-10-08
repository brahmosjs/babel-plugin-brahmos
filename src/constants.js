import SVG_ATTRIBUTE_MAP from './svgAttributeMap';

export { SVG_ATTRIBUTE_MAP };

export const BRAHMOS_PLACEHOLDER = '{{brahmos}}';

export const RESERVED_ATTRIBUTES = {
  key: 1,
  ref: 1,
};

export const SELF_CLOSING_TAGS = [
  'area',
  'base',
  'br',
  'col',
  'embed',
  'hr',
  'img',
  'input',
  'link',
  'meta',
  'param',
  'source',
  'track',
  'wbr',
];

export const PROPERTY_ATTRIBUTE_MAP = {
  className: 'class',
  htmlFor: 'for',
  acceptCharset: 'accept-charset',
  httpEquiv: 'http-equiv',
  ...SVG_ATTRIBUTE_MAP,
};
