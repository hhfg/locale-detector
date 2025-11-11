// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import path from "path";
import * as vscode from "vscode";
import { documentCache } from "./DocumentCache";
import { getConfiguration, getIsSurportLanguageFile, getVisibleDocument, isIgnored } from "./utils";
import * as acorn from "acorn";
import { duplicateKeyCodeActionProvider } from "./DuplicateKeyCodeActionProvider";
import { registerCommands } from "./commands";
// This method is called when your extension is activated
// Your extension is activated the very first time the command is executed

//诊断的信息存储
let relatedInfo: vscode.DiagnosticRelatedInformation[] = [];
let selectionChangeDisposable: vscode.Disposable | undefined;
//诊断集合
const diagCollection = vscode.languages.createDiagnosticCollection("currentLineWarning");
//错误key集合
const errorKeyDiagnostic = vscode.languages.createDiagnosticCollection("currentLineWError");

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

const detectorContent = async (
    fileDocument: vscode.TextDocument,
    value: string,
    relatedInfo: vscode.DiagnosticRelatedInformation[],
    positionLine: number,
    isCurrentFile: boolean
) => {
    const textMap = new Map<vscode.Location, string>();
    const property = await analysisDocument(fileDocument);
    property?.forEach((item, index) => {
        if (item.type === "Property") {
            const key = item.key;
            const content = item.value;
            if (key.type === "Literal" && content.type === "Literal") {
                const lineValue = content.value as string;
                const lineNum = item.loc?.start.line ? item.loc.start.line - 1 : -1;
                if (lineValue && value && lineValue.toLowerCase() === value?.toLowerCase() && (isCurrentFile ? positionLine !== lineNum : true)) {
                    //如果是当前文件，过滤掉当前行
                    const range = new vscode.Range(lineNum, 0, lineNum, fileDocument.lineAt(lineNum).text.length);
                    const location = new vscode.Location(fileDocument.uri, range);
                    textMap.set(location, fileDocument.lineAt(lineNum).text);
                }
            }
        }
    });
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
        if ((await isIgnored(file.fsPath)) || isCurrentFile) {
            continue;
        }
        //获取缓存的文件内容
        const fileDocument = await getCachedDocument(file);
        if (!fileDocument) {
            continue;
        }
        detectorContent(fileDocument, value, relatedInfo, positionLine, false);
    }
};
const handleSelectionChange = async (event: any, crossFile: boolean, fileName: string | undefined, filePath: string | undefined) => {
    //清除之前的警告
    diagCollection.clear();
    relatedInfo = [];

    if (!event.textEditor) {
        return;
    }

    const document = event.textEditor.document;
    const positionLine = event.textEditor.selection.active.line;
    let originLineText = document.lineAt(positionLine).text; //当前行内容
    if (originLineText.endsWith(",")) {
        originLineText = originLineText.slice(0, -1);
    }

    try {
        //使用acorn解析当前行内容
        const ast1 = acorn.parseExpressionAt(`{${originLineText}}`, 0, { ecmaVersion: "latest" });
        const value = (ast1 as acorn.Node & { properties: acorn.Property[] }).properties[0].value;
        if (value.type === "Literal" && typeof value.value === "string") {
            await detectorContent(document, value?.value, relatedInfo, positionLine, true);
            //跨文件检测
            if (crossFile) {
                await detectorSameFileName(fileName, filePath, value?.value, positionLine, relatedInfo);
            }

            if (relatedInfo.length > 0) {
                // 取当前行的完整 Range
                const lineRange = document.lineAt(positionLine).range;
                const diagnostic = new vscode.Diagnostic(lineRange, "⚠️已存在相同内容的文案，对应是：\n", vscode.DiagnosticSeverity.Warning);
                diagnostic.relatedInformation = relatedInfo;
                diagCollection.set(document.uri, [diagnostic]);
            }
        }
    } catch (error) {
        return;
    }
};

const handleCloseTextDocument = async (document: vscode.TextDocument) => {
    const filePath = document.fileName;
    if (filePath.endsWith(".git")) {
        return;
    }
    const name = path.parse(filePath).name;
    const uri = document.uri;
    const currentOpenFile = getVisibleDocument();
    //如果当前工作区，已经没有需要检测的文件了，清除缓存
    if (name && getIsSurportLanguageFile(name, uri) && !currentOpenFile.includes(name)) {
        //关闭了目标语言文件时，同时清除缓存
        documentCache.clearCache();
    }
};

interface KeyLocation {
    range: vscode.Range; //范围
    line: number; //行号
}

const analysisProperty = (property: (acorn.Property | acorn.SpreadElement)[], document: vscode.TextDocument) => {
    const keyMap = new Map<string, KeyLocation[]>();
    property.forEach((item) => {
        if (item.type === "Property") {
            const key = item.key;
            const start = item.loc?.start;
            const end = item.loc?.end;
            if (!start || !end) {
                return;
            } //如果没有位置信息，跳过
            const line = item.loc?.start.line as number; //获取行号
            if (key.type === "Literal") {
                const range = new vscode.Range(start.line - 1, start.column, start.line - 1, end.column + 1);
                if (keyMap.has(key.value as string)) {
                    keyMap.get(key.value as string)?.push({ range, line });
                } else {
                    keyMap.set(key.value as string, [{ range, line }]);
                }
            }
        }
    });
    const diagCollection = [];
    for (const [key, locations] of keyMap) {
        if (locations.length > 1) {
            for (const location of locations) {
                const diagnostic = new vscode.Diagnostic(location.range, `⚠️ 重复Key，请更改`, vscode.DiagnosticSeverity.Error);
                diagnostic.code = "duplicate Key";
                diagnostic.source = key;
                diagCollection.push(diagnostic);
            }
        }
    }
    errorKeyDiagnostic.set(document.uri, diagCollection);
};

/**
 * @description 分析文档，检测重复的key
 * @param document
 */
const analysisDocument = async (document: vscode.TextDocument) => {
    const uri = document.uri;
    const fileDocument = await getCachedDocument(uri);
    const esTree = acorn.parse(fileDocument?.getText() || "", {
        ecmaVersion: "latest",
        locations: true,
        sourceType: "module",
    });
    const node = esTree.body[0];
    if (node.type === "ExpressionStatement" && node.expression?.type === "AssignmentExpression") {
        const { left, right } = node.expression;
        if (left.type === "MemberExpression" && node.expression.operator === "=" && right.type === "ObjectExpression") {
            //左边节点对应的是静态（a.b）成员表达式，属性是 Identifier。
            const property = right.properties; //获取右边对象的属性
            return property;
        }
    } else {
        const findNode = esTree.body.find((node) => node.type === "ExportDefaultDeclaration");
        if (findNode && findNode.type === "ExportDefaultDeclaration" && findNode.declaration.type === "ObjectExpression") {
            const property = findNode.declaration.properties;
            return property;
        }
    }
};

const handleOpenTextDocument = async (document: vscode.TextDocument) => {
    const filePath = document.fileName;
    if (filePath.endsWith(".git")) {
        return;
    }
    const name = path.parse(filePath).name;
    const uri = document.uri;
    if (name && getIsSurportLanguageFile(name, uri)) {
        //如果是目标语言文件，获取缓存的内容
        const property = await analysisDocument(document);
        if (property) {
            analysisProperty(property, document);
        }
    }
};

export function activate(context: vscode.ExtensionContext) {
    context.subscriptions.push(diagCollection);
    context.subscriptions.push(errorKeyDiagnostic);
    context.subscriptions.push(
        vscode.languages.registerCodeActionsProvider(
            [
                { scheme: "file", language: "javascript" },
                { scheme: "file", language: "typescript" },
            ],
            // 或你的目标语言
            duplicateKeyCodeActionProvider,
            { providedCodeActionKinds: [vscode.CodeActionKind.QuickFix, vscode.CodeActionKind.RefactorMove, vscode.CodeActionKind.RefactorRewrite] }
        )
    );
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
            if (filePath && filePath.endsWith(".git")) {
                return;
            }
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
        }),
        //监听打开的文件
        vscode.workspace.onDidOpenTextDocument(async (document) => {
            handleOpenTextDocument(document);
        }),
        vscode.workspace.onDidChangeTextDocument(async (event) => {
            const document = event.document;
            //监听更改
            const name = path.parse(document.fileName).name;
            const uri = document.uri;
            if (name && getIsSurportLanguageFile(name, uri)) {
                //如果是目标语言文件，获取缓存的内容
                const property = await analysisDocument(document);
                analysisProperty(property || [], document);
            }
        })
    );
    registerCommands(context, errorKeyDiagnostic, getCachedDocument, analysisDocument);
}

// This method is called when your extension is deactivated
export function deactivate() {}
