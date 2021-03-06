import { exec, spawn } from "child_process";
import { createReadStream, createWriteStream, copyFile, existsSync, mkdir } from "fs";
import { join, extname, dirname } from "path";
import { streamEdit } from "../src/index.mjs";
import { root_directory } from "./helpers/__dirname.mjs";

/**
 * config
 */
const destination = join(root_directory, "./build");

const sourcePath = join(root_directory, "./src");
const sources =     [
  "./index.mjs", "./streams.mjs", "./transform.mjs", "./helpers.mjs",
  "./rw-stream/index.mjs", "./index.d.ts"
];

const testPath = join(root_directory, "./test");
const tmpTestDestination = join(root_directory, "./test.tmp");
const tests   = [
  "test.mjs", "gbk.txt", "./netflix/domain.yaml", "./netflix/IP.yaml",
  "../examples/helpers/process-files.mjs", "./readable-object-mode.ndjson",
  "test-regex.mjs"
];

const testCommand = "mocha";
const testArgs = [ tmpTestDestination ];

const mjs = {
  from:  ".mjs",
  toCJS: ".js",
  toMJS: ".mjs",
  toCJSTest: ".js",
};

const replacements = { 
  srcReplace: [

  ],
  testReplace: [
    {
      match: matchParentFolderImport(/(src\/(.+?))/),
      replacement: "build/$2",
      isFullReplacement: false
    },
    {
      match: matchCurrentFolderImport(`((.+?)${mjs.from.replace(".", "\\.")})`),
      replacement: "$2".concat(mjs.toCJSTest),
      isFullReplacement: false
    },
    {
      match: /\r?\n?const\s+__dirname\s+=\s+dirname\(\s*fileURLToPath\(\s*import\.meta\.url\s*\)\s*\);?\r?\n?/,
      replacement: "",
      isFullReplacement: true
    }
  ],
  commonReplace: [
    // add "use strict"
    {
      match: /^().*(\r?\n)/,
      replacement: `"use strict";$2`,
      isFullReplacement: false,
      maxTimes: 1
    },
    // replace import subfix
    {
      match: matchImport(`((.+?)${mjs.from.replace(".", "\\.")})`),
      replacement: "$2".concat(mjs.toCJS),
      isFullReplacement: false
    },
    // replace dynamic import subfix
    {
      search: matchDynamicImport(`['"]((.+?)${mjs.from.replace(".", "\\.")})['"]`),
      replacement: "$2".concat(mjs.toCJS),
      isFullReplacement: false
    },
    // `:` in import name 
    { 
      search: matchImport(/(.+?)/),
      replacement: moduleName => {
        const parts = moduleName.split(":");
        if(parts.length === 1) {
          return moduleName;
        } else if(parts.length === 2 && parts[0] === "node") {
          return parts[1];
        } else {
          console.error(`Unrecognized prefix '${
            parts.slice(0, parts.length - 1).join(":")
          }:' for ${moduleName}`);

          return moduleName;
        }
      },
      isFullReplacement: false
    },
    // default import
    { 
      search: /(?<!`)import\s+([^{}]+?)\s+from\s*['"](.+?)['"];?/,
      replacement: (wholeMatch, $1, $2) => {
        // debugger;
        return `const ${$1} = require("${$2}");`
      } ,
      isFullReplacement: true
    },
    // named import with or without renaming
    { 
      search: /(?<!`)import\s+\{\s*(.+?)\s*\}\s+from\s*['"](.+?)['"];?/,
      replacement: (wholeMatch, namedImports, moduleName) => {
        namedImports = namedImports.replace(/\s+as\s+/g, ": ");
        return `const { ${namedImports} } = require("${moduleName}");`;
      },
      isFullReplacement: true
    },
    // named import plus default import
    { 
      search: /(?<!`)import\s+(.+?),\s*\{\s*(.+?)\s*\}\s+from\s*['"](.+?)['"];?[ \t]*(\r?\n)/,
      replacement: (wholeMatch, defaultImport, namedImports, moduleName, lineEnding) => {
        namedImports = namedImports.replace(/\s+as\s+/g, ": ");
        return [
          `const ${defaultImport} = require("${moduleName}");`,
          `const { ${namedImports} } = ${defaultImport};`
        ].join(lineEnding).concat(lineEnding);
      },
      isFullReplacement: true
    },
    // dynamic import
    {
      search: matchDynamicImport("(.+?)"),
      replacement:  (wholeMatch, $1) => {
        // debugger;
        return `require(${$1})`
      },
      isFullReplacement: true
    },
    // named export with or without renaming
    {
      search: /export\s*\{(.+?)\};?/,
      replacement: (wholeMatch, namedExports) => {
        namedExports = namedExports.replace(
          /(?<=[\s,]+)(.+?)\s+as\s+(.+?)(?=[\s,]+)/g,
          "$2: $1"
        );
        return `module.exports = { ${namedExports} };`;
      },
      isFullReplacement: true
    },
    // default export
    {
      search: /export\s*default/,
      replacement: "module.exports =",
      isFullReplacement: true
    },
    // exporting functions as individual features
    {
      search: /export\s+(async\s+)?function(\s+|\s*\*\s*)([^(\s{]+)/,
      replacement: (_, isAsync = "", isGenerator = "", functionName) => {
        return  `module.exports.${functionName} = ${functionName};\r\n${
          isAsync
        }function${isGenerator}${functionName}`;
      },
      isFullReplacement: true
    },
    // exporting class as individual features
    {
      search: /export\s+class\s+([^\s{]+)/,
      replacement: (_, className) => {
        return  `module.exports.${className} = class ${className}`;
      },
      isFullReplacement: true
    }
  ]
};

const stripAnsiRegEx = /[\u001b\u009b][[()#;?]*(?:[0-9]{1,4}(?:;[0-9]{0,4})*)?[0-9A-ORZcf-nqry=><]/g;
const testResults = [];
const onTestData = chunk => testResults.push(chunk.toString().replace(stripAnsiRegEx, ""));

const then = () => Promise.all([
  new Promise((resolve, reject) => {
    if(process.argv[2] !== "--version=false") {
      exec(`npm run example/npm`, (err, stdout, stderr) => {
        if(err) return reject(err);
        return resolve(console.info(stdout));
      });
    }
    return resolve();
  }),
  import("./update-readme-tests.mjs").then(
    ({ default: updateTests }) => updateTests(testResults.join(""))
  )
]);

/**
 * main
 */
const inprogressMkdir = {};

(async () => {
  /**
   * transport sources
   */
  await Promise.all(
    sources.map(
      filepath => transport(
        filepath,
        sourcePath,
        destination,
        replacements.srcReplace.concat(replacements.commonReplace)
      )
    )
  );

  /**
   * test common js files
   */
  const tmpDest = tmpTestDestination;

  if(!existsSync(tmpDest)) {
    await new Promise((resolve, reject) => {
      mkdir(tmpDest, { recursive: true }, err => {
        if(err)
          return reject(err);
        return resolve();
      });
    });
  }

  let rmSync;
  try {
    rmSync = (await import("fs")).rmSync;
  } catch (err) {
    ;
  }

  if(typeof rmSync !== "function") {
    rmSync = path => {
      console.error(`Your node version ${process.version} is incapable of fs.rmSync`);
      console.error(`The removal of '${path}' failed`);
    }
  }

  process.once("uncaughtException", err => {
    if(!process.env.NODE_DEBUG) {
      console.info([
        "\x1b[33mtmpTestDestination is auto removed on uncaughtException.",
        "Use environment variable NODE_DEBUG to prevent this.\x1b[0m"
      ].join("\n"))
      rmSync(tmpTestDestination, { recursive: true, force: true });
    }

    throw err;
  });

  process.once("beforeExit", () => {
    return rmSync(tmpTestDestination, { recursive: true });
  });

  await Promise.all(
    tests.map(
      filepath => transport(
        filepath,
        testPath,
        tmpDest,
        replacements.testReplace.concat(replacements.commonReplace),
        true
      )
    )
  );

  await new Promise((resolve, reject) => {
    const child = spawn(testCommand, testArgs, {
      shell: true, stdio: ["ignore", "pipe", "inherit"], env: {
        ...process.env,
        "FORCE_COLOR": process.env["FORCE_COLOR"] || 1
      }
    });
    child.once("error", reject);
    child.once("exit", code => {
      if (code === 0)
        return resolve();
      throw new Error(`Running ${testCommand} ${testArgs} returns ${code}`);
    });

    child.stdout.on("data", data => process.stdout.write(data));

    if(typeof onTestData === "function")
      child.stdout.on("data", onTestData);
  });

  typeof then === "function" && (await then());
})();

function toExtension(filename, extension) {
  return filename.substring(0, filename.length - extname(filename).length).concat(extension);
}

async function transport (filepath, sourcePath, destination, replace, isTest = false) {
  const dir = dirname(join(destination, filepath));

  if(inprogressMkdir[dir]) {
    await inprogressMkdir[dir];
  } else {
    if(!existsSync(dir)) {
      inprogressMkdir[dir] = new Promise((resolve, reject) => {
        mkdir(
          dirname(join(destination, filepath)), err => err ? reject(err) : resolve()
        );
      });
      await inprogressMkdir[dir];
    }
  }

  switch (extname(filepath)) {
    case mjs.from:
      // mjs to common js
      return Promise.all([
        streamEdit({
          readableStream: createReadStream(join(sourcePath, filepath)),
          writableStream: 
            createWriteStream (
              join (
                destination,
                toExtension(filepath, isTest ? mjs.toCJSTest : mjs.toCJS)
              )
            ),
          replace: replace
        }),

        // copy & rename mjs
        !isTest && new Promise((resolve, reject) => 
          copyFile(
            join(sourcePath, filepath),
            join(destination, toExtension(filepath, mjs.toMJS)),
            err => err ? reject(err) : resolve()
          )
        )
      ]);
    default:
      // just copy
      return new Promise((resolve, reject) => 
        copyFile(
          join(sourcePath, filepath),
          join(destination, filepath),
          err => err ? reject(err) : resolve()
        )
      );
  }
}

function matchImport (addtionalPattern) {
  const parts = /(?<!`)import\s+.+\s+from\s*['"](.+?)['"];?/.source.split("(.+?)");

  return new RegExp([
    parts[0],
    addtionalPattern instanceof RegExp ? addtionalPattern.source : addtionalPattern,
    parts[1]
  ].join(""));
}

function matchDynamicImport (addtionalPattern) {
  const parts = /(?<!`)\(?await import\s*\(\s*(.+?)\s*\)\s*\)?(\s*\.default)?/.source.split("(.+?)");

  return new RegExp([
    parts[0],
    addtionalPattern instanceof RegExp ? addtionalPattern.source : addtionalPattern,
    parts[1]
  ].join(""));
}

function matchCurrentFolderImport (addtionalPattern) {
  const parts = /(?<!`)import\s+.+\s+from\s*['"]\.\/(.+?)['"];?/.source.split("(.+?)");

  return new RegExp([
    parts[0],
    addtionalPattern instanceof RegExp ? addtionalPattern.source : addtionalPattern,
    parts[1]
  ].join(""));
}

function matchParentFolderImport (addtionalPattern) {
  const parts = /(?<!`)import\s+.+\s+from\s*['"]\.\.\/(.+?)['"];?/.source.split("(.+?)");

  return new RegExp([
    parts[0],
    addtionalPattern instanceof RegExp ? addtionalPattern.source : addtionalPattern,
    parts[1]
  ].join(""));
}