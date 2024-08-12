import { LiquidCheckDefinition, Severity, SourceCodeType } from '../../types';

export const ConsolidateClassList: LiquidCheckDefinition = {
  meta: {
    name: 'Consolidate Class List',
    code: 'ConsolidateClassList',
    severity: Severity.INFO,
    type: SourceCodeType.LiquidHtml,
    docs: {
      description: 'This',
      recommended: true,
      //   to fill out
      url: undefined,
    },
    schema: {},
    targets: [],
  },

  create(context) {
    return {
      async HtmlElement(node) {
        const attributes = node.attributes;
        attributes.forEach((attribute) => {
          // type narrowing
          switch (attribute.type) {
            case 'AttrDoubleQuoted':
              const values = attribute.value.filter(
                (value) => value.type == 'LiquidVariableOutput',
              );
              // const markupValues = values.map((value) => value.markup);
              const x = '234';
            default:
              return;
          }
          const x = '1234';
        });

        // const substr = node.source.substring(node.position.start, node.position.end);
        // const liquidVariables = node.attributes.filter((attributes) => {});
        context.report({
          message: 'hello',
          startIndex: node.blockStartPosition.start,
          endIndex: node.blockStartPosition.end,
        });
      },
      // as we go through each node, we can check if the node has class attribute
      // check if all options in class_list are present (hardcode this for now)
      // if all are present in the same theme, then we want to raise somethin
    };
  },
};
