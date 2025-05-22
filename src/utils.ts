import path from "path";
import * as vscode from "vscode";

import { promises as fs } from "fs";
import ignore from "ignore";
import { CONFIG_CROSS_FILE, CONFIG_LANGUAGE, CONFIG_NAME } from "./constant";

/**
 *
 * @returns gitignore文件的内容
 */
export const getGitignorePatterns = async () => {
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
/**
 * @description 判断是否是被忽略的文件
 * @param absoluteFilePath 绝对路径
 * @returns
 */
export const isIgnored = async (absoluteFilePath: string) => {
    const workspaceFolder = vscode.workspace.workspaceFolders?.[0].uri.fsPath;
    if (!workspaceFolder) return;
    const patterns = await getGitignorePatterns();

    const ig = ignore().add(patterns);
    const relativePath = path.relative(workspaceFolder, absoluteFilePath).replace(/\\/g, "/");
    return ig.ignores(relativePath);
};

/**
 * @description 判断是否是支持的语言文件
 * @param fileName 文件名
 * @param uri
 * @returns
 */
export const getIsSurportLanguageFile = (fileName: string | undefined, uri: vscode.Uri | undefined) => {
    const config = vscode.workspace.getConfiguration("local-detector", uri);
    const language = config.get<string[]>("languages");
    if (fileName && language?.includes(String(fileName))) {
        return true;
    }
    return false;
};

/**
 * @description 获取配置
 * @param uri
 * @returns
 */
export const getConfiguration = (uri: vscode.Uri | undefined) => {
    const config = vscode.workspace.getConfiguration(CONFIG_NAME, uri);
    const crossFile = config.get<boolean>(CONFIG_CROSS_FILE, false);
    const language = config.get<string[]>(CONFIG_LANGUAGE);
    return { crossFile, language };
};

/**
 *
 * @returns 获取当前打开的文件名
 */
export const getVisibleDocument = () => {
    const tabs = vscode.window.tabGroups.all.flatMap((group) => group.tabs);
    const openFileArr = tabs.map((tab) => {
        if (tab.input instanceof vscode.TabInputText) {
            const filePath = tab.input.uri.fsPath;
            const fileName = path.parse(filePath).name;
            return fileName;
        }
    });
    return openFileArr;
};
