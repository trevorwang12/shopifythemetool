import {
  AbsolutePath,
  NamedTags,
  NodeTypes,
  RootRelativePath,
  toLiquidAST as parseLiquid,
} from '@shopify/liquid-html-parser';
import { SourceCodeType, Visitor, visit } from '@shopify/theme-language-server-common';
import { assertNever, getFiles, isInDirectory, isTemplateFile, posixPath, unique } from './utils';
// import { parse as parseJS } from '@swc/core';
// import parseJson from 'json-to-ast';

export interface Dependencies {
  readFile: (path: string) => Promise<string>;
  join: (...paths: string[]) => string;
  extname: (path: string) => string;
}

export interface ThemeGraph {
  entryPoints: ThemeModule[];
  modules: Record<AbsolutePath, ThemeModule>;
  root: string;
}

export interface IThemeModule<T extends ModuleType, DepT = ThemeModule, ParentT = ThemeModule> {
  /** Used as a discriminant in the ThemeNode union */
  type: T;

  /**
   * The absolutePath should be normalized and absolute so that they can
   * be used as indexes.
   */
  path: RootRelativePath; // Used as key. Important to be unique.

  /** Record of other modules this module depends on (e.g. import statements, render snippet, etc.) */
  dependencies: Record<AbsolutePath, DepT>;

  /** Record of other modules that this module is required by */
  parents: Record<AbsolutePath, ParentT>;
}

export enum ModuleType {
  Liquid = 'Liquid',
  JavaScript = 'JavaScript',
  Json = 'JSON',
  Css = 'CSS',
}

export enum JsonModuleKind {
  /** templates/*.json files */
  Template = 'template',

  /** sections/*.json files */
  SectionGroup = 'section-group',
}

export enum LiquidModuleKind {
  /** layout/*.liquid files */
  Layout = 'layout',

  /** sections/*.liquid files */
  Section = 'section',

  /** blocks/*.liquid files */
  Block = 'block',

  /** snippets/*.liquid files */
  Snippet = 'snippet',

  /** templates/*.liquid files (forgot those existed...) */
  Template = 'template',
}

export interface LiquidModule extends IThemeModule<ModuleType.Liquid> {
  kind: LiquidModuleKind;
}

export interface JsonModule extends IThemeModule<ModuleType.Json> {
  kind: JsonModuleKind;
}

/**
 * JS Modules can only have JS deps
 * JS Modules can only be required by Liquid or JS files
 */
export interface JavaScriptModule
  extends IThemeModule<ModuleType.JavaScript, JavaScriptModule, JavaScriptModule | LiquidModule> {
  kind: 'unused';
}

/**
 * CSS Modules can only have CSS deps
 * CSS Modules can only be required by Liquid or CSS files
 */
export interface CssModule extends IThemeModule<ModuleType.Css, CssModule | LiquidModule> {
  kind: 'unused';
}

export type ThemeModule = LiquidModule | JsonModule | JavaScriptModule | CssModule;

export interface SerializableEdge {
  source: AbsolutePath;
  target: AbsolutePath;
}

export type SerializableNode = Pick<ThemeModule, 'path' | 'type' | 'kind'>;

export interface SerializableGraph {
  nodes: SerializableNode[];
  edges: SerializableEdge[];
}

export function serializeThemeGraph(graph: ThemeGraph): SerializableGraph {
  const nodes: SerializableNode[] = Object.values(graph.modules).map((module) => ({
    path: module.path,
    type: module.type,
    kind: module.kind,
  }));

  const edges: SerializableEdge[] = Object.values(graph.modules).flatMap((module) => {
    return Object.values(module.dependencies).map((dep) => ({
      source: module.path,
      target: dep.path,
    }));
  });

  return {
    nodes,
    edges,
  };
}

export async function buildThemeGraph(root: string, dependencies: Dependencies) {
  root = posixPath(root);
  // It starts with a template actually
  const files = await getFiles(root);
  const entryPoints: RootRelativePath[] = files.filter((file) => isInDirectory(file, 'templates'));
  const themeGraph: ThemeGraph = {
    entryPoints: [],
    modules: {},
    root,
  };

  themeGraph.entryPoints = entryPoints.map((entry) =>
    templateModule(themeGraph, entry, dependencies),
  );

  await Promise.all(
    themeGraph.entryPoints.map((entry) => traverseModule(entry, themeGraph, dependencies)),
  );

  return themeGraph;
}

export function templateModule(
  themeGraph: ThemeGraph,
  path: RootRelativePath,
  dependencies: Dependencies,
): ThemeModule {
  if (themeGraph.modules[path]) {
    return themeGraph.modules[path];
  }

  const extension = dependencies.extname(path).slice(1);
  switch (extension) {
    case 'json': {
      return {
        type: ModuleType.Json,
        kind: JsonModuleKind.Template,
        dependencies: {},
        parents: {},
        path,
      };
    }

    case 'liquid': {
      return {
        type: ModuleType.Liquid,
        kind: LiquidModuleKind.Template,
        dependencies: {},
        parents: {},
        path,
      };
    }

    default: {
      throw new Error(`Unknown template type for ${path}`);
    }
  }
}

export function sectionModule(
  themeGraph: ThemeGraph,
  sectionType: string,
  dependencies: Dependencies,
): LiquidModule {
  const path = dependencies.join('sections', `${sectionType}.liquid`);
  if (themeGraph.modules[path]) {
    return themeGraph.modules[path] as LiquidModule;
  }

  return {
    type: ModuleType.Liquid,
    kind: LiquidModuleKind.Section,
    dependencies: {},
    parents: {},
    path,
  };
}

export function sectionGroupModule(
  themeGraph: ThemeGraph,
  sectionGroupType: string,
  dependencies: Dependencies,
): JsonModule {
  const path = dependencies.join('sections', `${sectionGroupType}.json`);
  if (themeGraph.modules[path]) {
    return themeGraph.modules[path] as JsonModule;
  }

  return {
    type: ModuleType.Json,
    kind: JsonModuleKind.SectionGroup,
    dependencies: {},
    parents: {},
    path,
  };
}

export function assetModule(
  themeGraph: ThemeGraph,
  asset: string,
  dependencies: Dependencies,
): JavaScriptModule | CssModule | undefined {
  // return undefined;
  const extension = dependencies.extname(asset).slice(1);
  switch (extension) {
    case 'js': {
      const path = dependencies.join('assets', asset);
      if (themeGraph.modules[path]) {
        return themeGraph.modules[path] as JavaScriptModule;
      }

      return {
        type: ModuleType.JavaScript,
        kind: 'unused',
        dependencies: {},
        parents: {},
        path,
      };
    }

    case 'css': {
      const path = dependencies.join('assets', asset);
      if (themeGraph.modules[path]) {
        return themeGraph.modules[path] as CssModule;
      }

      return {
        type: ModuleType.Css,
        kind: 'unused',
        dependencies: {},
        parents: {},
        path,
      };
    }

    default: {
      return undefined;
    }
  }
}

export function snippetModule(
  themeGraph: ThemeGraph,
  snippet: string,
  dependencies: Dependencies,
): LiquidModule {
  const relativePath = dependencies.join('snippets', `${snippet}.liquid`);
  if (themeGraph.modules[relativePath]) {
    return themeGraph.modules[relativePath] as LiquidModule;
  }
  return {
    type: ModuleType.Liquid,
    kind: LiquidModuleKind.Snippet,
    path: relativePath,
    dependencies: {},
    parents: {},
  };
}

export function layoutModule(
  themeGraph: ThemeGraph,
  layoutName: string = 'theme',
  dependencies: Dependencies,
): LiquidModule {
  const relativePath = dependencies.join('layout', `${layoutName}.liquid`);
  if (themeGraph.modules[relativePath]) {
    return themeGraph.modules[relativePath] as LiquidModule;
  }

  return {
    type: ModuleType.Liquid,
    kind: LiquidModuleKind.Layout,
    path: relativePath,
    dependencies: {},
    parents: {},
  };
}

export type Void = void | Void[];

async function traverseModule(
  module: ThemeModule,
  themeGraph: ThemeGraph,
  dependencies: Dependencies,
): Promise<Void> {
  if (themeGraph.modules[module.path]) {
    return;
  }

  themeGraph.modules[module.path] = module;

  switch (module.type) {
    case ModuleType.Liquid: {
      return traverseLiquidModule(module, themeGraph, dependencies);
    }

    case ModuleType.Json: {
      return traverseJsonModule(module, themeGraph, dependencies);
    }

    case ModuleType.JavaScript: {
      return;
    }

    case ModuleType.Css: {
      return;
    }

    default: {
      return assertNever(module);
    }
  }
}

async function traverseJsonModule(
  module: JsonModule,
  themeGraph: ThemeGraph,
  dependencies: Dependencies,
): Promise<Void> {
  const absolutePath = dependencies.join(themeGraph.root, module.path);
  const json = await dependencies.readFile(absolutePath).then((content) => JSON.parse(content));
  switch (module.kind) {
    case JsonModuleKind.Template: {
      const sections = Object.values(json.sections ?? {});
      const sectionTypes: string[] = unique(
        sections.map((section: any) => section?.type).filter(isString),
      );
      const sectionModules = sectionTypes.map((sectionType) =>
        sectionModule(themeGraph, sectionType, dependencies),
      );
      const layout = layoutModule(themeGraph, json.layout, dependencies);
      const childModules = [layout, ...sectionModules];

      for (const child of childModules) {
        bind(module, child);
      }

      return Promise.all(
        childModules.map((section) => traverseModule(section, themeGraph, dependencies)),
      );
    }

    case JsonModuleKind.SectionGroup: {
      const sections = Object.values(json.sections ?? {});
      const sectionTypes: string[] = unique(
        sections.map((section: any) => section?.type).filter(isString),
      );
      const childModules = sectionTypes.map((sectionType) =>
        sectionModule(themeGraph, sectionType, dependencies),
      );

      for (const child of childModules) {
        bind(module, child);
      }

      return Promise.all(
        childModules.map((section) => traverseModule(section, themeGraph, dependencies)),
      );
    }

    default: {
      return assertNever(module.kind);
    }
  }
}

async function traverseLiquidModule(
  module: LiquidModule,
  themeGraph: ThemeGraph,
  dependencies: Dependencies,
) {
  const absolutePath = dependencies.join(themeGraph.root, module.path);
  const content = await dependencies.readFile(absolutePath);
  const ast = parseLiquid(content, { allowUnclosedDocumentNode: true, mode: 'tolerant' });
  const visitor: Visitor<SourceCodeType.LiquidHtml, ThemeModule> = {
    LiquidFilter: (node, ancestors) => {
      if (node.name === 'asset_url') {
        const parentNode = ancestors[ancestors.length - 1]!;
        if (parentNode.type !== NodeTypes.LiquidVariable) return;
        if (parentNode.expression.type !== NodeTypes.String) return;
        if (parentNode.filters[0] !== node) return;
        const asset = parentNode.expression.value;
        return assetModule(themeGraph, asset, dependencies);
      }
    },

    RenderMarkup: (node) => {
      const snippet = node.snippet;
      if (!isString(snippet) && snippet.type === NodeTypes.String) {
        return snippetModule(themeGraph, snippet.value, dependencies);
      }
    },

    LiquidTag: (node) => {
      switch (node.name) {
        case NamedTags.sections: {
          if (!isString(node.markup)) {
            const sectionGroupType = node.markup.value;
            return sectionGroupModule(themeGraph, sectionGroupType, dependencies);
          }
        }
        case NamedTags.section: {
          if (!isString(node.markup)) {
            const sectionType = node.markup.value;
            return sectionModule(themeGraph, sectionType, dependencies);
          }
        }
      }
    },
  };

  const modules = visit(ast, visitor);

  for (const childModule of modules) {
    bind(module, childModule);
  }

  return Promise.all(modules.map((mod) => traverseModule(mod, themeGraph, dependencies)));

  // switch (module.kind) {
  //   case LiquidModuleKind.Layout: {
  //     return;
  //   }

  //   case LiquidModuleKind.Section: {
  //     return;
  //   }

  //   case LiquidModuleKind.Block: {
  //     return;
  //   }

  //   case LiquidModuleKind.Snippet: {
  //     return;
  //   }

  //   case LiquidModuleKind.Template: {
  //     return;
  //   }

  //   default: {
  //     return assertNever(module.kind);
  //   }
  // }
}

export function bind(parent: ThemeModule, child: ThemeModule) {
  parent.dependencies[child.path] = child;
  child.parents[parent.path] = parent;
}

function isString(x: unknown): x is string {
  return typeof x === 'string';
}
