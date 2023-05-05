import {
  Connection,
  DidCreateFilesNotification,
  DidDeleteFilesNotification,
  DidRenameFilesNotification,
  FileOperationRegistrationOptions,
  InitializeResult,
  TextDocumentSyncKind,
} from 'vscode-languageserver';
import { debounce } from '../utils';
import { DiagnosticsManager, makeRunChecks } from '../diagnostics';
import { DocumentManager } from '../documents';
import { Dependencies } from '../types';
import { VERSION } from '../version';
import { DocumentLinksProvider } from '../documentLinks';

const defaultLogger = () => {};

/**
 * This code runs in node and the browser, it can't talk to the file system
 * or make requests. Stuff like that should be injected.
 *
 * In browser, theme-check-js wants these things:
 *   - fileExists(path)
 *   - defaultTranslations
 *
 * Which means we gotta provide 'em from here too!
 */
export function startServer(
  connection: Connection,
  {
    log = defaultLogger,
    loadConfig,
    findRootURI,
    getDefaultTranslationsFactory,
    getDefaultLocaleFactory,
    fileExists,
  }: Dependencies,
) {
  const documentManager = new DocumentManager();
  const diagnosticsManager = new DiagnosticsManager(connection);
  const documentLinksProvider = new DocumentLinksProvider(documentManager);
  const runChecks = debounce(
    makeRunChecks({
      loadConfig,
      findRootURI,
      getDefaultTranslationsFactory,
      getDefaultLocaleFactory,
      fileExists,
    }),
    100,
  );

  connection.onInitialize((_params) => {
    const fileOperationRegistrationOptions: FileOperationRegistrationOptions = {
      filters: [
        {
          scheme: 'file',
          pattern: {
            glob: '**/*.{liquid,json}',
          },
        },
      ],
    };

    const result: InitializeResult = {
      capabilities: {
        textDocumentSync: {
          change: TextDocumentSyncKind.Full,
        },
        documentLinkProvider: {
          resolveProvider: false,
          workDoneProgress: false,
        },
        workspace: {
          fileOperations: {
            didRename: fileOperationRegistrationOptions,
            didCreate: fileOperationRegistrationOptions,
            didDelete: fileOperationRegistrationOptions,
          },
        },
      },
      serverInfo: {
        name: 'liquid-language-server',
        version: VERSION,
      },
    };
    return result;
  });

  connection.onInitialized(() => {
    log(`[SERVER] Let's roll!`);
  });

  connection.onDidOpenTextDocument((params) => {
    const { uri, text, version } = params.textDocument;
    documentManager.open(uri, text, version);
    runChecks(documentManager, diagnosticsManager, [uri]);
  });

  connection.onDidChangeTextDocument((params) => {
    const { uri, version } = params.textDocument;
    documentManager.change(uri, params.contentChanges[0].text, version);
    runChecks(documentManager, diagnosticsManager, [uri]);
  });

  connection.onDidCloseTextDocument((params) => {
    const { uri } = params.textDocument;
    documentManager.close(uri);
    diagnosticsManager.clear(uri);
  });

  connection.onDocumentLinks(async (params) => {
    const { uri } = params.textDocument;
    const rootUri = await findRootURI(uri);
    return documentLinksProvider.documentLinks(uri, rootUri);
  });

  // These notifications could cause a MissingSnippet check to be invalidated
  //
  // It is not guaranteed that the file is or was opened when it was
  // created/renamed/deleted. If we're smart, we're going to re-lint for
  // every root affected. Unfortunately, we can't just use the debounced
  // call because we could run in a weird timing issue where didOpen
  // happens after the didRename and causes the 'lastArgs' to skip over the
  // ones we were after.
  //
  // So we're using runChecks.force for that.
  connection.onNotification(DidCreateFilesNotification.type, (params) => {
    const triggerUris = params.files.map((fileCreate) => fileCreate.uri);
    runChecks.force(documentManager, diagnosticsManager, triggerUris);
  });
  connection.onNotification(DidRenameFilesNotification.type, (params) => {
    const triggerUris = params.files.map((fileRename) => fileRename.newUri);
    runChecks.force(documentManager, diagnosticsManager, triggerUris);
  });
  connection.onNotification(DidDeleteFilesNotification.type, (params) => {
    const triggerUris = params.files.map((fileDelete) => fileDelete.uri);
    runChecks.force(documentManager, diagnosticsManager, triggerUris);
  });

  connection.listen();
}
