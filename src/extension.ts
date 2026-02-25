// extension.ts
import * as path from "path";
import * as vscode from "vscode";
import {
    LanguageClient,
    LanguageClientOptions,
    ServerOptions,
    TransportKind
} from "vscode-languageclient/node";

let client: LanguageClient | undefined;


function sendSettings() {
  const config = vscode.workspace.getConfiguration("calcdocs");

  client?.sendNotification("calcdocs.updateSettings", {
    scanInterval: config.get<number>("scanInterval", 30),
    ignoredDirs: config.get<string[]>("ignoredDirs", [])
  });
}

vscode.workspace.onDidChangeConfiguration(e => {
  if (e.affectsConfiguration("calcdocs")) {
    sendSettings();
  }
});


export function activate(context: vscode.ExtensionContext) {
  const output = vscode.window.createOutputChannel("CalcDocs LSP");
  context.subscriptions.push(output);
  output.appendLine("[activate] starting extension");

  const serverModule = context.asAbsolutePath(path.join("out", "server.js"));
  output.appendLine(`[activate] server module: ${serverModule}`);

  const serverOptions: ServerOptions = {
      run: {
          module: serverModule,
          transport: TransportKind.ipc
      },
      debug: {
          module: serverModule,
          transport: TransportKind.ipc,
          options: { execArgv: ["--nolazy", "--inspect=6009"] }
      }
  };

  const clientOptions: LanguageClientOptions = {
  documentSelector: [
    { scheme: "file", language: "yaml" },
    { scheme: "file", language: "c" },
    { scheme: "file", language: "cpp" }
  ],
      outputChannel: output,
      traceOutputChannel: output
  };

  client = new LanguageClient(
      "calcdocsLSP",
      "CalcDocs LSP",
      serverOptions,
      clientOptions
  );

  // context.subscriptions.push(client.start());
  client.start().then(() => {
    sendSettings();
  });


  // Comandi già richiesti
  context.subscriptions.push(
    vscode.commands.registerCommand("calcdocs.forceRefresh", () => {
      client?.sendNotification("calcdocs.forceRefresh");
      vscode.window.showInformationMessage("CalcDocs: indice formule aggiornato.");
    }),

    vscode.commands.registerCommand("calcdocs.setScanInterval", async () => {
      const val = await vscode.window.showInputBox({
        prompt: "Intervallo scansione (sec)",
        value: "30",
        validateInput: (v) =>
          isFinite(Number(v)) && Number(v) >= 30
            ? null
            : ">= 30 s"
      });

      if (val) {
        client?.sendNotification("calcdocs.updateInterval", Number(val));
        vscode.window.showInformationMessage(`CalcDocs: intervallo impostato a ${val} s.`);
      }
    })
  );

  // ----- STATUS BAR BUTTON -----
  const button = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
  button.text = "$(refresh) CalcDocs";
  button.tooltip = "Forza aggiornamento formule";
  button.command = "calcdocs.forceRefresh";
  button.show();
  context.subscriptions.push(button);

    // Stop automatico
    context.subscriptions.push({ dispose: () => client?.stop() });
}

export async function deactivate(): Promise<void> {
        await client.stop();
}
