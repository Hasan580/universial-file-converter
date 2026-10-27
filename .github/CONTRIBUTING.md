# Contributing to Uni Companion

Thanks for helping. The project is [`Hasan580/universial-file-converter`](https://github.com/Hasan580/universial-file-converter) (the repository name predates the rename to Uni Companion and stays, so existing installs keep finding their updates).

## Ground rules

- Be kind and constructive.
- Small, focused pull requests are easier to review than large ones.
- Keep it **private and local by default**: no telemetry, no accounts, no uploading user files.

## Getting set up

```bash
npm install
npm start            # run the app
npm run lint         # must be clean of errors
npm test             # engine suites; must pass
```

`npm test` runs the conversion matrix and the document matrix inside Electron against the real bundled ffmpeg, sharp and document converters. If you add a format, add it to the matrix. If you add an IPC handler, run `node scripts/gen-preload.js` (the allow-list in `src/preload/index.js` is generated and CI checks it).

## Things worth knowing

- **Never overwrite a file.** Output names go through `uniquePath` (see `src/main/util.js`).
- **The interface has no build step.** `src/renderer` is plain ES modules and CSS. Colours, type and spacing live in `src/renderer/css/tokens.css`; use the tokens, not raw values. The design is dark only.
- **Identity values are load-bearing.** `appId`, `win.executableName`, `nsis.perMachine`, the publish owner/repo, the package `name` and the data folder `universal-file-converter` are what let installed copies update in place and keep their settings. Do not change them without a migration.
- **Memory matters.** Load heavy modules lazily, keep work in the main process short, and check `Settings > Performance` before and after.

## Reporting a bug

Open an issue with the steps to reproduce, your system, and the log from **Activity > Export**.

## Licence

Uni Companion is released under the [Apache License 2.0](../LICENSE). By sending a pull request you agree that your contribution is released under the same licence. The [NOTICE](../NOTICE) file must stay with the code in any fork: it credits the original project and its author, Hassan F.
