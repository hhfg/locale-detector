// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import path from "path";
import * as vscode from "vscode";
import ignore from "ignore";
import {promises as fs} from "fs";
// This method is called when your extension is activated
// Your extension is activated the very first time the command is executed

const regex1 = /["'](.*?)["']\s*:\s*["'](.*?)["']/;

const getGitignorePatterns = async () => {
    const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
    if (!workspaceFolder) return [];

    const gitignorePath = path.join(workspaceFolder.uri.fsPath, ".gitignore");

    try {
        const content = await fs.readFile(gitignorePath, "utf8");

        const lines = content
            .split(/\r?\n/)
            .map((line) => line.trim())
            .filter((line) => line && !line.startsWith("#")); // 去掉空行和注释
        return lines;
    } catch (err) {
        return "";
    }
};
const isIgnored = async (absoluteFilePath: string) => {
    const workspaceFolder = vscode.workspace.workspaceFolders?.[0].uri.fsPath;
    if (!workspaceFolder) return;
    const patterns = await getGitignorePatterns();

    const ig = ignore().add(patterns);
    const relativePath = path.relative(workspaceFolder, absoluteFilePath).replace(/\\/g, "/");
    return ig.ignores(relativePath);
};
const detectorSameFileName = async (
    fileName: string | undefined,
    filePath: string | undefined,
    value: string,
    positionLine: number,
    relatedInfo: vscode.DiagnosticRelatedInformation[]
) => {
    const textMap = new Map<vscode.Location, string>();
    const sameNameFiles = await vscode.workspace.findFiles(`**/${fileName}`, "**/node_modules/**");
    for (const file of sameNameFiles) {
        if (await isIgnored(file.fsPath)) continue;
        const isCurrentFile = file.fsPath === filePath;
        const fileDocument = await vscode.workspace.openTextDocument(file);
        for (let lineNum = 0; lineNum < fileDocument.lineCount; lineNum++) {
            const lineText = fileDocument.lineAt(lineNum).text.replace(/,/g, "");
            const lineMatch = lineText.match(regex1);

            if (lineMatch) {
                const lineValue = lineMatch[2];

                if (
                    lineValue &&
                    value &&
                    lineValue.toLowerCase() === value?.toLowerCase() &&
                    (isCurrentFile ? lineNum !== positionLine : true)
                ) {
                    //如果是当前文件，过滤掉当前行
                    const range = new vscode.Range(lineNum, 0, lineNum, lineText.length);
                    const location = new vscode.Location(fileDocument.uri, range);
                    textMap.set(location, lineText);
                }
            }
        }
    }
    for (const [location, lineText] of textMap) {
        relatedInfo.push(new vscode.DiagnosticRelatedInformation(location, `${lineText}`));
    }
};
export function activate(context: vscode.ExtensionContext) {
    const config = vscode.workspace.getConfiguration();
    const enable = config.get<boolean>("local-detector.enable");
    const language = config.get<string[]>("local-detector.languages");

    //创建诊断集合
    const diagCollection = vscode.languages.createDiagnosticCollection("currentLineWarning");
    context.subscriptions.push(diagCollection);
    let relatedInfo: vscode.DiagnosticRelatedInformation[] = [];
    if (enable) {
        //开启了才进行监听
        //获取当前打开的文件，判断是否要检测的文件
        context.subscriptions.push(
            vscode.window.onDidChangeActiveTextEditor((editor) => {
                const filePath = editor?.document.fileName;
                const fileName = filePath ? path.basename(filePath) : undefined;
                const name = filePath && path.parse(filePath).name;

                if (language?.includes(String(name))) {
                    //当前光标选择更改的事件监听
                    let selectionChangeDisposable: vscode.Disposable | undefined;
                    selectionChangeDisposable = vscode.window.onDidChangeTextEditorSelection(async (event) => {
                        //清除之前的警告
                        diagCollection.clear();
                        relatedInfo = [];
                        const editor = event.textEditor;
                        if (event.textEditor !== editor) return;

                        const document = editor.document;
                        const positionLine = editor.selection.active.line;
                        const originLineText = document.lineAt(positionLine).text.replace(/,/g, ""); //当前行内容，需要去掉逗号

                        if (!regex1.test(originLineText)) return; //不符合正则表达式的行

                        const matchResult = regex1.exec(originLineText);
                        if (!matchResult) return;

                        const value = matchResult[2]; //文案的内容

                        await detectorSameFileName(fileName, filePath, value, positionLine, relatedInfo);
                        if (relatedInfo.length > 0) {
                            // 取当前行的完整 Range
                            const lineRange = document.lineAt(positionLine).range;
                            const diagnostic = new vscode.Diagnostic(
                                lineRange,
                                "⚠️已存在相同内容的文案，对应是：\n",
                                vscode.DiagnosticSeverity.Warning
                            );
                            diagnostic.relatedInformation = relatedInfo;
                            diagCollection.set(document.uri, [diagnostic]);
                        }
                    });
                }
            })
        );
    }
}

// This method is called when your extension is deactivated
export function deactivate() {}
