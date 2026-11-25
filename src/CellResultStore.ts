import * as vscode from 'vscode';

export interface NamedCellResult {
    name: string;
    columns: string[];
    rows: Record<string, unknown>[];
    executedAt: number;
}

export class CellResultStore {
    // key: notebookUri -> (cellName -> result)
    private store = new Map<string, Map<string, NamedCellResult>>();

    public set(notebookUri: string, result: NamedCellResult): void {
        let docMap = this.store.get(notebookUri);
        if (!docMap) {
            docMap = new Map();
            this.store.set(notebookUri, docMap);
        }
        docMap.set(result.name, result);
    }

    public get(notebookUri: string, name: string): NamedCellResult | undefined {
        return this.store.get(notebookUri)?.get(name);
    }

    public clearDocument(notebookUri: string): void {
        this.store.delete(notebookUri);
    }
}
export const cellStore=new CellResultStore();