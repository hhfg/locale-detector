import * as vscode from "vscode";
class DocumentCache {
    private cache: Map<string, vscode.TextDocument>;

    constructor() {
        this.cache = new Map();
    }

    async getDocument(filePath: vscode.Uri): Promise<vscode.TextDocument | undefined> {
        const cachedKey = filePath.fsPath;

        if (this.cache.has(cachedKey)) {
            const cachedDocument = this.cache.get(cachedKey);
            const theNewDocument = vscode.workspace.textDocuments.find((doc) => doc.uri.fsPath === cachedKey);
            if (theNewDocument && cachedDocument?.version === theNewDocument.version) {
                //版本相同说明没更改过，直接返回缓存
                return cachedDocument;
            } else {
                this.cache.delete(cachedKey);
            }
        }
        const document = await vscode.workspace.openTextDocument(filePath);
        this.cache.set(cachedKey, document);
        return document;
    }

    removeDocument(key: string): void {
        this.cache.delete(key);
    }

    // Clear the entire cache
    clearCache(): void {
        this.cache.clear();
    }
}
export const documentCache = new DocumentCache();
