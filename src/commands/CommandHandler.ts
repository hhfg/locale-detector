import * as vscode from "vscode";
import path from "path";
import { deleteErrorKeyDiagnostic, getCurrentKey } from "../utils";

export class CommandHandler {
    private static currentQueryController: AbortController | null = null;
    /**
     * @description 删除整行，包括换行符
     */
    static async deleteEntireLine(document: vscode.TextDocument, range: vscode.Range, source: string, errorKeyDiagnostic: vscode.DiagnosticCollection) {
        const edit = new vscode.WorkspaceEdit();
        const lineRange = document.lineAt(range.start.line).rangeIncludingLineBreak;
        edit.delete(document.uri, lineRange);
        await vscode.workspace.applyEdit(edit);
        //删除诊断
        deleteErrorKeyDiagnostic(document, range, source, errorKeyDiagnostic);
    }

    /**
     * @description 重命名重复的key，加上_new后缀
     */
    static async renameDuplicateKey(document: vscode.TextDocument, range: vscode.Range, source: string, errorKeyDiagnostic: vscode.DiagnosticCollection) {
        const edit = new vscode.WorkspaceEdit();
        const text = document.getText(range);
        const oldKey = getCurrentKey(document, range) || "";
        const newKey = oldKey + "_new";
        const newText = text.replace(oldKey, newKey);
        edit.replace(document.uri, range, newText);
        await vscode.workspace.applyEdit(edit);
        //删除诊断
        deleteErrorKeyDiagnostic(document, range, source, errorKeyDiagnostic);
    }

    /**
     * @description 删除重复的key
     */
    static async deleteDuplicateKey(document: vscode.TextDocument, range: vscode.Range, source: string, errorKeyDiagnostic: vscode.DiagnosticCollection) {
        const edit = new vscode.WorkspaceEdit();
        const text = document.getText(range);
        const newText = text.replace(source, "");
        edit.replace(document.uri, range, newText);
        await vscode.workspace.applyEdit(edit);
        //删除诊断
        deleteErrorKeyDiagnostic(document, range, source, errorKeyDiagnostic);
    }

    /**
     * @description 查询文案内容并插入对应key
     */
    static async queryText(
        getCachedDocument: (filePath: vscode.Uri) => Promise<vscode.TextDocument | undefined>,
        analysisDocument: (document: vscode.TextDocument) => Promise<any[] | undefined>
    ) {
        if (this.currentQueryController) {
            // 如果上一个查询还在进行，先中止它
            this.currentQueryController.abort();
        }
        this.currentQueryController = new AbortController();
        const { signal } = this.currentQueryController;

        const keyword = await vscode.window.showInputBox({
            placeHolder: "eg: Monday",
            prompt: "查询项目中的文案内容，并插入对应的key",
        });
        if (!keyword) {
            return;
        }
        const jsFiles = await vscode.workspace.findFiles("**/public/templates/en.js");
        const tsFiles = await vscode.workspace.findFiles("**/locales/**/en-US.ts");

        const files = [...jsFiles, ...tsFiles];
        const result = await vscode.window.withProgress(
            {
                location: vscode.ProgressLocation.Notification,
                title: `正在查询包含 "${keyword}" 的文案...`,
                cancellable: true,
            },
            async (progress, token) => {
                token.onCancellationRequested(() => {
                    this.currentQueryController?.abort();
                    return [];
                });
                let matches: { key: string; value: string; file: string }[] = [];
                for (const file of files) {
                    if (signal.aborted) {
                        this.currentQueryController = null;
                        return [];
                    }
                    const document = await getCachedDocument(file);
                    if (!document) {
                        continue;
                    }
                    const property = await analysisDocument(document);
                    if (!property) {
                        continue;
                    }
                    property.forEach((item) => {
                        if (item.type === "Property") {
                            const key = item.key;
                            const content = item.value;
                            if (key.type === "Literal" && content.type === "Literal") {
                                const keyName = key.value as string;
                                const value = content.value as string;
                                if (typeof value === "string" && value.toLocaleLowerCase().includes(keyword.toLocaleLowerCase())) {
                                    matches.push({ key: keyName, value: value, file: path.join(file.fsPath) });
                                }
                            }
                        }
                    });
                }
                return matches;
            }
        );
        this.currentQueryController = null;
        if (result.length === 0) {
            await vscode.window.showInformationMessage(`未找到包含 "${keyword}" 的文案`);
            return;
        }
        if (!signal.aborted && result && result.length > 0) {
            const pick = await vscode.window.showQuickPick(
                result.map((item) => ({
                    label: item.key,
                    description: "",
                    detail: item.value + ` （来源文件：${item.file}）`,
                })),
                {
                    placeHolder: "请选择要插入的文案key",
                }
            );
            if (!pick) {
                return;
            }
            const activeEditor = vscode.window.activeTextEditor;
            if (!activeEditor) {
                return;
            }
            // 处理多个光标位置或选中文本
            activeEditor.edit((editBuilder) => {
                const selections = activeEditor.selections;
                selections.forEach((selections) => {
                    editBuilder.replace(selections, pick?.label.split(" ")[0] || "");
                });
            });
        }
    }
}
