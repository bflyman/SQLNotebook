// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import * as vscode from 'vscode';
import { SqlNotebookSerializer } from './serializer';
import { SqlNotebookController } from './controller';
import * as path from 'path';
import * as fs from 'fs';
import {dbManager } from './DBManager';
import { registerSmartCompletion, refreshSchemaCache } from './completionProvider';
import {GlobalConfigManager} from './GlobalConfigManager'

// This method is called when your extension is activated
// Your extension is activated the very first time the command is executed

let sqlStatusBarItem: vscode.StatusBarItem;
let configManager:GlobalConfigManager
export async function activate(context: vscode.ExtensionContext) {

    configManager=new GlobalConfigManager(context); 
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


    const setPasswordCmd = vscode.commands.registerCommand('sql-notebook.setEnvironmentPassword', async () => {
    const envs = configManager.getEnvironmentNames();
    const pickedEnv = await vscode.window.showQuickPick(envs, {
        placeHolder: '选择要设置密码的环境',
    });
    if (!pickedEnv) {
        return;
    }

    const pwd = await vscode.window.showInputBox({
        prompt: `输入环境 [${pickedEnv}] 的数据库密码`,
        password: true,
        ignoreFocusOut: true,
    });
    if (pwd !== undefined) {
        await configManager.setEnvironmentPassword(pickedEnv, pwd);
        vscode.window.showInformationMessage(`已安全保存 [${pickedEnv}] 的数据库密码`);
    }
});
context.subscriptions.push(setPasswordCmd);
    await initDB();
    console.log('SQL Notebook extension is now active!');

    
}


async function switchEnvironment(){
    const envs = configManager.getEnvironmentNames();

    if (envs.length === 0) {
        const action = await vscode.window.showWarningMessage(
            '未配置 sqlnotebook.environments，请先在全局设置中添加环境',
            '打开设置'
        );
        if (action === '打开设置') {
            await vscode.commands.executeCommand('workbench.action.openSettings', 'sqlnotebook.environments');
        }
        return;
    }

    const currentEnv = configManager.getCurrentEnvironmentName();
    const picked = await vscode.window.showQuickPick(
        envs.map((name) => ({
            label: name,
            description: name === currentEnv ? '当前使用中' : undefined,
        })),
        {
            placeHolder: `选择数据库环境（当前: ${currentEnv}）`,
        }
    );

    if (!picked || picked.label === currentEnv) {
        return;
    }

    await configManager.setCurrentEnvironment(picked.label);
    // await refreshStatusBar();

    // if (onEnvironmentSwitched) {
    //     await onEnvironmentSwitched(picked.label);
    // }

    await initDB(picked.label);
    // const connConfig = await configManager.getConnectionConfig(picked.label, true);
    // dbManager.connect2(connConfig);
    // updateStatusBar(picked.label);

    vscode.window.showInformationMessage(`已切换环境至: ${picked.label}`);
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


async function initDB(currentEnv:string){
    if(!currentEnv)
       currentEnv = configManager.getCurrentEnvironmentName();
    const config= await configManager.getConnectionConfig(currentEnv,true);
    if (config) {
        // 2. 取第一个配置
       

        try {
            // 3. 自动加载到 dbManager 中建立初始连接池
            await dbManager.connect2(config);
            vscode.window.showInformationMessage(`SQL Notebook: 已自动连接到 [${currentEnv}]`);

            // 如果你同时配置了智能提示缓存，可以在这里顺便拉取一次 Schema
           
            await refreshSchemaCache(async (sql) => {
                return await dbManager.query(sql);
            });
           
            updateStatusBar(currentEnv);
        } catch (err: any) {
            vscode.window.showErrorMessage(`自动连接数据库失败 (${currentEnv}): ${err.message}`);
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