// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import * as vscode from 'vscode';
import { SqlNotebookSerializer } from './serializer';
import { SqlNotebookController } from './controller';
import * as path from 'path';
import * as fs from 'fs';
import {dbManager } from './DBManager';
import { registerSmartCompletion, refreshSchemaCache } from './completionProvider';
// This method is called when your extension is activated
// Your extension is activated the very first time the command is executed

let sqlStatusBarItem: vscode.StatusBarItem;
export async function activate(context: vscode.ExtensionContext) {


    sqlStatusBarItem = vscode.window.createStatusBarItem(
        vscode.StatusBarAlignment.Left, 
        100
    );
    sqlStatusBarItem.command = 'sql-notebook.switchEnvironment';
    context.subscriptions.push(sqlStatusBarItem);
	// Use the console to output diagnostic information (console.log) and errors (console.error)
	// This line of code will only be executed once when your extension is activated
	context.subscriptions.push(
        vscode.workspace.registerNotebookSerializer(
            'sql-notebook',
            new SqlNotebookSerializer(),
            {
                transientOutputs: false // 确保输出结果可以被持久化保存到文件中
            }
        )
    );
    context.subscriptions.push(
        new SqlNotebookController()
    );
 


// 3. 注册“切换环境”的命令
    context.subscriptions.push(
    vscode.commands.registerCommand('sql-notebook.switchEnvironment', switchEnvironment)
);
    registerSmartCompletion(context);
    await initDB();
    console.log('SQL Notebook extension is now active!');

    
}

async function switchEnvironment() {
const editor = vscode.window.activeNotebookEditor;
        if (!editor || editor.notebook.notebookType !== 'sql-notebook') {
            return;
        }

        const notebook = editor.notebook;
        const currentEnv = notebook.metadata?.environment || '未选择';

        // 1. 动态从外部配置文件加载环境
        const envs = loadEnvironments();
        const quickPickItems = Object.keys(envs).map(key => {
            const env = envs[key];
            return {
                label: `$(database) ${env.name} (${key})`,
                description: env.name,
                envKey: key,
                connectionString: env.connectionString
            };
        });

        if (quickPickItems.length === 0) {
            vscode.window.showWarningMessage('未在工作区找到有效的 .env.json 配置文件或环境为空');
            return;
        }

        // 2. 弹出选择框
        const selected = await vscode.window.showQuickPick(quickPickItems, {
            placeHolder: `当前环境: [ ${currentEnv} ] - 请选择要切换的目标环境`
        });

        if (selected) {
            // 3. 将选择的环境写入当前文件的 metadata
            const newMetadata = {
                ...notebook.metadata,
                environment: selected.envKey,
                connectionString: selected.connectionString
            };

            const edit = new vscode.WorkspaceEdit();
            edit.set(notebook.uri, [
                vscode.NotebookEdit.updateNotebookMetadata(newMetadata)
            ]);

            await vscode.workspace.applyEdit(edit);
            vscode.window.showInformationMessage(`已成功切换到: ${selected.envKey}`);
            await dbManager.switchDatabase(selected.connectionString);
            await refreshSchemaCache(async (sql: string) => {
                return await dbManager.query(sql);
            });

            updateStatusBar(selected.description);
        }

}

// This method is called when your extension is deactivated
export function deactivate() {

    dbManager.close();
}
function loadEnvironments(): { [key: string]: { name: string; connectionString: string } } {
    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (!workspaceFolders) {
        // 如果没有打开工作区，提供默认备用配置
        return {
            PROD: { name: 'PROD 生产环境', connectionString: './data/prod.sqlite' },
            UAT: { name: 'UAT 测试环境', connectionString: './data/uat.sqlite' }
        };
    }

    // 假设 .env.json 放在工作区根目录下
    const envConfigPath = path.join(workspaceFolders[0].uri.fsPath, '.env.json');
    try {
        if (fs.existsSync(envConfigPath)) {
            const content = fs.readFileSync(envConfigPath, 'utf-8');
            const data = JSON.parse(content);
           
            return data.environments || {};
        }
    } catch (err) {
        vscode.window.showErrorMessage(`解析 .env.json 失败: ${err}`);
    }

    return {};
}


async function initDB(){
    const envs = loadEnvironments();
    const envKeys = Object.keys(envs);

    if (envKeys.length > 0) {
        // 2. 取第一个配置
        const firstEnvKey = envKeys[0];
        const defaultEnv = envs[firstEnvKey];

        try {
            // 3. 自动加载到 dbManager 中建立初始连接池
            await dbManager.connect(defaultEnv.connectionString);
            vscode.window.showInformationMessage(`SQL Notebook: 已自动连接到 [${defaultEnv.name}]`);

            // 如果你同时配置了智能提示缓存，可以在这里顺便拉取一次 Schema
           
            await refreshSchemaCache(async (sql) => {
                return await dbManager.query(sql);
            });
           
            updateStatusBar(defaultEnv.name);
        } catch (err: any) {
            vscode.window.showErrorMessage(`自动连接数据库失败 (${defaultEnv.name}): ${err.message}`);
            updateStatusBar('连接失败' );
        }
    } else {
        vscode.window.showWarningMessage('SQL Notebook: 未在 .env.json 中找到任何数据库环境配置。');
        updateStatusBar('未配置环境' );
    }
}


function updateStatusBar(envName: string ) {
    if (sqlStatusBarItem) {
        // 使用 VS Code 内置图标 $(database)，优雅又美观
        sqlStatusBarItem.text = ` ${envName}`;
        sqlStatusBarItem.tooltip = `当前 SQL Notebook 连接环境: ${envName}`;
        sqlStatusBarItem.show();
    }
}