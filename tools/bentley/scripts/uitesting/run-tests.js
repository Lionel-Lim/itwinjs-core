/*---------------------------------------------------------------------------------------------
|  $Copyright: (c) 2018 Bentley Systems, Incorporated. All rights reserved. $
 *--------------------------------------------------------------------------------------------*/
const fs = require("fs");
const path = require("path");
const utils = require("./utils");
const yargs = require("yargs").argv;
const chokidar = require("chokidar");
const Mocha = utils.cwdRequire("mocha");

const options = {
  testsDir: path.resolve(yargs.testsDir || "./"), // the directory where test files are located
  repeat: yargs.repeat || 1, // number of times the tests run should be repeated
  watch: yargs.watch || false, // watch for test and source files and re-run tests on changes
  timeoutsEnabled: yargs.noTimeouts || true, // measure tests' coverage
  coverage: yargs.coverage || false, // create test coverage report
  report: yargs.report || false, // create test run report
  extensions: [".ts", ".tsx"], // source file extensions
};
const testsName = path.basename(path.resolve("./"));

process.env.TS_NODE_PROJECT = path.join(options.testsDir, "tsconfig.json");
process.env.TS_NODE_CACHE_DIRECTORY = `../../out/temp/test-caches/${testsName}/`;
process.env.CACHE_REQUIRE_PATHS_FILE = `../../out/temp/test-caches/${testsName}/cache-require-paths.json`;

utils.ensureDirectoryExists(path.dirname(process.env.CACHE_REQUIRE_PATHS_FILE));
require('cache-require-paths');

let extensionsRegistered = false;
const registerExtensions = () => {
  if (!extensionsRegistered) {
    require("ts-node/register");
    require("tsconfig-paths/register");
    require("source-map-support/register");
    require("jsdom-global/register");
    require("ignore-styles");
    extensionsRegistered = true;
  }
};
if (!options.coverage)
  registerExtensions();

const shouldRecurseIntoDirectory = (directoryPath) => {
  return fs.lstatSync(directoryPath).isDirectory()
    && directoryPath !== "lib"
    && directoryPath !== "dist"
    && directoryPath !== "node_modules";
}

const requireLibModules = (dir) => {
  const files = fs.readdirSync(dir);
  files.map((fileName) => path.join(dir, fileName)).filter(shouldRecurseIntoDirectory).forEach((filePath) => {
    requireLibModules(filePath);
  });
  files.filter((fileName) => {
    return options.extensions.some((ext) => fileName.endsWith(ext) && !fileName.endsWith(".test" + ext));
  }).forEach((fileName) => {
    const requirePath = path.resolve(dir, path.basename(fileName));
    require(requirePath);
  });
};

const getTestFiles = () => {
  const testFiles = [];
  const addFilesRecursively = (dir) => {
    const files = fs.readdirSync(dir).map((fileName) => path.join(dir, fileName));
    files.filter(shouldRecurseIntoDirectory).forEach((filePath) => {
      addFilesRecursively(filePath);
    });
    files.filter((filePath) => {
      return options.extensions.some((ext) => filePath.endsWith(ext));
    }).forEach((filePath) => {
      testFiles.push(filePath);
    });
  };
  addFilesRecursively(options.testsDir);
  return testFiles;
};

const clearTestFilesCache = () => {
  getTestFiles().forEach((file) => {
    delete require.cache[require.resolve(path.resolve(file))];
  });
};

const setupReporter = (mocha) => {
  let reporter = "spec";
  let reporterOptions = undefined;
  if (options.coverage) {
    reporter = "mocha-tldr-reporter";
  } else if (options.watch) {
    reporter = "min";
  }
  if (options.report) {
    reporterOptions = {
      reporterEnabled: `mocha-junit-reporter, ${reporter}`,
      mochaJunitReporterReporterOptions: {
        mochaFile: `../../out/reports/tests/results.${testsName}.xml`,
      },
    };
    reporter = "mocha-multi-reporters";
  }
  return mocha.reporter(reporter, reporterOptions);
}

const runOnce = () => {
  if (options.coverage) {
    requireLibModules("./src/");
  }
  let mocha = new Mocha({
    ui: "bdd",
  });
  mocha = setupReporter(mocha)
    .timeout(10 * 60 * 1000) // 10 minutes
    .enableTimeouts(options.timeoutsEnabled)
    .ignoreLeaks(false)
    .useColors(true)
    .fullTrace();
  mocha.addFile(path.resolve(__dirname, "setup-tests.js"));
  getTestFiles().forEach((file) => {
    mocha.addFile(file);
  });

  return new Promise((resolve, reject) => {
    mocha.run((failures) => {
      if (failures)
        reject();
      else
        resolve();
    });
  });
};

let current = Promise.resolve();
const run = () => {
  let chain = current;
  for (let i = 0; i < options.repeat; ++i) {
    chain = chain.then(() => {
      clearTestFilesCache();
      if (options.repeat > 1)
        console.log(`Starting test iteration #${i + 1}`);
      return runOnce();
    });
  }
  chain = chain.catch((err) => {
    if (options.watch)
      return;
    if (err)
      console.log(err);
    process.exit(1);
  });
  current = chain;
};

run();

if (options.watch) {
  const watchPaths = [];
  options.extensions.forEach((ext) => watchPaths.push("./src/**/*" + ext));
  options.extensions.forEach((ext) => watchPaths.push("./tests/**/*" + ext));
  const watcher = chokidar.watch(watchPaths, {
    ignored: ["**/node_modules/**", "**/lib/**, **/dist/**"],
    ignoreInitial: true,
    awaitWriteFinish: {
      stabilityThreshold: 200,
    },
  });
  watcher.on("all", (evt, filePath) => {
    // wip: might want to make this part smarter to only re-run affected tests
    // un-cache the changed file
    delete require.cache[require.resolve(path.resolve("./", filePath))];
    // un-cache the "setup-tests" file
    delete require.cache[require.resolve(path.resolve(__dirname, "setup-tests.js"))];
    // un-cache all test files
    clearTestFilesCache();
    // re-run the tests
    run();
  });
}
