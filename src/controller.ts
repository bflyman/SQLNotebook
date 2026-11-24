import * as vscode from 'vscode';
import * as sql from 'mssql';
import {dbManager } from './DBManager';
function convertToHTMLGridTable(recordset: any[]): string {
    if (!recordset || recordset.length === 0) {
        return `
            <div style="padding: 12px; font-family: var(--vscode-editor-font-family, sans-serif); color: var(--vscode-descriptionForeground); font-style: italic;">
                查询成功，但返回了 0 行数据。
            </div>
        `;
    }

    const headers = Object.keys(recordset[0]);

    let html = `
    <div style="
        max-height: 480px; 
        overflow: auto; 
        border: 1px solid var(--vscode-panel-border, #333); 
        border-radius: 4px; 
        box-shadow: 0 2px 8px rgba(0,0,0,0.1);
        margin: 6px 0;
    ">
        <table style="
            border-collapse: collapse; 
            width: 100%; 
            font-family: var(--vscode-editor-font-family, monospace); 
            font-size: 12px; 
            line-height: 1.5; 
            text-align: left;
            color: var(--vscode-editor-foreground, #ccc);
        ">
            <thead>
                <tr style="
                    background-color: var(--vscode-editor-inactiveSelectionBackground, #2a2d2e); 
                    position: sticky; 
                    top: 0; 
                    z-index: 2;
                    border-bottom: 2px solid var(--vscode-panel-border, #444);
                ">
    `;

    // 渲染表头
    for (const header of headers) {
        html += `<th style="
            padding: 8px 12px; 
            border-right: 1px solid var(--vscode-panel-border, #333); 
            font-weight: 600;
            white-space: nowrap;
        ">${escapeHtml(header)}</th>`;
    }

    html += `
                </tr>
            </thead>
            <tbody>
    `;

    // 渲染数据行
    recordset.forEach((row, index) => {
        const rowBg = index % 2 === 0
            ? 'transparent'
            : 'var(--vscode-list-hoverBackground, rgba(255, 255, 255, 0.02))';

        html += `<tr style="background-color: ${rowBg}; border-bottom: 1px solid var(--vscode-panel-border, #2a2d2e);">`;

        for (const header of headers) {
            const val = row[header];
            let displayVal: string;

            if (val === null || val === undefined) {
                displayVal = '<span style="color: var(--vscode-disabledForeground, #777); font-style: italic;">NULL</span>';
            } else if (typeof val === 'boolean') {
                displayVal = `<span style="color: ${val ? '#4ec9b0' : '#ce9178'};">${val}</span>`;
            } else {
                displayVal = escapeHtml(String(val));
            }

            html += `<td style="
                padding: 6px 12px; 
                border-right: 1px solid var(--vscode-panel-border, #2a2d2e); 
                max-width: 400px; 
                overflow: hidden; 
                text-overflow: ellipsis; 
                white-space: nowrap;
            " title="${escapeHtml(String(val ?? ''))}">${displayVal}</td>`;
        }
        html += `</tr>`;
    });

    html += `
            </tbody>
        </table>
    </div>
    <div style="
        font-family: var(--vscode-editor-font-family, sans-serif); 
        font-size: 11px; 
        color: var(--vscode-descriptionForeground, #888); 
        margin-top: 4px;
        display: flex;
        justify-content: space-between;
    ">
        <span>共 <b>${recordset.length}</b> 行记录</span>
        <span>SQL Notebook 渲染器</span>
    </div>
    `;

    return html;
}

function escapeHtml(str: string): string {
    return str
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}


// 将 recordset 转换为包含 Grid.js 交互表格的 HTML 片段
function convertToGridJsTable(recordset: any[]): string {
    if (!recordset || recordset.length === 0) {
        return `
            <div style="padding: 12px; font-family: var(--vscode-editor-font-family, sans-serif); color: var(--vscode-descriptionForeground); font-style: italic;">
                查询成功，但返回了 0 行数据。
            </div>
        `;
    }

    // 1. 提取表头和数据，供 Grid.js 使用
    const columns = Object.keys(recordset[0]);
    // 将对象数组转为 Grid.js 所需的二维数组格式
    const data = recordset.map(row => columns.map(col => row[col] !== null && row[col] !== undefined ? row[col] : 'NULL'));

    // 生成唯一 DOM ID，防止多个单元格同时渲染时 ID 冲突
    const tableId = `grid-table-${Math.random().toString(36).substring(2, 9)}`;

    // 2. 拼接包含 Grid.js CDN 的完整 HTML 字符串
    return `
    <div style="font-family: var(--vscode-editor-font-family, sans-serif);">
        <!-- 引入 Grid.js 样式文件 -->
        <link href="https://unpkg.com/gridjs/dist/theme/mermaid.min.css" rel="stylesheet" />
        
        <!-- 表格挂载容器 -->
        <div id="${tableId}" style="margin: 6px 0;"></div>

        <!-- 引入 Grid.js 核心脚本并初始化 -->
        <script type="module">
            import { Grid } from 'https://unpkg.com/gridjs?module';

            new Grid({
                columns: ${JSON.stringify(columns)},
                data: ${JSON.stringify(data)},
                pagination: {
                    limit: 10,
                    summary: true
                },
                search: true,
                sort: true,
                style: {
                    table: {
                        'font-size': '12px',
                        'width': '100%'
                    },
                    th: {
                        'background-color': 'var(--vscode-editor-inactiveSelectionBackground, #2a2d2e)',
                        'color': 'var(--vscode-editor-foreground, #ccc)',
                        'border-bottom': '2px solid var(--vscode-panel-border, #444)'
                    },
                    td: {
                        'color': 'var(--vscode-editor-foreground, #ccc)',
                        'border-bottom': '1px solid var(--vscode-panel-border, #333)'
                    }
                }
            }).render(document.getElementById('${tableId}'));
        </script>
    </div>
    <div style="font-size: 11px; color: var(--vscode-descriptionForeground, #888); margin-top: 4px;">
        <span>共 ${recordset.length} 行记录 (Grid.js Interactive Grid)</span>
    </div>
    `;
}
function convertToMarkdownTable(recordset: any[]): string {
    if (!recordset || recordset.length === 0) {
        return '查询成功，但返回了 0 行数据。';
    }

    const headers = Object.keys(recordset[0]);
    const lines: string[] = [];

    // 1. 生成表头行
    lines.push(`| ${headers.join(' | ')} |`);

    // 2. 生成对隔线
    lines.push(`| ${headers.map(() => '---').join(' | ')} |`);

    // 3. 填充数据行
    for (const row of recordset) {
        const values = headers.map(header => {
            const val = row[header];
            if (val === null || val === undefined) {
                return 'NULL';
            }
            // 将单元格内的换行符替换掉，防止破坏 Markdown 表格结构
            return String(val).replace(/[\r\n]+/g, ' ');
        });
        lines.push(`| ${values.join(' | ')} |`);
    }

    return lines.join('\n');
}
// 辅助函数：将查询结果转换为 CSV 格式
function convertToCSV(recordset: any[]): string {
    if (!recordset || recordset.length === 0) {
        return '查询成功，但返回了 0 行数据。';
    }

    const headers = Object.keys(recordset[0]);
    const csvRows: string[] = [];

    // 添加表头
    csvRows.push(headers.join(','));

    // 填充数据行
    for (const row of recordset) {
        const values = headers.map(header => {
            const val = row[header];
            if (val === null || val === undefined) {
                return '""';
            }
            const stringVal = String(val).replace(/"/g, '""');
            return `"${stringVal}"`;
        });
        csvRows.push(values.join(','));
    }

    return csvRows.join('\n');
}

export class SqlNotebookController {
    readonly controllerId = 'sql-notebook-controller';
    readonly notebookType = 'sql-notebook';
    readonly label = 'MSSQL Notebook Engine';

    private readonly _controller: vscode.NotebookController;

    constructor() {
        this._controller = vscode.notebooks.createNotebookController(
            this.controllerId,
            this.notebookType,
            this.label
        );

        this._controller.supportedLanguages = ['sql', 'csv'];
        this._controller.supportsExecutionOrder = true;
        this._controller.executeHandler = this._execute.bind(this);
    }

    private async _execute(
        cells: vscode.NotebookCell[],
        notebook: vscode.NotebookDocument,
        _controller: vscode.NotebookController
    ): Promise<void> {
        for (const cell of cells) {
            await this._executeCell(cell, notebook);
        }
    }


    private async _executeCell(cell: vscode.NotebookCell, notebook: vscode.NotebookDocument): Promise<void> {
        const execution = this._controller.createNotebookCellExecution(cell);
        execution.start(Date.now());
 
     
     
        try {
            const sqlQuery = cell.document.getText();
            if (!sqlQuery.trim()) {
                throw new Error('SQL 查询语句不能为空！');
            }

       
            const result=await dbManager.query(sqlQuery);
            // 3. 将结果转为 Markdown 表格格式
 

            // 4. 输出到 Notebook 单元格
            execution.replaceOutput([
                new vscode.NotebookCellOutput([
                    vscode.NotebookCellOutputItem.json(result.recordset, 'application/vnd.sql-notebook+json')
                ])
            ]);

            execution.end(true, Date.now());
        } catch (err: any) {
            execution.replaceOutput([
                new vscode.NotebookCellOutput([
                    vscode.NotebookCellOutputItem.text(`❌ 执行失败:\n${err.message}`, 'text/plain')
                ])
            ]);
            execution.end(false, Date.now());
           
        }finally {
            
        }
    }

    dispose() {
        this._controller.dispose();
    }
}