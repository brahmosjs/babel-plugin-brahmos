import jsx from '@babel/plugin-syntax-jsx';

import getTaggedTemplate from './taggedTemplate';
import { addBrahmosRuntime } from './utils';

function BabelPluginBrahmos(babel) {
  function visitorCallback(path) {
    // add import on body if not present
    const programPath = path.findParent((path) => path.isProgram());

    if (!programPath.hasBrahmosRuntime) {
      addBrahmosRuntime(programPath);
    }

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
