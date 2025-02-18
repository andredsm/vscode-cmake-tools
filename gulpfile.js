/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

'use strict';

const gulp = require('gulp');
const eslint = require('gulp-eslint');
const fs = require('fs');
const nls = require('vscode-nls-dev');
const path = require('path');
const minimist = require('minimist');
const es = require('event-stream');
const sourcemaps = require('gulp-sourcemaps');
const ts = require('gulp-typescript');
const typescript = require('typescript');
const tsProject = ts.createProject('./tsconfig.json', { typescript });
const filter = require('gulp-filter');
const vinyl = require('vinyl');
const jsonc = require('jsonc-parser');


// Patterns to find schema files
const jsonSchemaFilesPatterns = [
    "*/*-schema.json"
];

const languages = [
    { id: "zh-TW", folderName: "cht", transifexId: "zh-hant" },
    { id: "zh-CN", folderName: "chs", transifexId: "zh-hans" },
    { id: "fr", folderName: "fra" },
    { id: "de", folderName: "deu" },
    { id: "it", folderName: "ita" },
    { id: "es", folderName: "esn" },
    { id: "ja", folderName: "jpn" },
    { id: "ko", folderName: "kor" },
    { id: "ru", folderName: "rus" },
    //{ id: "bg", folderName: "bul" }, // VS Code supports Bulgarian, but loc team is not currently generating it
    //{ id: "hu", folderName: "hun" }, // VS Code supports Hungarian, but loc team is not currently generating it
    { id: "pt-br", folderName: "ptb", transifexId: "pt-BR" },
    { id: "tr", folderName: "trk" },
    { id: "cs", folderName: "csy" },
    { id: "pl", folderName: "plk" }
];


// ****************************
// Command: translations-export
// The following is used to export and XLF file containing english strings for translations.
// The result will be written to: ./vscode-extensions-localization-export/ms-vscode/
// ****************************

const translationProjectName  = "vscode-extensions";
const translationExtensionName  = "vscode-cmake-tools";

function removePathPrefix(path, prefix) {
    if (!prefix) {
        return path;
    }
    if (!path.startsWith(prefix)) {
        return path;
    }
    if (path === prefix) {
        return "";
    }
    let ch = prefix.charAt(prefix.length - 1);
    if (ch === '/' || ch === '\\') {
        return path.substr(prefix.length);
    }
    ch = path.charAt(prefix.length);
    if (ch === '/' || ch === '\\') {
        return path.substr(prefix.length + 1);
    }
    return path;
}

// descriptionCallback(path, value, parent) is invoked for attribtues
const traverseJson = (jsonTree, descriptionCallback, prefixPath) => {
    for (let fieldName in jsonTree) {
        if (jsonTree[fieldName] !== null) {
            if (typeof(jsonTree[fieldName]) == "string" && fieldName === "description") {
                descriptionCallback(prefixPath, jsonTree[fieldName], jsonTree);
            } else if (typeof(jsonTree[fieldName]) == "object") {
                let path = prefixPath;
                if (path !== "")
                    path = path + ".";
                path = path + fieldName;
                traverseJson(jsonTree[fieldName], descriptionCallback, path);
            }
        }
    }
};

// Traverses schema json files looking for "description" fields to localized.
// The path to the "description" field is used to create a localization key.
const processJsonSchemaFiles = () => {
    return es.through(function (file) {
        let jsonTree = JSON.parse(file.contents.toString());
        let localizationJsonContents = {};
        let filePath = removePathPrefix(file.path, file.cwd);
        filePath = filePath.replace(/\\/g, '/')
        let localizationMetadataContents = {
            messages: [],
            keys: [],
            filePath: filePath
        };
        let descriptionCallback = (path, value, parent) => {
            let locId = filePath + "." + path;
            localizationJsonContents[locId] = value;
            localizationMetadataContents.keys.push(locId);
            localizationMetadataContents.messages.push(value);
        };
        traverseJson(jsonTree, descriptionCallback, "");
        this.queue(new vinyl({
            path: path.join(file.path + '.nls.json'),
            contents: Buffer.from(JSON.stringify(localizationJsonContents, null, '\t'), 'utf8')
        }));
        this.queue(new vinyl({
            path: path.join(file.path + '.nls.metadata.json'),
            contents: Buffer.from(JSON.stringify(localizationMetadataContents, null, '\t'), 'utf8')
        }));
    });
};

gulp.task("translations-export", (done) => {

    // Transpile the TS to JS, and let vscode-nls-dev scan the files for calls to localize.
    let jsStream = tsProject.src()
        .pipe(sourcemaps.init())
        .pipe(tsProject()).js
        .pipe(nls.createMetaDataFiles());

    // Scan schema files
    let jsonSchemaStream = gulp.src(jsonSchemaFilesPatterns)
        .pipe(processJsonSchemaFiles());

    // Merge files from all source streams
    es.merge(jsStream, jsonSchemaStream)

    // Filter down to only the files we need
    .pipe(filter(['**/*.nls.json', '**/*.nls.metadata.json']))

    // Consoldate them into nls.metadata.json, which the xlf is built from.
    .pipe(nls.bundleMetaDataFiles('ms-vscode.cmake-tools', '.'))

    // filter down to just the resulting metadata files
    .pipe(filter(['**/nls.metadata.header.json', '**/nls.metadata.json']))

    // Add package.nls.json, used to localized package.json
    .pipe(gulp.src(["package.nls.json"]))

    // package.nls.json and nls.metadata.json are used to generate the xlf file
    // Does not re-queue any files to the stream.  Outputs only the XLF file
    .pipe(nls.createXlfFiles(translationProjectName, translationExtensionName))
    .pipe(gulp.dest(path.join(`${translationProjectName}-localization-export`)))
    .pipe(es.wait(() => {
        done();
    }));
});


// ****************************
// Command: translations-import
// The following is used to import an XLF file containing all language strings.
// This results in a i18n directory, which should be checked in.
// ****************************

// Imports translations from raw localized MLCP strings to VS Code .i18n.json files
gulp.task("translations-import", (done) => {
    let options = minimist(process.argv.slice(2), {
        string: "location",
        default: {
            location: "./vscode-translations-import"
        }
    });
    es.merge(languages.map((language) => {
        let id = language.transifexId || language.id;
        return gulp.src(path.join(options.location, id, translationProjectName, `${translationExtensionName}.xlf`))
            .pipe(nls.prepareJsonFiles())
            .pipe(gulp.dest(path.join("./i18n", language.folderName)));
    }))
    .pipe(es.wait(() => {
        done();
    }));
});


// ****************************
// Command: translations-generate
// The following is used to import an i18n directory structure and generate files used at runtime.
// ****************************

// Generate package.nls.*.json files from: ./i18n/*/package.i18n.json
// Outputs to root path, as these nls files need to be along side package.json
const generatedAdditionalLocFiles = () => {
    return gulp.src(['package.nls.json'])
        .pipe(nls.createAdditionalLanguageFiles(languages, 'i18n'))
        .pipe(gulp.dest('.'));
};

// Generates ./dist/nls.bundle.<language_id>.json from files in ./i18n/** *//<src_path>/<filename>.i18n.json
// Localized strings are read from these files at runtime.
const generatedSrcLocBundle = () => {
    // Transpile the TS to JS, and let vscode-nls-dev scan the files for calls to localize.
    return tsProject.src()
        .pipe(sourcemaps.init())
        .pipe(tsProject()).js
        .pipe(nls.createMetaDataFiles())
        .pipe(nls.createAdditionalLanguageFiles(languages, "i18n"))
        .pipe(nls.bundleMetaDataFiles('ms-vscode.cmake-tools', 'dist'))
        .pipe(nls.bundleLanguageFiles())
        .pipe(filter(['**/nls.bundle.*.json', '**/nls.metadata.header.json', '**/nls.metadata.json']))
        .pipe(gulp.dest('dist'));
};

const generateLocalizedJsonSchemaFiles = () => {
    return es.through(function (file) {
        let jsonTree = JSON.parse(file.contents.toString());
        languages.map((language) => {
            let stringTable = {};
            // Try to open i18n file for this file
            let relativePath = removePathPrefix(file.path, file.cwd);
            let locFile = path.join("./i18n", language.folderName, relativePath + ".i18n.json");
            if (fs.existsSync(locFile)) {
                stringTable = jsonc.parse(fs.readFileSync(locFile).toString());
            }
            // Entire file is scanned and modified, then serialized for that language.
            // Even if no translations are available, we still write new files to dist/schema/...
            let keyPrefix = relativePath + ".";
            keyPrefix = keyPrefix.replace(/\\/g, "/");
            let descriptionCallback = (path, value, parent) => {
                if (stringTable[keyPrefix + path]) {
                    parent.description = stringTable[keyPrefix + path];
                }
            };
            traverseJson(jsonTree, descriptionCallback, "");
            let newContent = JSON.stringify(jsonTree, null, '\t');
            this.queue(new vinyl({
                path: path.join("schema", language.id, relativePath),
                contents: Buffer.from(newContent, 'utf8')
            }));
        });
    });
};

// Generate localized versions of JSON schema files
// Check for cooresponding localized json file in i18n
// Generate new version of the JSON schema file in dist/schema/<language_id>/<path>
const generateJsonSchemaLoc = () => {
    return gulp.src(jsonSchemaFilesPatterns)
        .pipe(generateLocalizedJsonSchemaFiles())
        .pipe(gulp.dest('dist'));
};

gulp.task('translations-generate', gulp.series(generatedSrcLocBundle, generatedAdditionalLocFiles, generateJsonSchemaLoc));

const allTypeScript = [
    'src/**/*.ts',
    'test/**/*.ts',
    '!**/*.d.ts',
    '!**/typings**'
];

gulp.task('lint', function () {
    // Un-comment these parts for applying auto-fix.
    return gulp.src(allTypeScript)
        .pipe(eslint({ configFile: ".eslintrc.js" /*, fix: true */}))
        .pipe(eslint.format())
        //.pipe(gulp.dest(file => file.base))
        .pipe(eslint.failAfterError());
});

