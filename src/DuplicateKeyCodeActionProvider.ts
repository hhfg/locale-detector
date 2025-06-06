import * as vscode from "vscode";
class DuplicateKeyCodeActionProvider implements vscode.CodeActionProvider {
    provideCodeActions(
        document: vscode.TextDocument,
        range: vscode.Range | vscode.Selection,
        context: vscode.CodeActionContext,
        token: vscode.CancellationToken
    ): vscode.ProviderResult<(vscode.CodeAction | vscode.Command)[]> {
        const duplicateKeyDiagnostic = context.diagnostics.filter((diagnostic) => diagnostic.code === "duplicate Key");
        if (!duplicateKeyDiagnostic || duplicateKeyDiagnostic.length === 0) {
            return [];
        }
        const codeActions: vscode.CodeAction[] = [];
        for (const diagnostic of duplicateKeyDiagnostic) {
            const codeActionMove = new vscode.CodeAction("删除整行文案", vscode.CodeActionKind.RefactorMove);
            codeActionMove.command = {
                title: "删除整行文案",
                command: "local-detector.deleteEntireLine",
                arguments: [document, diagnostic.range],
            };
            codeActions.push(codeActionMove);

            const codeActionQuickFix = new vscode.CodeAction("快速修复此key", vscode.CodeActionKind.QuickFix);
            codeActionQuickFix.command = {
                title: "快速修复此key",
                command: "local-detector.renameDuplicateKey",
                arguments: [document, diagnostic.range, diagnostic.source],
            };
            codeActions.push(codeActionQuickFix);

            const codeActionDeleteKey = new vscode.CodeAction("删除此key", vscode.CodeActionKind.RefactorMove);
            codeActionDeleteKey.command = {
                title: "删除此key",
                command: "local-detector.deleteDuplicateKey",
                arguments: [document, diagnostic.range, diagnostic.source],
            };
            codeActions.push(codeActionDeleteKey);
        }
        return codeActions;
    }
    resolveCodeAction?(codeAction: vscode.CodeAction, token: vscode.CancellationToken): vscode.ProviderResult<vscode.CodeAction> {
        throw new Error("Method not implemented.");
    }
}

export const duplicateKeyCodeActionProvider = new DuplicateKeyCodeActionProvider();
