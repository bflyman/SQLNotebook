import * as sql from 'mssql';
import { EnvConnectionConfig } from './GlobalConfigManager';


class DbManager {
    private pool: sql.ConnectionPool | null = null;
    private currentConnStr: string | null = null;

    /**
     * 建立连接：直接传入连接字符串
     */
    public async connect(connStr: string): Promise<void> {
        // 1. 关闭并清理旧连接池
        if (this.pool) {
            try {
                await this.pool.close();
            } catch (err) {
                console.error('Failed to close old pool:', err);
            }
            this.pool = null;
        }

        // 2. 创建并打开新连接池
        this.currentConnStr = connStr;
        this.pool = new sql.ConnectionPool(connStr);
        await this.pool.connect();
    }
    public async connect2(config: EnvConnectionConfig): Promise<sql.ConnectionPool> {
        // 1. 关闭并清理旧连接池
        if (this.pool) {
            try {
                await this.pool.close();
            } catch (err) {
                console.error('Failed to close old pool:', err);
            }
            this.pool = null;
        }

        // 2. 将 EnvConnectionConfig 转换为 mssql.config
        const sqlConfig: sql.config = {
            server: config.server,
            port: config.port ?? 1433,
            database: config.database,
            user: config.user,
            password: config.password,
            options: {
                encrypt: config.encrypt ?? true,
                trustServerCertificate: config.trustServerCertificate ?? false,
            },
        };

        // 3. 创建并打开新连接池
        const nextPool = new sql.ConnectionPool(sqlConfig);
        await nextPool.connect();

        this.currentConnStr = `${config.server}:${config.port ?? 1433}/${config.database}`;
        this.pool = nextPool;
        return nextPool;
    }

    /**
     * 切换数据库：基于当前连接串，自动替换/追加 Database 属性并重连
     */
    public async switchDatabase(databaseName: string): Promise<void> {
        if (!this.currentConnStr) {
            throw new Error('No active connection string found.');
        }

        this.currentConnStr=databaseName;

        await this.connect(this.currentConnStr);
    }

    /**
     * 执行查询
     */
    public async query(sqlQuery: string): Promise<sql.IResult<any>> {
        if (!this.pool || !this.pool.connected) {
            throw new Error('Database pool is not connected.');
        }
        return await this.pool.request().query(sqlQuery);
    }

    /**
     * 获取当前连接串
     */
    public getCurrentConnStr(): string | null {
        return this.currentConnStr;
    }

    /**
     * 关闭并释放资源
     */
    public async close(): Promise<void> {
        if (this.pool) {
            await this.pool.close();
            this.pool = null;
            this.currentConnStr = null;
        }
    }
}

export const dbManager = new DbManager();