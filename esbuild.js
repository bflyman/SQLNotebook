const esbuild = require("esbuild");

const production = process.argv.includes('--production');
const watch = process.argv.includes('--watch');

/**
 * @type {import('esbuild').Plugin}
 */
const esbuildProblemMatcherPlugin = {
	name: 'esbuild-problem-matcher',

	setup(build) {
		build.onStart(() => {
			console.log('[watch] build started');
		});
		build.onEnd((result) => {
			result.errors.forEach(({ text, location }) => {
				console.error(`✘ [ERROR] ${text}`);
				console.error(`    ${location.file}:${location.line}:${location.column}:`);
			});
			console.log('[watch] build finished');
		});
	},
};

async function main() {
    // 1. 主插件上下文 (Node 环境，保留你原本的全部配置和外部依赖)
    const extensionCtx = await esbuild.context({
        entryPoints: [
            'src/extension.ts'
        ],
        bundle: true,
        format: 'cjs',
        minify: production,
        sourcemap: !production,
        sourcesContent: false,
        platform: 'node',
        outfile: 'dist/extension.js',
        external: [
            'vscode', 
            'mssql', 
            'tedious'
        ],
        logLevel: 'silent',
        plugins: [
            esbuildProblemMatcherPlugin,
        ],
    });

    // 2. 前端渲染器上下文 (浏览器/Webview 环境，用于表格渲染)
    const rendererCtx = await esbuild.context({
        entryPoints: [
            'src/renderer.ts'
        ],
        bundle: true,
        format: 'esm',              // 渲染器必须是 ESM 格式
        minify: production,
        sourcemap: !production,
        sourcesContent: false,
        platform: 'browser',        // 运行在浏览器/Webview环境
        target: 'es2020',
        outfile: 'dist/renderer.js', // 输出到 dist 目录（与 extension.js 保持一致）
        logLevel: 'silent',
    });

    if (watch) {
        // 开发监听模式：同时监听两边文件的改动
        await Promise.all([
            extensionCtx.watch(),
            rendererCtx.watch(),
        ]);
        console.log('[watch] build started for both extension & renderer...');
    } else {
        // 单次打包构建模式
        await Promise.all([
            extensionCtx.rebuild(),
            rendererCtx.rebuild(),
        ]);
        await Promise.all([
            extensionCtx.dispose(),
            rendererCtx.dispose(),
        ]);
        console.log('build complete.');
    }
}

main().catch(e => {
	console.error(e);
	process.exit(1);
});
