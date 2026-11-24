import * as vscode from 'vscode';

interface RawCell {
    language: string;
    value: string;
    kind: vscode.NotebookCellKind;
    outputs?: any[];
}

interface RawNotebookData {
    cells: RawCell[];
    metadata?: {
        connectionString?: string;
    };
}

export class SqlNotebookSerializer implements vscode.NotebookSerializer {
    
    // 1. 文件打开时：把磁盘上的二进制数据转成 VS Code 的 Notebook 数据
    async deserializeNotebook(content: Uint8Array, _token: vscode.CancellationToken): Promise<vscode.NotebookData> {
        const contents = new TextDecoder().decode(content);
        
        let rawData: RawNotebookData;
        try {
            rawData = contents ? JSON.parse(contents) : { cells: [] };
        } catch {
            rawData = { cells: [] };
        }

        const cells = rawData.cells.map(item => {
            const cell = new vscode.NotebookCellData(
                item.kind ?? vscode.NotebookCellKind.Code,
                item.value ?? '',
                item.language ?? 'sql'
            );
            
            // 恢复历史输出结果
            if (item.outputs) {
                cell.outputs = item.outputs.map((o: any) => 
                    new vscode.NotebookCellOutput(
                        o.items.map((i: any) => new vscode.NotebookCellOutputItem(new Uint8Array(i.data), i.mime))
                    )
                );
            }
            return cell;
        });

        const notebookData = new vscode.NotebookData(cells);
        notebookData.metadata = rawData.metadata || {};
        return notebookData;
    }

    // 2. 文件保存时：把 Notebook 数据打包序列化写入磁盘
    async serializeNotebook(data: vscode.NotebookData, _token: vscode.CancellationToken): Promise<Uint8Array> {
        const contents: RawNotebookData = {
            cells: data.cells.map(cell => ({
                language: cell.languageId,
                value: cell.value,
                kind: cell.kind,
                outputs: (cell.outputs || []).map(output => ({
                    items: output.items.map(item => ({
                        mime: item.mime,
                        data: Array.from(item.data)
                    }))
                }))
            })),
            metadata: data.metadata
        };

        return new TextEncoder().encode(JSON.stringify(contents, null, 2));
    }
}