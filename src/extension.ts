// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import path from "path";
import * as vscode from "vscode";
import { documentCache } from "./DocumentCache";
import { getConfiguration, getIsSurportLanguageFile, getVisibleDocument, isIgnored } from "./utils";
// This method is called when your extension is activated
// Your extension is activated the very first time the command is executed

const regex1 = /["'](.*?)["']\s*:\s*["'](.*?)["']/;

//诊断的信息存储
let relatedInfo: vscode.DiagnosticRelatedInformation[] = [];
let selectionChangeDisposable: vscode.Disposable | undefined;
//诊断集合
const diagCollection = vscode.languages.createDiagnosticCollection("currentLineWarning");
/**
 * @description 获取缓存的文件内容
 * @param filePath 文件路径
 */
const getCachedDocument = async (filePath: vscode.Uri) => {
    try {
        return await documentCache.getDocument(filePath);
    } catch (error) {
        console.error("Error getting cached document:", error);
        return undefined;
    }
};

const detectorContent = (
    fileDocument: vscode.TextDocument,
    value: string,
    relatedInfo: vscode.DiagnosticRelatedInformation[],
    positionLine: number,
    isCurrentFile: boolean
) => {
    const textMap = new Map<vscode.Location, string>();
    for (let lineNum = 0; lineNum < fileDocument.lineCount; lineNum++) {
        const lineText = fileDocument.lineAt(lineNum).text.replace(/,/g, "");
        const lineMatch = lineText.match(regex1);

        if (lineMatch) {
            const lineValue = lineMatch[2];

            if (lineValue && value && lineValue.toLowerCase() === value?.toLowerCase() && (isCurrentFile ? positionLine !== lineNum : true)) {
                //如果是当前文件，过滤掉当前行
                const range = new vscode.Range(lineNum, 0, lineNum, lineText.length);
                const location = new vscode.Location(fileDocument.uri, range);
                textMap.set(location, lineText);
            }
        }
    }
    for (const [location, lineText] of textMap) {
        relatedInfo.push(new vscode.DiagnosticRelatedInformation(location, `${lineText}`));
    }
};

/**
 *
 * @param crossFile 是否跨文件
 * @param fileName 文件名
 * @param filePath 文件路径
 * @param value 当前行/输入的文案内容
 * @param positionLine 当前行
 * @param relatedInfo 对应诊断信息
 */
const detectorSameFileName = async (
    fileName: string | undefined,
    filePath: string | undefined,
    value: string,
    positionLine: number,
    relatedInfo: vscode.DiagnosticRelatedInformation[]
) => {
    const sameNameFiles = await vscode.workspace.findFiles(`**/${fileName}`, "**/node_modules/**");
    for (const file of sameNameFiles) {
        const isCurrentFile = file.fsPath === filePath;
        if ((await isIgnored(file.fsPath)) || isCurrentFile) continue;
        //获取缓存的文件内容
        const fileDocument = await getCachedDocument(file);
        if (!fileDocument) continue;
        detectorContent(fileDocument, value, relatedInfo, positionLine, false);
    }
};
const handleSelectionChange = async (event: any, crossFile: boolean, fileName: string | undefined, filePath: string | undefined) => {
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
    detectorContent(document, value, relatedInfo, positionLine, true);
    //跨文件检测
    if (crossFile) await detectorSameFileName(fileName, filePath, value, positionLine, relatedInfo);

    if (relatedInfo.length > 0) {
        // 取当前行的完整 Range
        const lineRange = document.lineAt(positionLine).range;
        const diagnostic = new vscode.Diagnostic(lineRange, "⚠️已存在相同内容的文案，对应是：\n", vscode.DiagnosticSeverity.Warning);
        diagnostic.relatedInformation = relatedInfo;
        diagCollection.set(document.uri, [diagnostic]);
    }
};

const handleCloseTextDocument = async (document: vscode.TextDocument) => {
    const filePath = document.fileName;
    if (filePath.endsWith(".git")) return;
    const name = path.parse(filePath).name;
    const uri = document.uri;
    const currentOpenFile = getVisibleDocument();
    //如果当前工作区，已经没有需要检测的文件了，清除缓存
    if (name && getIsSurportLanguageFile(name, uri) && !currentOpenFile.includes(name)) {
        //关闭了目标语言文件时，同时清除缓存
        documentCache.clearCache();
    }
};

export function activate(context: vscode.ExtensionContext) {
    context.subscriptions.push(diagCollection);

    //获取当前打开的文件，判断是否要检测的文件
    context.subscriptions.push(

        //监听文件关闭，清理缓存
        vscode.workspace.onDidCloseTextDocument(async (document) => {
            handleCloseTextDocument(document);
        }),
        //活动编辑器更改触发
        vscode.window.onDidChangeActiveTextEditor((editor) => {
            const filePath = editor?.document.fileName;
            const fileName = filePath ? path.basename(filePath) : undefined;
            const name = filePath && path.parse(filePath).name;
            if (filePath && filePath.endsWith(".git")) return;
            const uri = editor?.document.uri;
            const { crossFile } = getConfiguration(uri);
            if (selectionChangeDisposable) {
                selectionChangeDisposable.dispose();
                selectionChangeDisposable = undefined;
            }
            if (getIsSurportLanguageFile(name, uri)) {
                let debounceTimer: NodeJS.Timeout;
                selectionChangeDisposable = vscode.window.onDidChangeTextEditorSelection(async (event) => {
                    clearTimeout(debounceTimer);
                    debounceTimer = setTimeout(async () => {
                        handleSelectionChange(event, crossFile, fileName, filePath);
                    }, 200);
                });
            } else {
                return;
            }
        })
    );
}

// This method is called when your extension is deactivated
export function deactivate() {}
