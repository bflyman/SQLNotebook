import * as vscode from 'vscode';
import { Parser } from 'node-sql-parser';

const parser = new Parser();
// 内存 Schema 缓存：key 是连接串，value 是该库的所有表和字段
let schemaCache: Array<{ table: string; column: string }> = [];

// 1. 刷新 Schema（每次连接或手动刷新时直接全量覆盖）
export async function refreshSchemaCache(runQueryFunc: (sql: string) => Promise<any>) {
    try {
        const result = await runQueryFunc(`
            SELECT TABLE_NAME, COLUMN_NAME 
            FROM INFORMATION_SCHEMA.COLUMNS
        `);

        // 直接覆盖当前缓存
        schemaCache = result.recordset.map((row: any) => ({
            table: row.TABLE_NAME,
            column: row.COLUMN_NAME
        }));
    } catch (err) {
        console.error('Failed to load schema for intellisense:', err);
    }
}




export function updateSchemaCache(data: Array<{ table: string; column: string }>) {
    schemaCache = data;
}

// =====================================================================
// 策略 V1：严格上下文感知（FROM/JOIN 提示表名，WHERE/ON/AND 提示字段名）
// =====================================================================
function getCompletionsV1(cleanPrefix: string, currentWord: string, schema: Array<{ table: string; column: string }>) {
    const completions: vscode.CompletionItem[] = [];
    const tables = Array.from(new Set(schema.map(c => c.table)));

    if (/\bfrom$/i.test(cleanPrefix) || /\bjoin$/i.test(cleanPrefix)) {
        // 提示表名
        for (const t of tables) {
            if (!currentWord || t.toLowerCase().startsWith(currentWord)) {
                const item = new vscode.CompletionItem(t, vscode.CompletionItemKind.Class);
                item.detail = '[V1] Table';
                completions.push(item);
            }
        }
    } else if (/\bwhere$/i.test(cleanPrefix) || /\bon$/i.test(cleanPrefix) || /\band$/i.test(cleanPrefix) || /\bor$/i.test(cleanPrefix)) {
        // 提示字段名
        for (const c of schema) {
            if (!currentWord || c.column.toLowerCase().startsWith(currentWord)) {
                const item = new vscode.CompletionItem(c.column, vscode.CompletionItemKind.Field);
                item.detail = `[V1] Column (Table: ${c.table})`;
                completions.push(item);
            }
        }
    } else {
        // 默认兜底：混合展示
        for (const t of tables) {
            if (!currentWord || t.toLowerCase().startsWith(currentWord)) {
                completions.push(new vscode.CompletionItem(t, vscode.CompletionItemKind.Class));
            }
        }
    }
    return completions;
}

// =====================================================================
// 策略 V2：宽松包含匹配（不限关键字，只要输入的字母包含在表名或字段里就提示）
// =====================================================================
function getCompletionsV2(cleanPrefix: string, currentWord: string, schema: Array<{ table: string; column: string }>) {
    const completions: vscode.CompletionItem[] = [];
    const tables = Array.from(new Set(schema.map(c => c.table)));

    // 无论写到哪，同时提供模糊包含匹配
    for (const t of tables) {
        if (!currentWord || t.toLowerCase().includes(currentWord)) {
            const item = new vscode.CompletionItem(t, vscode.CompletionItemKind.Class);
            item.detail = '[V2 模糊] 匹配表';
            completions.push(item);
        }
    }

    for (const c of schema) {
        if (!currentWord || c.column.toLowerCase().includes(currentWord)) {
            const item = new vscode.CompletionItem(c.column, vscode.CompletionItemKind.Field);
            item.detail = `[V2 模糊] 匹配字段 (${c.table})`;
            completions.push(item);
        }
    }

    return completions;
}

// =====================================================================
// 策略 V3：实验性/自定义效果区（你可以随时修改这里测试新逻辑）
// =====================================================================
function getCompletionsV3(cleanPrefix: string, currentWord: string, schema: Array<{ table: string; column: string }>) {
    const completions: vscode.CompletionItem[] = [];

    // 比如：V3 只提示表名，不管前面是什么
    const tables = Array.from(new Set(schema.map(c => c.table)));
    for (const t of tables) {
        if (!currentWord || t.toLowerCase().startsWith(currentWord)) {
            const item = new vscode.CompletionItem(t, vscode.CompletionItemKind.Module);
            item.detail = '[V3 纯表模式]';
            completions.push(item);
        }
    }

    return completions;
}



// =====================================================================
// 💡 版本切换开关：在这里轻松切换 V1 / V2 / V3 进行测试
// =====================================================================
const ACTIVE_VERSION: 'v1' | 'v2' | 'v3' | 'v4' = 'v4';

export function registerSmartCompletion(context: vscode.ExtensionContext) {
    const provider = vscode.languages.registerCompletionItemProvider(
        { language: 'sql' },
        {
            async provideCompletionItems(document, position) {
                if (!schemaCache || schemaCache.length === 0) {
                    return [];
                }

                // 替换原有的 linePrefix 解析逻辑
                const lineText = document.lineAt(position).text;
                const linePrefix = lineText.substring(0, position.character);

                let currentWord = '';
                let cleanPrefix = linePrefix;

                // 1. 如果光标前以空白字符结尾（例如 "select * from "）
                if (/\s$/.test(linePrefix)) {
                    currentWord = '';
                    cleanPrefix = linePrefix.trimEnd(); // 清掉末尾空格，保留 "select * from"
                }
                // 2. 如果光标前正在输入字母（例如 "select * from us"）
                else {
                    const match = linePrefix.match(/\b([a-zA-Z0-9_]+)$/);
                    if (match) {
                        currentWord = match[1].toLowerCase();
                        cleanPrefix = linePrefix.slice(0, -match[1].length).trimEnd(); // 切掉正在输入的词，保留 "select * from"
                    }
                }

                // 根据开关分发到不同的函数
                switch (ACTIVE_VERSION) {
                    case 'v2':
                        return getCompletionsV2(cleanPrefix, currentWord, schemaCache);
                    case 'v3':
                        return getCompletionsV3(cleanPrefix, currentWord, schemaCache);
                    case 'v4':
                        return getCompletionsV4(document.getText(), cleanPrefix, currentWord, schemaCache);
                    case 'v1':
                    default:
                        return getCompletionsV1(cleanPrefix, currentWord, schemaCache);
                }
            }
        },
        '.'
    );

    context.subscriptions.push(provider);
}


/**
 * 辅助函数：从当前 SQL 文本中提取所有涉及的表名
 */
function extractActiveTables(sqlText: string): string[] {
    try {
        let cleanSql = sqlText
            .replace(/\b(where|on|and|or)\s*[\w\.\=\<\>\'\"]*$/i, '')
            .trim();

        if (!cleanSql.toLowerCase().includes('select')) {
            return [];
        }

        const ast = parser.astify(cleanSql, { database: 'transactsql' });
        const statements = Array.isArray(ast) ? ast : [ast];
        const tables = new Set<string>();

        for (const stmt of statements) {
            // 确保 stmt 是 select 语句且 stmt.from 存在
            if (stmt && typeof stmt === 'object' && 'type' in stmt && stmt.type === 'select' && stmt.from) {
                // 💡 核心修复：检查并确保 stmt.from 是数组
                const fromClause = Array.isArray(stmt.from) ? stmt.from : [stmt.from];

                for (const item of fromClause) {
                    if (item && typeof item === 'object' && 'table' in item && item.table) {
                        tables.add(String(item.table).toLowerCase());
                    }
                }
            }
        }
        return Array.from(tables);
    } catch (err) {
        // 正则兜底逻辑保持不变
        const matches = sqlText.match(/\bfrom\s+([a-zA-Z0-9_]+)|\bjoin\s+([a-zA-Z0-9_]+)/gi);
        const tables = new Set<string>();
        if (matches) {
            for (const m of matches) {
                const parts = m.split(/\s+/);
                if (parts[1]){
                     tables.add(parts[1].toLowerCase());
                }
            }
        }
        return Array.from(tables);
    }
}
// =====================================================================
// 策略 V4：智能表关联过滤（通过解析 SQL 里的 FROM/JOIN，只提示对应表的字段）
// =====================================================================
function getCompletionsV4(
    fullDocumentText: string, 
    cleanPrefix: string, 
    currentWord: string, 
    schema: Array<{ table: string; column: string }>
) {
    const completions: vscode.CompletionItem[] = [];

    // 判断当前是否处于 WHERE、ON、AND、OR 之后（需要提示字段）
    const isFieldContext = /\bwhere$/i.test(cleanPrefix) || 
                           /\bon$/i.test(cleanPrefix) || 
                           /\band$/i.test(cleanPrefix) || 
                           /\bor$/i.test(cleanPrefix) || 
                           /\bwhere\s+[\w\.]+$/i.test(cleanPrefix);

    if (isFieldContext) {
        // 1. 用 SQL 解析器获取当前查询中关联的表名
        const activeTables = extractActiveTables(fullDocumentText);
        console.log('V4 解析出的当前活动表:', activeTables);

        // 2. 过滤 Schema：只保留属于这些活动表的字段
        for (const c of schema) {
            // 如果查不到 activeTables（比如还没写 FROM），可以默认全量展示或展示空
            const belongsToActiveTable = activeTables.length === 0 || activeTables.includes(c.table.toLowerCase());

            if (belongsToActiveTable) {
                if (!currentWord || c.column.toLowerCase().startsWith(currentWord)) {
                    const item = new vscode.CompletionItem(c.column, vscode.CompletionItemKind.Field);
                    // 在 detail 里标明所属表，彻底解决重名字段分不清的问题
                    item.detail = `[V4 智能过滤] 表: ${c.table}`;
                    completions.push(item);
                }
            }
        }
    } else {
        // 默认 / FROM 后面：提示表名
        const tables = Array.from(new Set(schema.map(c => c.table)));
        for (const t of tables) {
            if (!currentWord || t.toLowerCase().startsWith(currentWord)) {
                const item = new vscode.CompletionItem(t, vscode.CompletionItemKind.Class);
                item.detail = '[V4] Table';
                completions.push(item);
            }
        }
    }

    return completions;
}