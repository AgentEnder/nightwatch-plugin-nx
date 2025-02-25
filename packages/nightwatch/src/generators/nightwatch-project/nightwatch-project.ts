import {
  addDependenciesToPackageJson,
  addProjectConfiguration,
  convertNxGenerator,
  formatFiles,
  generateFiles,
  getWorkspaceLayout,
  joinPathFragments,
  logger,
  names,
  offsetFromRoot,
  ProjectConfiguration,
  readProjectConfiguration,
  stripIndents,
  toJS,
  Tree,
  updateJson,
} from '@nrwl/devkit';
import { Linter, lintProjectGenerator } from '@nrwl/linter';
import { runTasksInSerial } from '@nrwl/workspace/src/utilities/run-tasks-in-serial';
import { getRelativePathToRootTsConfig } from '@nrwl/workspace/src/utilities/typescript';

import { join } from 'path';
import { installedNightwatchVersion } from '../../utils/nightwatch-version';
import { filePathPrefix } from '../../utils/project-name';
import {
  nightwatchVersion as nightwatchVersion,
  typesNodeVersion as typesNodeVersion,
  typesNightwatchVersion as typesNightwatchVersion,
} from '../../utils/versions';
// app
import { Schema } from './schema';

export interface NightwatchProjectSchema extends Schema {
  projectName: string;
  projectRoot: string;
}

function createFiles(tree: Tree, options: NightwatchProjectSchema) {
  const nightwatchVersion = installedNightwatchVersion();
  const nightwatchFiles = "v2"

  generateFiles(
    tree,
    join(__dirname, './files', nightwatchFiles),
    options.projectRoot,
    {
      tmpl: '',
      ...options,
      project: options.project || 'Project',
      ext: options.js ? 'js' : 'ts',
      offsetFromRoot: offsetFromRoot(options.projectRoot),
      rootTsConfigPath: getRelativePathToRootTsConfig(
        tree,
        options.projectRoot
      ),
    }
  );

  if (nightwatchVersion && nightwatchVersion < 7) {
    updateJson(tree, join(options.projectRoot, 'nightwatch.conf.js'), (json) => {
      json.pluginsFile = './src/plugins/index';
      return json;
    });
  } else if (nightwatchVersion < 10) {
    const pluginPath = join(options.projectRoot, 'src/plugins/index.js');
    if (tree.exists(pluginPath)) {
      tree.delete(pluginPath);
    }
  }

  if (options.js) {
    toJS(tree);
  }
}

function addProject(tree: Tree, options: NightwatchProjectSchema) {
  let e2eProjectConfig: ProjectConfiguration;

  const detectedNighwatchVersion = installedNightwatchVersion() ?? nightwatchVersion;

  const nightwatchConfig = 'nightwatch.conf.js';

  if (options.baseUrl) {
    e2eProjectConfig = {
      root: options.projectRoot,
      sourceRoot: joinPathFragments(options.projectRoot, 'src'),
      projectType: 'application',
      targets: {
        e2e: {
          executor: '@nightwatch/nx:nightwatch',
          options: {
            nightwatchConfig: joinPathFragments(
              options.projectRoot,
              nightwatchConfig
            ),
            baseUrl: options.baseUrl,
          },
        },
      },
      tags: [],
      implicitDependencies: options.project ? [options.project] : undefined,
    };
  } else if (options.project) {
    const project = readProjectConfiguration(tree, options.project);

    if (!project.targets) {
      logger.warn(stripIndents`
      NOTE: Project, "${options.project}", does not have any targets defined and a baseUrl was not provided. Nx will use
      "${options.project}:serve" as the devServerTarget. But you may need to define this target within the project, "${options.project}".
      `);
    }
    const devServerTarget =
      project.targets?.serve && project.targets?.serve?.defaultConfiguration
        ? `${options.project}:serve:${project.targets.serve.defaultConfiguration}`
        : `${options.project}:serve`;
    e2eProjectConfig = {
      root: options.projectRoot,
      sourceRoot: joinPathFragments(options.projectRoot, 'src'),
      projectType: 'application',
      targets: {
        e2e: {
          executor: '@nightwatch/nx:nightwatch',
          options: {
            nightwatchConfig: joinPathFragments(
              options.projectRoot,
              nightwatchConfig
            ),
            devServerTarget,
          },
          configurations: {
            production: {
              devServerTarget: `${options.project}:serve:production`,
            },
          },
        },
      },
      tags: [],
      implicitDependencies: options.project ? [options.project] : undefined,
    };
  } else {
    throw new Error(`Either project or baseUrl should be specified.`);
  }

  if (detectedNighwatchVersion < 7) {
    e2eProjectConfig.targets.e2e.options.tsConfig = joinPathFragments(
      options.projectRoot,
      'tsconfig.json'
    );
  }
  addProjectConfiguration(
    tree,
    options.projectName,
    e2eProjectConfig,
    options.standaloneConfig
  );
}

export async function updateDependencies(tree: Tree) {
  return addDependenciesToPackageJson(
    tree,
    {},
    {
      nightwatch: nightwatchVersion,
      '@types/node': typesNodeVersion,
      '@types/nightwatch': typesNightwatchVersion,
    }
  );
}

export async function nightwatchProjectGenerator(host: Tree, schema: Schema) {
  const options = normalizeOptions(host, schema);
  const installTask = await updateDependencies(host);
  createFiles(host, options);
  addProject(host, options);
  if (!options.skipFormat) {
    await formatFiles(host);
  }
  return !options.skipPackageJson ? () => { installTask() } : () => { };
}

function normalizeOptions(host: Tree, options: Schema): NightwatchProjectSchema {
  const { appsDir } = getWorkspaceLayout(host);
  const projectName = filePathPrefix(
    options.directory ? `${options.directory}-${options.name}` : options.name
  );
  const projectRoot = options.directory
    ? joinPathFragments(
      appsDir,
      names(options.directory).fileName,
      options.name
    )
    : joinPathFragments(appsDir, options.name);

  options.linter = options.linter || Linter.EsLint;
  return {
    ...options,
    projectName,
    projectRoot,
  };
}

export default nightwatchProjectGenerator;
export const nightwatchProjectSchematic = convertNxGenerator(
  nightwatchProjectGenerator
);
