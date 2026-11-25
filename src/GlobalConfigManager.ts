import * as vscode from 'vscode';

export interface EnvConnectionConfig {
    server: string;
    port?: number;
    database: string;
    user?: string;
    password?: string;
    encrypt?: boolean;
    trustServerCertificate?: boolean;
}

export class GlobalConfigManager {
    constructor(private readonly context: vscode.ExtensionContext) {}

    public getEnvironmentNames(): string[] {
        const config = vscode.workspace.getConfiguration('sqlnotebook');
        const envs = config.get<Record<string, EnvConnectionConfig>>('environments') ?? {};
        return Object.keys(envs);
    }

    public getCurrentEnvironmentName(): string {
        const config = vscode.workspace.getConfiguration('sqlnotebook');
        const configured = config.get<string>('defaultEnvironment');
        const names = this.getEnvironmentNames();

        if (configured && names.includes(configured)) {
            return configured;
        }
        return names[0] ?? 'dev';
    }

    public async setCurrentEnvironment(envName: string): Promise<void> {
        const config = vscode.workspace.getConfiguration('sqlnotebook');
        await config.update('defaultEnvironment', envName, vscode.ConfigurationTarget.Global);
    }

  public async getConnectionConfig(envName?: string, promptIfMissingPassword = false): Promise<EnvConnectionConfig> {
    const targetEnv = envName ?? this.getCurrentEnvironmentName();
    const config = vscode.workspace.getConfiguration('sqlnotebook');
    const envs = config.get<Record<string, EnvConnectionConfig>>('environments') ?? {};
    const base = envs[targetEnv];

    if (!base) {
        throw new Error(`未在全局配置 sqlnotebook.environments 中找到环境: ${targetEnv}`);
    }

    const secretKey = `sqlnotebook.password.${targetEnv}`;
    let password = await this.context.secrets.get(secretKey);

    if (!password && !base.password && promptIfMissingPassword) {
        const input = await vscode.window.showInputBox({
            prompt: `请输入环境 [${targetEnv}] (${base.user ?? ''}@${base.server}) 的数据库密码`,
            password: true,
            ignoreFocusOut: true,
        });
        if (input !== undefined && input.length > 0) {
            password = input;
            await this.context.secrets.store(secretKey, password);
        }
    }

    return {
        port: 1433,
        encrypt: true,
        trustServerCertificate: false,
        ...base,
        password: password ?? base.password,
    };
}

    public async setEnvironmentPassword(envName: string, password: string): Promise<void> {
        const secretKey = `sqlnotebook.password.${envName}`;
        await this.context.secrets.store(secretKey, password);
    }

    public onDidChange(listener: (e: vscode.ConfigurationChangeEvent) => void): vscode.Disposable {
        return vscode.workspace.onDidChangeConfiguration((e) => {
            if (
                e.affectsConfiguration('sqlnotebook.environments') ||
                e.affectsConfiguration('sqlnotebook.defaultEnvironment')
            ) {
                listener(e);
            }
        });
    }
}