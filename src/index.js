import jsx from '@babel/plugin-syntax-jsx';

import getTaggedTemplate from './taggedTemplate';

function BabelPluginBrahmos (babel) {
  function visitorCallback (path) {
    const tagExpression = getTaggedTemplate(path);
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
