import * as vscode from 'vscode';
import * as sql from 'mssql';
import { dbManager } from './DBManager';


import { cellStore } from './CellResultStore';



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

        this._controller.supportedLanguages = ['sql'];
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
            const docUri = cell.notebook.uri.toString();
            const sqlQuery = cell.document.getText();
            const directives = parseCellDirectives(sqlQuery);
            const sqlList = injectNamedCellPlaceholdersToList(sqlQuery, directives, (name) => cellStore.get(docUri, name));
            if (!sqlQuery.trim()) {
                throw new Error('SQL 查询语句不能为空！');
            }

            const cellQueryResult = await executeSqlList(
                sqlList,
                (sql) => dbManager.query(sql)
            );

            setNameOfValue(directives, cellQueryResult, docUri);
            execution.replaceOutput([
                new vscode.NotebookCellOutput([
                    vscode.NotebookCellOutputItem.json(cellQueryResult.rows, 'application/vnd.sql-notebook+json')
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

        } finally {

        }
    }

    dispose() {
        this._controller.dispose();
    }
}


export interface ParsedCellDirectives {
    /** 当前 Cell 的名称，如 `-- @name active_users` */
    cellName?: string;
    /** 引用的前置命名 Cell 名称，如 `-- @from active_users` */
    fromName?: string;
    /** 从前置结果中提取的列名，如 `-- @column id` */
    columnName?: string;
}

export function parseCellDirectives(sqlText: string): ParsedCellDirectives {
    const directives: ParsedCellDirectives = {};
    const lines = sqlText.split(/\r?\n/);

    // 只在开头连续的 SQL 注释行中扫描指令，避免误伤 SQL 正文里的注释
    for (const rawLine of lines) {
        const line = rawLine.trim();
        if (!line.startsWith('--')) {
            break;
        }

        const nameMatch = line.match(/^--\s*@(?:name|as)\s+([a-zA-Z_][a-zA-Z0-9_]*)\s*$/i);
        if (nameMatch?.[1]) {
            directives.cellName = nameMatch[1];
            continue;
        }

        const fromMatch = line.match(/^--\s*@(?:from|ref)\s+([a-zA-Z_][a-zA-Z0-9_]*)\s*$/i);
        if (fromMatch?.[1]) {
            directives.fromName = fromMatch[1];
            continue;
        }

        const colMatch = line.match(/^--\s*@column\s+([a-zA-Z_][a-zA-Z0-9_]*)\s*$/i);
        if (colMatch?.[1]) {
            directives.columnName = colMatch[1];
        }
    }

    return directives;
}

export interface CellQueryResult {
    columns: string[];
    rows: Record<string, unknown>[];
}

function formatSqlLiteral(value: unknown): string {
    if (typeof value === 'number' && Number.isFinite(value)) {
        return String(value);
    }
    if (typeof value === 'boolean') {
        return value ? '1' : '0';
    }
    const escaped = String(value).replace(/'/g, "''");
    return `'${escaped}'`;
}



export function injectNamedCellPlaceholdersToList(
    sqlText: string,
    directives: ParsedCellDirectives,
    getNamedResult: (name: string) => CellQueryResult | undefined
): string[] {
    const placeholderRegex = /\{\{\s*([a-zA-Z_][a-zA-Z0-9_]*)\.([a-zA-Z_][a-zA-Z0-9_]*)\s*\}\}/g;

    if (directives.fromName && !getNamedResult(directives.fromName)) {
        throw new Error(`未找到名为 "${directives.fromName}" 的前置 Cell 结果，请先执行该 Cell。`);
    }

    // 找出 SQL 中引用的所有占位符
    const matches = Array.from(sqlText.matchAll(placeholderRegex));

    // 如果没有占位符，直接返回单条 SQL 数组
    if (matches.length === 0) {
        return [sqlText];
    }

    // 按引用的第一个结果集决定行数（若引用了多个 Cell，取对应结果集的 rows 长度）
    const primaryCellName = matches[0][1];
    const primaryResult = getNamedResult(primaryCellName);
    if (!primaryResult) {
        throw new Error(`未找到名为 "${primaryCellName}" 的前置 Cell 结果，请先执行该 Cell。`);
    }

    // rows 有 0 行时，返回空数组（不执行任何行）
    if (primaryResult.rows.length === 0) {
        return [];
    }

    // 逐行生成对应的 SQL 语句
    return primaryResult.rows.map((_row, rowIndex) => {
        return sqlText.replace(placeholderRegex, (_fullMatch, refCellName: string, refColumnName: string) => {
            const sourceResult = getNamedResult(refCellName);
            if (!sourceResult) {
                throw new Error(`未找到名为 "${refCellName}" 的前置 Cell 结果，请先执行该 Cell。`);
            }

            const matchedCol = sourceResult.columns.find(
                (col) => col.toLowerCase() === refColumnName.toLowerCase()
            );
            if (!matchedCol) {
                throw new Error(
                    `前置 Cell "${refCellName}" 中不存在列 "${refColumnName}"（可用列: ${sourceResult.columns.join(', ')}）。`
                );
            }

            const targetRow = sourceResult.rows[rowIndex];
            if (!targetRow) {
                throw new Error(
                    `前置 Cell "${refCellName}" 只有 ${sourceResult.rows.length} 行，缺少第 ${rowIndex + 1} 行数据。`
                );
            }

            return formatSqlLiteral(targetRow[matchedCol]);
        });
    });
}
export function injectNamedCellPlaceholders(
    sqlText: string,
    directives: ParsedCellDirectives,
    getNamedResult: (name: string) => CellQueryResult | undefined
): string {
    // 匹配 {{cellName.columnName}}，允许前后有空格如 {{ target_users.id }}
    const placeholderRegex = /\{\{\s*([a-zA-Z_][a-zA-Z0-9_]*)\.([a-zA-Z_][a-zA-Z0-9_]*)\s*\}\}/g;

    // 1. 先检查 -- @from 声明的前置结果是否已执行
    if (directives.fromName && !getNamedResult(directives.fromName)) {
        throw new Error(`未找到名为 "${directives.fromName}" 的前置 Cell 结果，请先执行该 Cell。`);
    }

    // 2. 逐个替换 {{cellName.columnName}}
    return sqlText.replace(placeholderRegex, (_match, refCellName: string, refColumnName: string) => {
        const sourceResult = getNamedResult(refCellName);
        if (!sourceResult) {
            throw new Error(`未找到名为 "${refCellName}" 的前置 Cell 结果，请先执行该 Cell。`);
        }

        // 不区分大小写匹配列名，兼容 SQL Server 常见大小写差异
        const matchedCol = sourceResult.columns.find(
            (col) => col.toLowerCase() === refColumnName.toLowerCase()
        );
        if (!matchedCol) {
            throw new Error(
                `前置 Cell "${refCellName}" 中不存在列 "${refColumnName}"（可用列: ${sourceResult.columns.join(', ')}）。`
            );
        }

        const values = sourceResult.rows
            .map((row) => row[matchedCol])
            .filter((v): v is string | number | boolean => v !== null && v !== undefined);

        const uniqueLiterals = Array.from(new Set(values.map(formatSqlLiteral)));
        return uniqueLiterals.length > 0 ? uniqueLiterals.join(', ') : 'NULL';
    });
}

function setNameOfValue(directives: ParsedCellDirectives, result: CellQueryResult, uri: string) {
    if (!directives.cellName) {
        return;

    }
    

    cellStore.set(uri, {
        name: directives.cellName,
        columns:result.columns,
        rows:result.rows,
        executedAt: Date.now(),
    });
}


export async function executeSqlList(
    sqlList: string[],
    runSingleSql: (sql: string) => Promise<{
        recordset?: Record<string, unknown>[] & { columns?: Record<string, unknown> };
        rowsAffected?: number[];
    }>
): Promise<CellQueryResult> {
    const rawRows: Record<string, unknown>[] = [];
    const columnSet = new Set<string>();
    let totalRowsAffected = 0;

    for (const sql of sqlList) {
        const result = await runSingleSql(sql);

        if (result.recordset?.columns) {
            for (const colName of Object.keys(result.recordset.columns)) {
                columnSet.add(colName);
            }
        }

        if (result.recordset?.length) {
            for (const row of result.recordset) {
                for (const key of Object.keys(row)) {
                    columnSet.add(key);
                }
                rawRows.push(row);
            }
        }

        if (result.rowsAffected?.length) {
            totalRowsAffected += result.rowsAffected.reduce((sum, n) => sum + n, 0);
        }
    }

    // 有查询行时按统一列顺序补齐字段；无查询行（如 UPDATE/INSERT）时生成单行摘要
    if (rawRows.length > 0) {
        const columns = Array.from(columnSet);
        const rows = rawRows.map((row) => {
            const normalizedRow: Record<string, unknown> = {};
            for (const col of columns) {
                normalizedRow[col] = Object.prototype.hasOwnProperty.call(row, col) ? row[col] : null;
            }
            return normalizedRow;
        });

        return { columns, rows };
    }

    const summaryRow: Record<string, unknown> = {
        status: 'OK',
        queriesExecuted: sqlList.length,
        rowsAffected: totalRowsAffected,
    };

    return {
        columns: Object.keys(summaryRow),
        rows: [summaryRow],
    };
}