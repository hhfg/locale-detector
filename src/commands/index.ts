import * as vscode from "vscode";
import { CommandHandler } from "./CommandHandler";

export function registerCommands(
    context: vscode.ExtensionContext,
    errorKeyDiagnostic: vscode.DiagnosticCollection,
    getCachedDocument: (filePath: vscode.Uri) => Promise<vscode.TextDocument | undefined>,
    analysisDocument: (document: vscode.TextDocument) => Promise<any[] | undefined>
) {
    context.subscriptions.push(
        //删除重复的key，整行删除
        vscode.commands.registerCommand("local-detector.deleteEntireLine", async (document: vscode.TextDocument, range: vscode.Range, source: string) => {
            CommandHandler.deleteEntireLine(document, range, source, errorKeyDiagnostic);
        }),
        //重命名重复的key，加上_new后缀
        vscode.commands.registerCommand("local-detector.renameDuplicateKey", async (document: vscode.TextDocument, range: vscode.Range, source: string) => {
            CommandHandler.renameDuplicateKey(document, range, source, errorKeyDiagnostic);
        }),
        //仅删除key
        vscode.commands.registerCommand("local-detector.deleteDuplicateKey", async (document: vscode.TextDocument, range: vscode.Range, source: string) => {
            CommandHandler.deleteDuplicateKey(document, range, source, errorKeyDiagnostic);
        }),
        //查询文案内容并插入对应key
        vscode.commands.registerCommand("local-detector.queryI18nText", async () => {
            CommandHandler.queryText(getCachedDocument, analysisDocument);
        })
    );
}
